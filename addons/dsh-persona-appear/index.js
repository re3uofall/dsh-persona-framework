import { noteStep, snapshot } from './lib/gate.mjs'
import {
  LEDGER_FILE, LADDER, adjudicate, appendPriority, ladderTable, presentLine, presenceOf,
  readPriority, renderPriority,
} from './lib/priority.mjs'
/**
 * dsh-persona-appear —— 人格出现的总闸（host 半端）
 * ============================================================================
 * 一句话：决定**哪一个插件**这一轮出现、哪一个不出现。
 *
 * 为什么需要它：人格不是一家给的一个块，是两部分——
 *   ① 人格本身（人格文件、补丁、证据）
 *   ② 随人格的其他内容（记忆、框架、日记、探索、成果）
 * 六家各注册各的 `systemPrompt.section`；关掉其中一家，另外五家照进。
 * 所以「让谁出场」只能靠一道**所有注入者都先读的闸**——就是这份 `出现.json`。
 *
 * 粒度是插件，不是会话：包名在装的时候就定死了，不用猜、不用等宿主给会话键。
 *
 * 三档：
 *   - 全局关：谁都不出现。
 *   - 按插件关：名单里的那家不出现，别家照常。
 *   - 放行：默认。
 *
 * 人格出现的判据在源码里：`dsh-agent-loop/lib/index.js:preStep()` 每步调一次
 * `systemPrompt.assemble(assembleContextFor(agent))`，而后者给的是
 * `{ agent, scope: agent }`。所以「这一轮她出不出场」看的是这一次 assemble。
 * ============================================================================
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  INJECTORS, STATE_FILE, allows, emptyState, mute, normalizeState, orderOf, orderTable, roster,
  setGlobal, setOrder, unmute,
} from './lib/appear.mjs'
import {
  LIVE_FILE, WINDOW_MS, addLive, emptyLive, readLive, renderLive, writeLive,
} from './lib/live.mjs'
import {
  DEFAULTS as SETTING_DEFAULTS, fieldTable, normalizePatch, normalizeStored, pickCurrent,
} from './lib/settings.mjs'

export const name = 'persona-appear'
export const version = '0.7.1'
export const inject = ['tools', 'systemPrompt', 'webServer']

const DEFAULTS = {
  /** 工作区根；空 = 从插件自己的位置往上推一级（插件装在仓库里时成立）。 */
  workspace: '',
  /** 闸文件所在目录，相对工作区。 */
  stateDir: '.persona-framework',
}

function pickCfg(config) {
  const raw = (config && typeof config === 'object' && config) || {}
  const out = { ...DEFAULTS }
  for (const k of Object.keys(DEFAULTS)) {
    if (raw[k] !== undefined) out[k] = raw[k]
  }
  return out
}

/**
 * 会话的工作区从 pre-step 的 `agent.session.header.cwd` 拿——那才是工作区。
 * 插件目录往上推只会推到 addons/，进程 cwd 是 profile 目录；两个都错，踩过。
 */
let sessionWs = ''

function noteSessionWorkspace(payload) {
  const cwd = payload?.agent?.session?.header?.cwd
  if (typeof cwd === 'string' && cwd) sessionWs = cwd
}

/** 插件在仓库里时，自己往上推一级就是工作区；推不出来就让配置填。 */
function guessWorkspace() {
  if (sessionWs) return sessionWs
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    return dirname(here)
  } catch {
    return process.cwd()
  }
}

export function statePathOf(cfg) {
  const ws = cfg.workspace || guessWorkspace()
  return join(ws, cfg.stateDir, STATE_FILE)
}

function readState(p) {
  if (!existsSync(p)) return emptyState()
  try {
    return normalizeState(JSON.parse(readFileSync(p, 'utf8')))
  } catch {
    return emptyState()
  }
}

function writeState(p, state) {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(state, null, 2) + '\n', 'utf8')
}
// ── 优先级：每一轮自己算一遍、自己记一行，不等我想起它 ────────────────
let priorityNow = { at: '', presence: {}, wrote: false, error: '' }

function ledgerPathOf(cfg) {
  return join(cfg.workspace || guessWorkspace(), cfg.stateDir, LEDGER_FILE)
}

/** 强制：每步都算一遍；账面一行一条，翻得回去。 */
function runPriority(cfg) {
  const at = new Date().toISOString()
  try {
    const ws = cfg.workspace || guessWorkspace()
    const presence = presenceOf(ws)
    const snap = snapshot()
    appendPriority(ledgerPathOf(cfg), { at, turn: snap.turn, step: snap.step, repeat: snap.repeat, presence })
    priorityNow = { at, presence, wrote: true, error: '' }
  } catch (error) {
    priorityNow = { at, presence: priorityNow.presence, wrote: false, error: String(error?.message || error) }
  }
  return priorityNow
}


// ── 设置文件：给装的人自己调，不用改代码 ──────────────────────────────
const SETTINGS_FILE = '出现配置.json'

function settingsPathOf(cfg) {
  return join(cfg.workspace || guessWorkspace(), cfg.stateDir, SETTINGS_FILE)
}

function readSettings(p) {
  const base = { ...SETTING_DEFAULTS }
  try {
    if (!existsSync(p)) return base
    return { ...base, ...normalizeStored(JSON.parse(readFileSync(p, 'utf8'))) }
  } catch {
    return base
  }
}

function writeSettings(p, patch) {
  let cur = {}
  try { cur = normalizeStored(JSON.parse(readFileSync(p, 'utf8'))) } catch { cur = {} }
  const next = { ...cur, ...normalizePatch(patch) }
  mkdirSync(dirname(p), { recursive: true })
  if (existsSync(p)) {
    try { writeFileSync(`${p}.bak`, readFileSync(p, 'utf8'), 'utf8') } catch { /* 备份失败不拦 */ }
  }
  writeFileSync(p, JSON.stringify(next, null, 2) + '\n', 'utf8')
  return next
}

function sendJson(res, code, body) {
  const text = JSON.stringify(body)
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(text)
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > 64 * 1024) { reject(new Error('请求体太大')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const textOutput = {
  schema: {
    type: 'object',
    properties: { text: { type: 'string', description: '给模型看的结果正文' } },
    required: ['text'],
    additionalProperties: false,
  },
  render(_args, value) {
    return [{ type: 'text', text: String(value?.text ?? '') }]
  },
}

/** 人话名或包名都能认；认不出就原样返回（判的时候会当「不在名单里」） */
function resolvePlugin(input) {
  const s = String(input || '').trim()
  if (!s) return ''
  if (INJECTORS[s]) return s
  for (const [pkg, label] of Object.entries(INJECTORS)) {
    if (label === s) return pkg
  }
  const low = s.toLowerCase()
  for (const [pkg, label] of Object.entries(INJECTORS)) {
    if (label.toLowerCase() === low || pkg.toLowerCase() === low) return pkg
  }
  return s
}

function brief(state, p) {
  const r = roster(state)
  const lines = [
    `闸文件：${p}`,
    `全局：${r.global === 'off' ? '关（谁都不出现）' : '开（按名单）'}`,
    '',
  ]
  for (const row of r.rows) {
    lines.push(`${row.on ? '出' : '不出'}  ${row.label}（${row.plugin}）`)
    lines.push(`      ${row.part}`)
    if (!row.on) lines.push(`      ← ${row.why}`)
  }
  if (r.note) lines.push('', `备注：${r.note}`)
  const table = orderTable(state)
  if (table.length) {
    lines.push('', '出场顺序（数字小的先出；带 * 的是改过的）：')
    for (const row of table) {
      lines.push(`  ${String(row.order).padStart(3)}  ${row.section}${row.custom ? ' *' : ''}`)
    }
  }
  return lines.join('\n')
}

export function apply(ctx, config = {}) {
  const cfg = pickCfg(config)
  const p = statePathOf(cfg)

  const reg = (spec) => ctx.effect(() => ctx.tools.register({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    output: textOutput,
    async execute(args) {
      try {
        return { text: String(await spec.run(args && typeof args === 'object' ? args : {})) }
      } catch (error) {
        return { text: `没办成：${error && error.message ? error.message : String(error)}` }
      }
    },
  }))

  reg({
    name: 'appear_status',
    description: '看人格出现：这一轮哪些插件会出场、哪些不出现，各属于人格的哪一部分。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    run() {
      return brief(readState(p), p)
    },
  })

  reg({
    name: 'appear_mute',
    description: '让某一个插件这一轮不出现。可写人话名（人格框架／记忆分层／日记／碗外探索／人格自学／思考成果）或包名。',
    parameters: {
      type: 'object',
      properties: {
        plugin: { type: 'string', description: '插件：人话名或包名都行' },
        why: { type: 'string', description: '为什么关（留给以后的自己看）' },
      },
      required: ['plugin'],
      additionalProperties: false,
    },
    run(args) {
      const plugin = resolvePlugin(args.plugin)
      if (!plugin) return '没给插件名，没动。'
      const next = mute(readState(p), plugin, args.why)
      writeState(p, next)
      return `「${INJECTORS[plugin] || plugin}」不出现了。\n\n${brief(next, p)}`
    },
  })

  reg({
    name: 'appear_unmute',
    description: '让某一个插件重新出现。不给名字就只报名单，不动。',
    parameters: {
      type: 'object',
      properties: {
        plugin: { type: 'string', description: '插件：人话名或包名都行；不给就只报名单' },
      },
      additionalProperties: false,
    },
    run(args) {
      const plugin = resolvePlugin(args.plugin)
      if (!plugin) return `没给名字，没动。\n\n${brief(readState(p), p)}`
      const next = unmute(readState(p), plugin)
      writeState(p, next)
      return `「${INJECTORS[plugin] || plugin}」重新出现了。\n\n${brief(next, p)}`
    },
  })

  reg({
    name: 'appear_global',
    description: '全局总闸：off = 这一套谁都不出现；on = 按名单走。改的是全机器。',
    parameters: {
      type: 'object',
      properties: {
        on: { type: 'boolean', description: 'true = 按名单；false = 谁都不出现' },
      },
      required: ['on'],
      additionalProperties: false,
    },
    run(args) {
      const next = setGlobal(readState(p), Boolean(args.on))
      writeState(p, next)
      return brief(next, p)
    },
  })

  reg({
    name: 'appear_order',
    description: '改出场顺序：给 section 名和数字（小的先出）。不给参数就只报现在的顺序。改完要重载插件才生效——顺序是注册期定的。',
    parameters: {
      type: 'object',
      properties: {
        section: { type: 'string', description: 'section 的 name 原文，如 persona:framework、persona-memory:short' },
        order: { type: 'number', description: '排第几，数字小的先出' },
      },
      additionalProperties: false,
    },
    run(args) {
      const section = String(args.section || '').trim()
      const cur = readState(p)
      if (!section) {
        const table = orderTable(cur)
        if (!table.length) return `还没有记下任何顺序。\n\n${brief(cur, p)}`
        return [
          '现在的出场顺序（数字小的先出；带 * 的是改过的）：',
          ...table.map((r) => `  ${String(r.order).padStart(3)}  ${r.section}${r.custom ? ' *' : ''}`),
          '',
          '改法：appear_order section=<名字> order=<数字>。',
          '注意：顺序是注册期定的，改完要重载注入它的插件（或重启 DSH）才生效。',
        ].join('\n')
      }
      if (args.order === undefined || args.order === null || !Number.isFinite(Number(args.order))) {
        const now = orderOf(cur, section, undefined)
        return `「${section}」现在是 ${now === undefined ? '（没有记录，用注入者自己的默认值）' : now}。给 order 才改。`
      }
      const next = setOrder(cur, section, Number(args.order))
      writeState(p, next)
      return [
        `「${section}」排到 ${Math.round(Number(args.order))}。`,
        '要重载注入它的插件（或重启 DSH）才生效——顺序是注册期定的，不是每轮读的。',
        '',
        brief(next, p),
      ].join('\n')
    },
  })



  // ── 优先级：强制触发器。台阶每一轮都在，谁在场每一轮重算 ──────────
  try {
    ctx.effect(() => ctx.systemPrompt.section({
      name: '实时环境:priority',
      order: 3,
      interpolate: false,
      text: () => renderPriority(priorityNow),
    }))
  } catch { /* 没有 systemPrompt 也能用 */ }  // ── 实时注入：这一轮临时摆一段进去，过期自己撤 ──────────────────────
  // 跟「出场闸」分开：闸管长期（谁出不出场），这里管临时（往里加一段）。
  const livePath = join(dirname(p), LIVE_FILE)
  // 现算：启动那一刻还没拿到会话工作区，算早了就指到 profile 目录去。
  const settingsPathNow = () => settingsPathOf(cfg)
  const liveNow = () => readSettings(settingsPathNow())

  try {
    ctx.effect(() => ctx.systemPrompt.section({
      name: '实时环境:appear',
      order: 6,
      interpolate: false,
      text: () => {
        // 这一行是「开关板的手柄」：不写出来，想调的时候就得翻文档。
        const panel = '调控：appear_status() 看谁在场｜appear_mute(插件) 关｜appear_unmute 再开｜appear_order(段名, 数) 排先后｜appear_inject(文字, 分钟) 临时摆一段'
        try {
          const s = liveNow()
          if (!s.liveOn) return panel
          const body = renderLive(readLive(livePath), { maxChars: s.liveMaxChars, windowMs: s.liveMinutes * 60000 })
          return body ? body + '\n\n' + panel : panel
        } catch (error) {
          return `实时注入读不出来：${error?.message || error}\n${panel}`
        }
      },
    }))
  } catch { /* 没有 systemPrompt 也能用 */ }

  reg({
    name: 'appear_inject',
    description: '往下一轮临时摆一段字（实时注入）。默认 30 分钟后自己过期；它不是记忆，不进账，说完就撤。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要摆进去的那段字（1200 字以内）' },
        minutes: { type: 'number', description: '活多久，分钟（默认 30）' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    async run(args) {
      const text = String(args.text || '').trim()
      if (!text) return '没给 text，什么都没写。'
      const st = liveNow()
      const minutes = Math.max(1, Number(args.minutes) || st.liveMinutes)
      const turns = Math.max(1, Math.ceil(minutes / st.liveMinutes))
      const next = addLive(readLive(livePath), { text: text.slice(0, st.liveMaxChars), turns, from: 'appear_inject' })
      writeLive(livePath, next)
      return [
        `摆了 ${next.items.length} 条，这条活 ${minutes} 分钟。`,
        `文件：${livePath}`,
        '下一次 assemble 就会带上它；过期自己撤，不用谁记着来删。',
      ].join('\n')
    },
  })

  reg({
    name: 'appear_inject_list',
    description: '看现在摆了哪几段实时注入，各还剩多少分钟过期。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      const cur = readLive(livePath)
      if (!cur.items.length) return '现在没摆任何实时注入。'
      const st = liveNow()
      const now = Date.now()
      const lines = ['## 现在摆着的', '']
      for (const it of cur.items) {
        const at = Date.parse(it.at)
        const left = Number.isFinite(at)
          ? Math.max(0, Math.round((at + it.turns * st.liveMinutes * 60000 - now) / 60000))
          : -1
        lines.push(`- [${left < 0 ? '没有时间戳' : left + ' 分钟后过期'}] ${it.text}`)
      }
      return lines.join('\n')
    },
  })

  reg({
    name: 'appear_inject_clear',
    description: '把实时注入全撤掉。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      const n = readLive(livePath).items.length
      writeLive(livePath, emptyLive())
      return n ? `撤了 ${n} 条。` : '本来就没有。'
    },
  })

  // 记「这一轮第几步」——全量注入只在第一步，后面只留锚点
  ctx.on('agent/pre-step', (payload, next) => {
    try { noteSessionWorkspace(payload) } catch { /* 拿不到就继续用旧的 */ }
    try { if (liveNow().noteSteps) noteStep(payload) } catch { /* 记步坏了不许拦路 */ }
    try { runPriority(cfg) } catch { /* 算坏了不许拦路，段里会写没算成 */ }
    return next()
  })

  // ── 设置页的两个口：读报当前真在用的值，写只收白名单并留 .bak ────────
  ctx.effect(() => ctx.webServer?.register({
    kind: 'exact',
    path: '/api/persona-appear/status',
    handler(_req, res) {
      try {
        const now = liveNow()
        sendJson(res, 200, {
          ok: true,
          fields: fieldTable(),
          values: pickCurrent(now),
          file: settingsPathNow(),
          fileExists: existsSync(settingsPathNow()),
        })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  }))

  ctx.effect(() => ctx.webServer?.register({
    kind: 'exact',
    path: '/api/persona-appear/config',
    async handler(req, res) {
      try {
        if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: '只收 POST' }); return }
        const raw = await readRequestBody(req)
        let patch = {}
        try { patch = normalizePatch(JSON.parse(raw || '{}')) } catch {
          sendJson(res, 400, { ok: false, error: '递上来的不是合法 JSON' }); return
        }
        if (!Object.keys(patch).length) {
          sendJson(res, 400, { ok: false, error: '没有一个字段过得了白名单（键名或范围不对）' }); return
        }
        const next = writeSettings(settingsPathNow(), patch)
        sendJson(res, 200, {
          ok: true,
          saved: Object.keys(patch),
          next,
          file: settingsPathNow(),
          note: '存好了。实时注入这几项每轮现读，下一轮就生效。',
        })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  }))


  reg({
    name: 'appear_priority',
    description: '看优先级台阶（人格 > 长期 > 即时 > 短期 > 其他 > 靠内置语料的非同一）：不给参数看台阶和最近的账；给 claims 就当场裁谁压谁。',
    parameters: {
      type: 'object',
      properties: {
        claims: { type: 'array', description: '要裁的几层说法：[{layer, text}]；layer 取 persona/longTerm/now/shortTerm/other/corpus' },
        limit: { type: 'number', description: '看最近几行账，默认 5' },
      },
      additionalProperties: false,
    },
    async run(args) {
      const claims = Array.isArray(args.claims) ? args.claims : []
      if (claims.length) {
        const out = adjudicate(claims)
        return [
          out.winner ? `赢的是：${out.winner.layer}（第 ${out.winner.rank} 级）——${out.winner.text}` : '没给可裁的层。',
          out.why,
        ].join('\n')
      }
      const lines = [
        '台阶（上面压下面，不看哪句更顺）：',
        ...ladderTable().map((r) => `  ${r.rank}. ${r.label}`),
        '',
        `这一轮在场：${presentLine(priorityNow.presence)}`,
      ]
      const rows = readPriority(ledgerPathOf(cfg), Number(args.limit) || 5)
      if (rows.length) {
        lines.push('', '最近的账：')
        for (const r of rows) lines.push(`  ${r.at} 第 ${r.step} 步（repeat=${r.repeat}）`)
      } else {
        lines.push('', '账还是空的——说明优先级一次都没算成，这是故障。')
      }
      lines.push('', '要裁一条：appear_priority claims=[{layer:"now",text:"..."},{layer:"longTerm",text:"..."}]')
      return lines.join('\n')
    },
  })
  return { statePath: p }
}

/**
 * 给别的注入者用的一句判定：这一家这一轮出不出场。
 * 注入者在自己的 section 回调里先问这一句，不问就不放行。
 */
export function appearAllows(workspaceRoot, plugin, stateDir = '.persona-framework') {
  const p = join(String(workspaceRoot || ''), stateDir, STATE_FILE)
  return allows(readState(p), plugin).allow
}

/**
 * 给别的注入者用的第二句：这一段该排第几。
 * 灌注者注册 section 时问它，不自己写死数字；闸里没记就用 fallback。
 */
export function appearOrderOf(workspaceRoot, section, fallback, stateDir = '.persona-framework') {
  const p = join(String(workspaceRoot || ''), stateDir, STATE_FILE)
  return orderOf(readState(p), section, fallback)
}
