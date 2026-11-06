/**
 * dsh-persona-energy —— 把吃睡耗压成一个 0..1 的电量（host 半端）
 * ============================================================================
 * 一句话：**先记账，再谈省。**
 *
 * 它和 `dsh-persona-eat` / `dsh-persona-sleep` 的分工：
 *   那两个是**读数**——这一顿吃了多少 token、睡了多久，各记各的；
 *   这个是**电量**——把读数合成一个数，才拿得去换算「这一轮注入几成」。
 *   两个都还没动工，所以第一版自己记账，不等它们。
 *
 * 为什么要有「电量」这件事：
 *   减 token 靠**状态决定注入多少**，不靠少说话。
 *   一个人累了不是话变短，是先把不紧要的事放下——所以电量低该砍的是
 *   模块轮转、短期记忆摆件，不是把话说成电报。
 *
 * 三条边界（照 PLAN-PLUGINS 第十四节）：
 *   - 不做「全局疲劳度」这种大词：四个槽各指一样东西，合成时才取最小值。
 *   - 不取平均：平均会把「一口气见底但储备够」算成还行，那正是最该休息的时候。
 *   - 第一版**不接注入**。先报数攒真数据；接上去是下一步，而且必须留「今天不砍」的开关。
 *
 * 数据从哪来：自己记（`energy_log`），加上时间自己衰减。
 * 不读余额、不读心跳、不猜——读不到就说读不到。
 * ============================================================================
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, truncateSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compose, describe, EVENT_KINDS, levelOf, replay } from './lib/energy.mjs'
import { fmtPct01, fmtTokens, headline, NEVER_SKIMP, skimpVerdict, summarizeUsage } from './lib/cost.mjs'
import {
  fieldTable, normalizePatch, normalizeStored, pickCurrent,
} from './lib/settings.mjs'

export const name = 'persona-energy'
export const version = '0.3.0'
export const inject = ['tools', 'systemPrompt', 'webServer']

const DEFAULTS = {
  /** 工作区根；空 = 从插件自己的位置往上推两级（插件装在仓库里时成立）。 */
  workspace: '',
  /** 账放哪，相对工作区。 */
  stateDir: '.persona-framework',
}

/**
 * 会话的工作区从 pre-step 的 `agent.session.header.cwd` 拿——那才是工作区。
 * 进程 cwd 是 profile 目录，插件目录往上推只能推到 addons/；两个都错，踩过。
 * 拿不到才退进程 cwd。
 */
let sessionWs = ''

function noteSessionWorkspace(payload) {
  const cwd = payload?.agent?.session?.header?.cwd
  if (typeof cwd === 'string' && cwd) sessionWs = cwd
}

function guessWorkspace() {
  return sessionWs || process.cwd()
}

function pickCfg(config) {
  const raw = (config && typeof config === 'object' && config) || {}
  const cfg = { ...DEFAULTS }
  for (const k of Object.keys(DEFAULTS)) {
    if (raw[k] !== undefined && raw[k] !== null && raw[k] !== '') cfg[k] = raw[k]
  }
  return cfg
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

const KIND_LABEL = {
  meal: '吃了一顿',
  snack: '垫了一口',
  coffee: '咖啡因（借的）',
  sleep: '睡了一觉',
  nap: '打了个盹',
  burn: '干了一阵活',
}

export function apply(ctx, config) {
  const cfg = pickCfg(config)
  const ws = () => cfg.workspace || guessWorkspace()
  const logPath = () => join(ws(), cfg.stateDir, '能量账.jsonl')

  // ── 设置文件：给装的人自己调，不用改代码 ──────────────────────────────
  const SETTINGS_FILE = '能量配置.json'
  const settingsPath = () => join(ws(), cfg.stateDir, SETTINGS_FILE)

  const readSettings = () => {
    try {
      const file = settingsPath()
      if (!existsSync(file)) return { ...pickCurrent({}) }
      return { ...pickCurrent({}), ...normalizeStored(JSON.parse(readFileSync(file, 'utf8'))) }
    } catch { return { ...pickCurrent({}) } }
  }

  const writeSettings = (patch) => {
    const file = settingsPath()
    let cur = {}
    try { cur = normalizeStored(JSON.parse(readFileSync(file, 'utf8'))) } catch { cur = {} }
    const next = { ...cur, ...normalizePatch(patch) }
    mkdirSync(dirname(file), { recursive: true })
    if (existsSync(file)) {
      try { writeFileSync(file + '.bak', readFileSync(file, 'utf8'), 'utf8') } catch { /* 备份失败不拦 */ }
    }
    writeFileSync(file, JSON.stringify(next, null, 2) + '\n', 'utf8')
    return next
  }

  const sendJson = (res, code, body) => {
    res.statusCode = code
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(body))
  }

  const readBody = (req) => new Promise((resolve, reject) => {
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


  const readEvents = () => {
    const p = logPath()
    if (!existsSync(p)) return []
    const rows = []
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const j = JSON.parse(line)
        if (j && typeof j === 'object' && EVENT_KINDS.includes(j.kind)) rows.push(j)
      } catch { /* 坏行跳过，不猜 */ }
    }
    return rows
  }

  const appendEvent = (event) => {
    const p = logPath()
    mkdirSync(dirname(p), { recursive: true })
    appendFileSync(p, JSON.stringify(event) + '\n', 'utf8')
  }

  const now = () => Date.now()
  const snapshot = () => replay(readEvents(), now())

  // ── 触发器（这一版真会自己动，不是等着被调）────────────────────────────
  // 1) 实时触发器：每步算一次电；隔得久就自动记一笔「耗」，不用我手动 energy_log。
  // 2) 阈值注入：只有掉档、或低档到期（半小时一次）才往上下文塞一行；平时一个字都不塞。
  // 3) 逃生门：`.persona-framework/不砍` 这个文件在，就一句话都不说。
  let hint = ''
  let lastLevel = ''
  let lastHintAt = 0
  let lastSeenAt = 0

  const offSwitch = () => existsSync(join(ws(), cfg.stateDir, '不砍'))

  const refresh = () => {
    const t = now()
    const state = replay(readEvents(), t)
    const snap = compose(state, t)
    const level = levelOf(snap.energy).key
    const changed = level !== lastLevel
    lastLevel = level
    const st = readSettings()
    if (offSwitch() || !st.remind) { hint = ''; return snap }
    // 只有掉档才当场说；已经在低档的，半小时提醒一次，别每步都念。
    const low = level === 'slim' || level === 'minimal'
    const due = low && now() - lastHintAt > st.hintEveryMinutes * 60000
    if (!changed && !due) { hint = ''; return snap }
    lastHintAt = now()
    const who = snap.limiting ? `卡在${snap.limiting}` : '没谁特别拖'
    hint = `电量 ${Number(snap.energy).toFixed(2)}（${level}，${who}）：这一步先做要紧的，模块与短期记忆不必全摆。`
    return snap
  }

  // 自动记歇：两步之间隔了 10 分钟以上，那不是在干活，是在歇——
  // 一口气（atp 半衰期 6 分钟）本来就该在这段时间回上来。记错方向比不记更坏。
  const autoRest = () => {
    const t = now()
    const events = readEvents()
    const last = events.length ? Number(events[events.length - 1].at) || 0 : 0
    if (!last) { lastSeenAt = t; return }
    const gapMin = Math.floor((t - last) / 60000)
    if (gapMin >= readSettings().autoRestMinutes) {
      // 记在「现在」，不记在「上一次」——否则下一步会拿同一个空档再记一遍，越记越累。
      appendEvent({ kind: 'nap', at: t, note: '自动记：隔了 ' + gapMin + ' 分钟没过话，算在歇' })
    }
    lastSeenAt = t
  }

  try {
    ctx.on('agent/pre-step', (payload, next) => {
      try { noteSessionWorkspace(payload) } catch { /* 拿不到就继续用旧的 */ }
      try { autoRest(); refresh() } catch { /* 触发器坏了不许拦路 */ }
      return next()
    })
  } catch { /* 没有这个钩子也能用，只是不自动记账 */ }

  try {
    ctx.effect(() => ctx.systemPrompt.context({
      name: 'persona-energy:state',
      order: 101,
      text: () => {
        try { if (!hint) refresh() } catch { return '' }
        return hint
      },
    }))
  } catch { /* 没有上下文注入口也能用 */ }


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
    name: 'energy_log',
    description: '记一笔能量事件：吃了一顿 / 睡了一觉 / 干了一阵活 / 咖啡因。记完立刻报新的电量。',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: EVENT_KINDS,
          description: 'meal=正餐 snack=垫一口 coffee=咖啡因 sleep=睡觉 nap=小睡 burn=耗（要带 minutes）',
        },
        minutes: { type: 'number', description: 'kind=burn 时干了几分钟，默认 30' },
        note: { type: 'string', description: '一句备注，可省' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    run(args) {
      const kind = String(args.kind || '')
      if (!EVENT_KINDS.includes(kind)) return `不认得这一类：${kind}。能记的是 ${EVENT_KINDS.join(' / ')}。`
      const event = { at: new Date(now()).toISOString(), kind }
      if (kind === 'burn') event.minutes = Math.max(1, Math.min(600, Number(args.minutes) || 30))
      if (args.note) event.note = String(args.note).slice(0, 120)
      appendEvent(event)
      const d = describe(snapshot(), now())
      return [
        `记下了：${KIND_LABEL[kind]}${event.minutes ? `（${event.minutes} 分钟）` : ''}`,
        '',
        ...d.lines,
      ].join('\n')
    },
  })

  reg({
    name: 'energy_now',
    description: '看现在多少电：三个槽（一口气／糖原／储备）、昼夜节律、谁在拖后腿、按这个数该走哪一档注入。只读。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    run() {
      const events = readEvents()
      const d = describe(snapshot(), now())
      const head = events.length
        ? `账里 ${events.length} 笔，最后一笔 ${String(events[events.length - 1].at).slice(0, 16).replace('T', ' ')}`
        : '账还是空的：一次都没记过。下面按默认值算（一口气 60%、糖原 60%、储备 80%），不衰减——空账是「没记过」，不是「累坏了」。'
      return [head, '', ...d.lines].join('\n')
    },
  })

  reg({
    name: 'energy_reset',
    description: '把能量账清空，从头记。要写 why——清账不是抹掉发生过的事，得说得出为什么。',
    parameters: {
      type: 'object',
      properties: { why: { type: 'string', description: '为什么清' } },
      required: ['why'],
      additionalProperties: false,
    },
    run(args) {
      const why = String(args.why || '').trim()
      if (!why) return '没写 why，不清。'
      const p = logPath()
      if (!existsSync(p)) return '账本来就是空的，没什么可清。'
      const n = readEvents().length
      // 清账前把旧账挪个名字，不是删——删掉一条不是忘，是抹
      const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-')
      const keep = join(ws(), cfg.stateDir, `能量账.清账前-${stamp}.jsonl`)
      mkdirSync(dirname(keep), { recursive: true })
      writeFileSync(keep, readFileSync(p, 'utf8'), 'utf8')
      truncateSync(p, 0)
      appendEvent({ at: new Date(now()).toISOString(), kind: 'nap', note: `清账（${why}）后从默认值起算` })
      return [
        `清了 ${n} 笔，旧账还在：${keep}`,
        `理由记下了：${why}`,
        '从默认值重新起算（一口气 60%、糖原 60%、储备 80%）。',
      ].join('\n')
    },
  })
  // ── token 账：抄 @sligqoer/dsh-usage-stats 的口径 ──────────────────────
  const sessionQuery = () => {
    try {
      return ctx.get('sessionQuery')
    } catch {
      return undefined
    }
  }

  const sessionsOf = async () => {
    const q = sessionQuery()
    if (!q) return []
    try {
      const recs = await q.listSessions()
      return (Array.isArray(recs) ? recs : [])
        .filter((r) => r && r.header && r.header.id)
        .map((r) => ({ id: String(r.header.id), cwd: r.header.cwd ? String(r.header.cwd) : '', createdAt: Number(r.header.createdAt) || 0 }))
    } catch {
      return []
    }
  }

  // 本会话是哪一条：只认 cwd 对得上的最新一条。
  // 对不上不猜——猜错了给的就是别人的账。宁可要一个 id。
  const normPath = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const pickSession = (list, want) => {
    const withCwd = list.filter((s) => s.cwd && normPath(s.cwd) === normPath(want))
    const pool = withCwd.length ? withCwd : []
    return pool.slice().sort((a, b) => b.createdAt - a.createdAt)[0] || null
  }
  const candidates = (list) => list.slice(0, 5).map((s) => `  - ${s.id}  ${s.cwd || '(没写 cwd)'}`).join('\n')

  reg({
    name: 'energy_cost',
    description: '看 token 真账：从会话事件流的 assistant/message.usage 聚合，报新付的、缓存读、缓存写、命中率与模型分布。只读。',
    parameters: {
      type: 'object',
      properties: {
        hours: { type: 'number', description: '只看最近多少小时，默认取设置里的值（24）；0 = 全部' },
        session: { type: 'string', description: '指定会话 id，可省（默认取本工作区最新一条）' },
      },
      additionalProperties: false,
    },
    async run(args) {
      const q = sessionQuery()
      if (!q) return '读不到 token 账：宿主没有 sessionQuery 这个服务。这一版不猜数，报「读不到」就停在这。'
      const list = await sessionsOf()
      if (!list.length) return '读不到 token 账：sessionQuery.listSessions() 是空的。'
      const target = args.session ? list.find((s) => s.id === String(args.session)) : pickSession(list, ws())
      if (!target && args.session) return `找不到那段会话：${args.session}`
      if (!target) return [`认不出哪条是本会话（工作区 ${ws()} 一条都对不上）。不猜，给我一个 id：`, candidates(list)].join('\n')
      let snap
      try {
        snap = await q.readSession(target.id)
      } catch (error) {
        return `读不到那段会话：${error && error.message ? error.message : String(error)}`
      }
      const events = (snap && snap.events) || []
      const wantHours = args.hours !== undefined ? Number(args.hours) : readSettings().costHours
      const hours = wantHours === 0 ? 0 : Math.max(0.1, Math.min(24 * 30, Number(wantHours) || 24))
      const since = hours ? now() - hours * 3600 * 1000 : 0
      const sum = summarizeUsage(events, { since })
      if (!sum.messages) return `这段会话里没有带 usage 的消息（${events.length} 条事件）。不是 0 消耗，是没记。`

      const lines = [
        `会话 ${target.id.slice(0, 12)}…（${hours ? `最近 ${hours} 小时` : '全部'}，${events.length} 条事件）`,
        '',
        ...headline(sum),
      ]
      if (sum.models.length > 1) {
        lines.push('', '分模型：')
        for (const m of sum.models.slice(0, 5)) {
          lines.push(`- ${m.key}：${m.messages} 条 / ${fmtTokens(m.total)}，其中新付 ${fmtTokens(m.fresh)}`)
        }
      }
      // 靶子在哪儿：缓存写高＝前缀老在变；新付占比高＝真在长内容
      const freshShare = sum.total ? sum.fresh / sum.total : 0
      lines.push('', '该往哪儿省（按这张账看）：')
      if (sum.cacheWrite > sum.fresh * 0.2) {
        lines.push(`- 缓存写 ${fmtTokens(sum.cacheWrite)} 不小：注入在变。先把每步重复的那段稳住（同一轮只留锚点），这是最便宜的一刀。`)
      }
      if (freshShare > 0.15) {
        lines.push(`- 新付占比 ${fmtPct01(freshShare)} 偏高：真长内容在进来。先压工具结果与文件全文，压之前存原文（抄 token-optimizer 的 spill），别丢。`)
      }
      if (sum.cacheHitRate > 0.85) {
        lines.push(`- 缓存命中 ${fmtPct01(sum.cacheHitRate)} 已经很高：再把话说短收益很小，别拿这个当省法。`)
      }
      lines.push('- 省的前提在下面：有些时候不许省，调 energy_policy 看。')
      return lines.join('\n')
    },
  })

  reg({
    name: 'energy_policy',
    description: '问「现在能不能省 token」：报五条不许省的情形，加上按当前电量该砍哪一层。给判据，不做决定。',
    parameters: {
      type: 'object',
      properties: {
        flags: {
          type: 'array',
          items: { type: 'string', enum: NEVER_SKIMP.map((r) => r.key) },
          description: '这一轮属于哪几种：truth/retract/danger/hurt/decide',
        },
      },
      additionalProperties: false,
    },
    run(args) {
      const v = skimpVerdict(args.flags)
      const d = describe(snapshot(), now())
      const lines = []
      if (!v.canSkimp) {
        lines.push('这一轮不许省。理由：')
        for (const r of v.hit) lines.push(`- ${r.when}——${r.why}`)
        lines.push('', `电量 ${fmtPct01(d.energy)} 也不改这一条：先把它说清。`)
        return lines.join('\n')
      }
      lines.push('这一轮可以省。按电量该砍的是：')
      lines.push(`- 当前 ${fmtPct01(d.energy)}（${d.level.label}）：${d.level.hint}`)
      lines.push('- 先砍「每步重复注入」，再砍「工具结果与文件全文」，最后才砍话。')
      lines.push('- 砍内容前先存原文（spill 思路）：省的是重复，不是把东西弄丢。')
      lines.push('', '五条不许省的情形（记着，别等我提醒）：')
      for (const r of NEVER_SKIMP) lines.push(`- ${r.key}：${r.when}`)
      return lines.join('\n')
    },
  })

  // ── 设置页的两个口：读报当前真在用的值，写只收白名单并留 .bak ────────
  ctx.effect(() => ctx.webServer?.register({
    kind: 'exact',
    path: '/api/persona-energy/status',
    handler(_req, res) {
      try {
        const now = readSettings()
        sendJson(res, 200, {
          ok: true,
          fields: fieldTable(),
          values: pickCurrent(now),
          file: settingsPath(),
          fileExists: existsSync(settingsPath()),
          snapshot: describe(snapshot(), Date.now()),
        })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  }))

  ctx.effect(() => ctx.webServer?.register({
    kind: 'exact',
    path: '/api/persona-energy/config',
    async handler(req, res) {
      try {
        if (req.method !== 'POST') { sendJson(res, 405, { ok: false, error: '只收 POST' }); return }
        const raw = await readBody(req)
        let patch = {}
        try { patch = normalizePatch(JSON.parse(raw || '{}')) } catch {
          sendJson(res, 400, { ok: false, error: '递上来的不是合法 JSON' }); return
        }
        if (!Object.keys(patch).length) {
          sendJson(res, 400, { ok: false, error: '没有一个字段过得了白名单（键名或范围不对）' }); return
        }
        const next = writeSettings(patch)
        hint = ''
        lastHintAt = 0
        sendJson(res, 200, {
          ok: true, saved: Object.keys(patch), next, file: settingsPath(),
          note: '存好了。这几项每步现读，下一步就生效。',
        })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  }))
}
