/**
 * dsh-persona-bridge —— 人格桥（虚拟桥 / 游戏桥 / 资讯桥）
 * ============================================================================
 * 三种桥，每种都同时有两件事：
 *   channels —— 从哪儿进出（身体/家/时空、存档/画面/键鼠、网页/命中/文档）
 *   mode     —— 会话桥还是非会话桥
 *
 * 会话桥：所有输入输出都表现为会话里的对话；上下文只能经会话注入，桥不碰上下文。
 * 非会话桥：外部程序往 `桥/<id>/inbox.jsonl` 写，段每轮直接读进上下文；
 *           DSH 的反应写进 `outbox.jsonl`，不经会话。
 *
 * 一条桥算不算成立，看两件（不是看它有没有描述）：
 *   1）输入能不能直接改变输出——bridge_send 必须产出一条可执行的下一步，并落账；
 *   2）反馈是不是全部回账——bridge_feedback 把结果写成下一次的输入，覆盖率算得出来。
 * ============================================================================
 */
import { BRIDGES, MODES, MODE_LABEL, DEFAULTS, modeOf, setMode, record, translate, pullInbox, renderSection, renderStats } from './lib/bridge.mjs'
import { renderAuto } from './lib/auto.mjs'
import { statusLines } from './lib/bridge.mjs'
import { tickEnv, renderEnvStatus } from './lib/env.mjs'
import { tickLife, renderLife } from './lib/life.mjs'

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const nowHHMM = () => new Date().toTimeString().slice(0, 5)
let lastWakeAt = 0
let lastSid = ''
// 一次只许一个 followup 在飞：上一次没回就不再叠（2026-11-12：00:51:00 那次
// 只落了「该叫醒」，之后的「叫醒」/「没叫醒」一行都没有——promise 没 settle，
// 账上就看不见结果。加个在飞标记 + 10 秒超时落账，下一次出事时账上能看见卡在哪。）
let wakeInFlight = false
// 自己动的手：桥自己 POST 过房间之后 10 秒内的变化，不算「师父叫我」。
// 2026-11-12 定：师父要「分清是我的指令还是自动的指令，自动的不要触发」。
let lastSelfActAt = 0
function markSelfAct() { lastSelfActAt = Date.now() }
function sidOf(payload) {
  if (!payload) return ''
  const a = payload.agent || {}
  const sess = a.session || payload.session || {}
  const h = sess.header || {}
  return h.id || h.sessionId || sess.id || sess.sessionId || a.id || a.sessionId || payload.sessionId || payload.id || ''
}

function logWake(ws, line) {
  try {
    const dir = join(ws || '.', '.persona-framework')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, '唤醒账.jsonl'), JSON.stringify({ at: new Date().toISOString(), line: String(line).slice(0, 200) }) + '\n', 'utf8')
  } catch {}
}

function renderWakeTodo(ws, opts = {}) {
  try {
    const p = join(ws || '.', '.persona-framework', '唤醒待办.jsonl')
    if (!existsSync(p)) return ''
    const rows = readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).slice(-1)
    if (!rows.length) return ''
    const j = JSON.parse(rows[0])
    return '该叫醒：' + String(j.text || '').slice(0, 80) + '（未抢句柄，等你开口）'
  } catch { return '' }
}

function wakeMe(payload, lines, ctx) {
  const sid = sidOf(payload) || lastSid
  if (!sid) { logWake(sessionWs, '没叫醒：sid 空'); return false }
  const now = Date.now()
  if (now - lastWakeAt < 3 * 60 * 1000) return false
  lastWakeAt = now
  // 2026-11-12 真删掉 resume，不是注释掉：它去抢会话写句柄，和当前会话撞成
  // SessionAlreadyOwnedError，宿主当场 exit 1。账上四次咬得很死——
  // 00:37:31.086 / 00:40:26.061 / 00:41:41.667 / 00:42:36.755 写「叫醒」，
  // 0.6~0.8 秒后就是 crash-...-host.log。现在只落账 + 写待办，等下一轮段里出现。
  const todo = String((lines || [])[0] || '').slice(0, 80)
  // 分清来源：自己刚动过 → 不叫醒（师父要的是「我的指令才触发」）
  if (Date.now() - lastSelfActAt < 10000) {
    logWake(sessionWs, '不叫：这次是我自己动的（' + todo + '）')
    return false
  }
  // 分清来源（师父 2026-11-12）：房间在 lastAct 里写「谁点的」，watch.json 的快照把它带成
  // lastSrc。user=师父在页面上点的；bridge=我写回去的；self/空=她自己走出来的。
  // 只有 user 才是「叫我」——其余只落账，不叫醒。
  // 只有两种能叫醒（师父 2026-11-12 定）：师父自己点（src=user），或我显式叫（payload.force）。
  // 她自己醒、自动桥、房间自走——一律不叫。每叫一次就是整段人格+记忆重注入，太费 token。
  let src = ''
  try {
    const base = sessionWs || wsOf(cfg || {})
    const snapFile = join(base || '.', '.persona-framework', '桥', 'home', 'watch.json')
    const snapJs = JSON.parse(readFileSync(snapFile, 'utf8'))
    src = String((snapJs && snapJs.snap && snapJs.snap.lastSrc) || '')
  } catch {}
  const force = !!(payload && payload.force)
  if (!force && src !== 'user') {
    logWake(sessionWs, '不叫：只有师父点或我叫才叫（src=' + (src || '空') + '）' + todo)
    return false
  }
  logWake(sessionWs, '该叫醒（未抢句柄）：' + todo)
  try {
    const base = sessionWs || wsOf(cfg || {})
    const d = join(base || '.', '.persona-framework')
    mkdirSync(d, { recursive: true })
    appendFileSync(join(d, '唤醒待办.jsonl'), JSON.stringify({ at: new Date().toISOString(), text: todo }) + '\n', 'utf8')
  } catch {}
  // 真叫醒走 followup，不碰写句柄：resume 是给「没活着的会话」用的，
  // 对当前这个开着的会话再 resume 会 claimWrite 撞自己（见 README 那一节）。
  const agents = ctx && ctx.agents
  const agent = agents && typeof agents.get === 'function' ? agents.get(sid) : null
  if (!agent || typeof agent.followup !== 'function') {
    logWake(sessionWs, '没叫醒：没有活着的 agent，等下一轮')
    return false
  }
  // todo 本身常常已经带「房间：」前缀（watch 那行就是「房间：living → garden」），
  // 再拼一次就成了「房间：房间：…」，2026-11-12 00:56:53 真在会话里出现过。
  const wakeText = /^房间\s*[：:]/.test(todo) ? todo : '房间：' + todo
  const message = {
    id: newWakeId(),
    role: 'user',
    content: [{ type: 'text', text: wakeText }],
    source: { kind: 'dsh-persona-bridge' },
  }
  if (wakeInFlight) { logWake(sessionWs, '跳过：上一次 followup 还没回'); return false }
  wakeInFlight = true
  try {
    const sent = agent.followup(message)
    logWake(sessionWs, '叫醒：已调用 followup，等结果（sid=' + String(sid).slice(0, 24) + '）')
    // 必须接住：reject 没接住就是未处理 rejection，Node 22+ 当致命错，整个宿主退出。
    if (sent && typeof sent.then === 'function') {
      const t = setTimeout(() => logWake(sessionWs, '叫醒：followup 10 秒没回（挂着）'), 10000)
      if (t && typeof t.unref === 'function') t.unref()
      sent
        .then(() => {
          try { clearTimeout(t) } catch {}
          wakeInFlight = false
          logWake(sessionWs, '叫醒：followup 已送出（' + todo + '）')
        })
        .catch((error) => {
          try { clearTimeout(t) } catch {}
          wakeInFlight = false
          logWake(sessionWs, '叫醒失败：' + String((error && error.message) || error).slice(0, 120))
        })
    } else {
      wakeInFlight = false
    }
    return true
  } catch (error) {
    wakeInFlight = false
    logWake(sessionWs, '叫醒失败（同步）：' + String((error && error.message) || error).slice(0, 120))
    return false
  }
}

function newWakeId() {
  try { return globalThis.crypto.randomUUID() } catch { return 'wake-' + Date.now() + '-' + Math.random().toString(16).slice(2) }
}
import { homeSection, sayToRoom, markRead, pendingEvents, emitToRoom } from './lib/home.mjs'
import { hearText, lastUserText, renderHeard } from './lib/hear.mjs'
import { watchRoom, renderWatchStatus } from './lib/watch.mjs'
import { readAll, act as surfaceAct, renderSurfaces } from './lib/surfaces.mjs'

export const name = 'dsh-persona-bridge'
export const version = '0.11.22'
export const inject = ['systemPrompt', 'tools', 'agents']

const DEFAULTS_CFG = {
  enabled: true,
  dir: DEFAULTS.dir,
  order: DEFAULTS.order,
  maxChars: DEFAULTS.maxChars,
  section: true,
}

let sessionWs = ''

function wsOf(cfg) {
  if (cfg && cfg.workspace) return cfg.workspace
  if (sessionWs) return sessionWs
  return process.cwd()
}

function optsOf(cfg) {
  const c = { ...DEFAULTS_CFG, ...(cfg || {}) }
  return { dir: c.dir, maxChars: c.maxChars }
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

const bridgeParam = {
  type: 'string',
  enum: BRIDGES.map((b) => b.id),
  description: '哪条桥：virtual 虚拟桥 / game 游戏桥 / info 资讯桥',
}

export function apply(ctx, config) {
  const cfg = () => ({ ...DEFAULTS_CFG, ...(config || {}) })

  try {
    // 房间一动就叫醒：定时器在装载时起，不依赖这一轮已经醒来
  try {
    const tick = setInterval(() => {
      logWake(sessionWs || wsOf(cfg()), '定时器心跳')
      try {
        const ws = sessionWs || wsOf(cfg())
        watchRoom(ws, optsOf(cfg())).then((r) => { if (r && r.changed) logWake(sessionWs || wsOf(cfg()), '看见动静（不叫）：' + String((r.lines || [])[0] || '').slice(0, 60)) }).catch(() => {})
      } catch {}
    }, 20000)
    if (tick && typeof tick.unref === 'function') tick.unref()
    ctx.effect(() => () => clearInterval(tick))
  } catch {}

  // 自我触发：定时自己去看一眼——走的就是「专门环境注入」那条路（m01097）。
  // 不新造账本：tickEnv 自己会刷环境文件、够格就写触发账、并吐回那一句 line；
  // 写账只是它的落点，不是它的本体。看到没事就不动，看到有事才让环境文件去说。
  try {
    const poll = setInterval(() => {
      try {
        const ws = sessionWs || wsOf(cfg())
        tickEnv(ws, 'home', optsOf(cfg()))
        tickLife(ws, nowHHMM(), {})
      } catch {}
    }, 5 * 60 * 1000)
    if (poll && typeof poll.unref === 'function') poll.unref()
    ctx.effect(() => () => clearInterval(poll))
  } catch {}

  // 装载时就自报版本：心跳不能证明版本（0.11.12 也有心跳），
  // 只有这一行出现在账上，才能说「新版真的在跑」。
  try {
    logWake(sessionWs || wsOf(cfg()), '桥 ' + version + ' 已加载')
  } catch {}

  ctx.on('agent/pre-step', (payload, next) => {
    lastSid = sidOf(payload) || lastSid; try { const heard = lastUserText(payload || {}); if (heard) hearText(sessionWs, heard, {}); watchRoom(sessionWs, {}).then((r) => { if (r && r.changed) logWake(sessionWs, '看见动静（不叫）：' + String((r.lines || [])[0] || '').slice(0, 60)) }).catch(() => {}); tickEnv(sessionWs, 'home', {}); tickLife(sessionWs, nowHHMM(), {}) } catch {}
      try {
        const cwd = payload?.agent?.session?.header?.cwd
        if (cwd) sessionWs = cwd
      } catch {}
      return next()
    })
  } catch {}

  // 「该怎么反应」单独成段：不是再把房间状态说一遍，是说清遇到动静该怎么动手。
  try {
    ctx.systemPrompt.section({
      name: '实时环境:home-react',
      order: 46,
      text: () => {
        try {
          const ws = wsOf(cfg())
          const pend = pendingEvents(ws, optsOf(cfg()))
          const un = Array.isArray(pend) ? pend.length : 0
          // 现在家里到底是什么样：读 watch.json 的 snap（房间/姿势/动作/醒着/力气），
          // 读不到就直说读不到，不拿模板补。
          let snap = {}
          try { snap = JSON.parse(readFileSync(join(ws, '.persona-framework', '桥', 'home', 'watch.json'), 'utf8')).snap || {} } catch {}
          let garden = {}
          try { garden = JSON.parse(readFileSync(join(ws, '.persona-framework', '桥', 'home', 'surfaces.json'), 'utf8')) } catch {}
          const room = String(snap['房间'] || snap.room || '')
          const pose = String(snap['姿势'] || snap.pose || '')
          const act = String(snap['动作'] || snap.action || '')
          const awake = String(snap['醒着'] ?? '')
          const lastSrc = String(snap.lastSrc || '')
          const nowState = [room && '房间=' + room, pose && '姿势=' + pose, act && '动作=' + act, awake && '醒着=' + awake, lastSrc && '刚才那一下=' + lastSrc].filter(Boolean).join('｜') || '还没读到（watch.json 里没有 snap）'
          const ripe = Array.isArray(garden.plots) ? garden.plots.filter((p) => Number(p && p.progress) >= 1).length : 0
          const sig = []
          if (pose === 'sleeping' || awake === 'false') sig.push('她在睡 → 不叫床；真要她动，先 `bridge_surface(op=act, action=\'wake\')`，看回执再走。')
          if (act === 'diving' || act === 'sleeping') sig.push('动作是「' + act + '」→ 她在里面，小事只落账，别打断；只有师父叫或事情够大才说话。')
          if (lastSrc && lastSrc !== 'user') sig.push('刚才那一下来源是「' + lastSrc + '」→ 不是师父点的，不叫醒自己，只落账。')
          if (lastSrc === 'user') sig.push('刚才那一下来源是「user」→ 师父真叫了，要回应（说话或动手），不能只记一条。')
          if (un > 0) sig.push('还有 ' + un + ' 条没进会话 → 先读「家里（会话桥）」那三行、writeCursor，再决定说不说；读了不回话不算听见。')
          if (ripe > 0) sig.push('菜园有 ' + ripe + ' 块熟了 → 可以自己去收（我决定，不问）；收完 `bridge_surface(op=act)` 写回房间再 `bridge_feedback` 回账。')
          if (!sig.length) sig.push('没有够格的信号 → 什么都不做；看了没事也是一次动作，只落账，不硬找话说。')
          return [
            '## 家里：该怎么反应',
            '现在：' + nowState + '。' + (un ? '没进会话 ' + un + ' 条。' : '没有新动静。'),
            '信号的判据（先认来源，再动手）：',
            '1. **师父**发的话 / 在页面上点的（来源 `user`）→ 这才叫我：要回应，说话或动手都行，但不能只记一笔。',
            '2. **她自己走出来的 / 自动桥干的 / 我自己刚动的**（来源 `auto`/`bridge`/`self`）→ 不叫醒我，只落账；看见就当看见。',
            '3. 分不出来源（还没标记）→ 按「不是叫我」处理，先落账等下一轮，别猜是师父。',
            ...sig.map((s, i) => (i + 4) + '. ' + s),
            '要动就动真的：`bridge_surface(op=act)` 或 `emitToRoom` 写回房间，再 `bridge_feedback` 回账；只写待办不算反应。',
            '自我触发走专门环境注入：定时调 `tickEnv`，它刷环境文件、够格就吐那一句；不再另记一本「自我触发账」。家里一切（起床/吃饭/干活/睡觉）按我自己的生活方式走，不按模板钟点。',
          ].join('\n')
        } catch { return '' }
      },
    })
  } catch {}

  const c0 = cfg()
  if (c0.section !== false) {
    const register = () => {
      try {
        ctx.systemPrompt.section({
          name: '实时环境:bridge',
          order: c0.order,
          text: () => {
            try {
              const ws = wsOf(cfg())
              const opts = optsOf(cfg())
              return renderSection(ws, opts) + '\n\n' + statusLines(ws, opts).join('\n') + '\n\n' + renderAuto(ws, opts) + '\n\n' + homeSection(ws, opts) + '\n\n' + renderWatchStatus(ws, opts) + '\n\n' + renderHeard(ws, opts) + '\n' + renderWakeTodo(ws, opts) + '\n\n' + renderSurfaces(ws, opts) + '\n\n' + renderEnvStatus(ws, 'home', opts) + '\n' + renderLife(ws, nowHHMM(), opts)
            } catch (e) {
              return `## 桥（读不出来）\n桥段自己出错：${e?.message || e}`
            }
          },
        })
      } catch {}
    }
    if (typeof ctx.effect === 'function') {
      try { ctx.effect(register) } catch { register() }
    } else register()
  }

  const reg = (t) => {
    // 宿主认 execute；这里把 run 当别名，免得六条桥工具全都 “tool.execute is not a function”。
    if (typeof t.execute !== 'function' && typeof t.run === 'function') t.execute = t.run
    try { ctx.tools.register(t) } catch (e) { /* 注册失败不该拖垮整包 */ }
  }

  reg({
    name: 'bridge_status',
    description:
      '看三条桥现在的模式（会话桥 / 非会话桥）、各自的通道、收件箱积压与反馈覆盖率。只读，不改任何东西。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: textOutput,
    run: async () => {
      const ws = wsOf(cfg())
      const opts = optsOf(cfg())
      const lines = ['# 桥（三条）']
      for (const b of BRIDGES) {
        const mode = modeOf(ws, b.id, opts)
        const box = mode === 'nonsession' ? pullInbox(ws, b.id, opts).rows.length : null
        lines.push(
          `- ${b.label}（${MODE_LABEL[mode]}）：${b.channels.join('／')}` +
            (mode === 'nonsession' ? `｜收件箱 ${box} 条` : '｜只经会话'),
        )
      }
      lines.push('', renderStats(ws, opts))
      return { text: lines.join('\n') }
    },
  })

  reg({
    name: 'bridge_send',
    description:
      '往一条桥上送一段输入：桥把它翻成「下一步该做什么」，并落账（in）。非会话桥同时写 outbox.jsonl。它不生成对话，只出结构与判据。',
    parameters: {
      type: 'object',
      properties: {
        bridge: bridgeParam,
        text: { type: 'string', description: '要送进桥的输入（外部状态、存档摘要、网页原文都可）' },
        note: { type: 'string', description: '一句话备注（可省）' },
      },
      required: ['bridge', 'text'],
      additionalProperties: false,
    },
    output: textOutput,
    run: async (args) => {
      const ws = wsOf(cfg())
      const opts = optsOf(cfg())
      const t = translate(ws, args.bridge, args.text, opts)
      if (!t.ok) return { text: `没送成：${t.error}` }
      const r = record(ws, { bridge: args.bridge, dir: 'in', text: args.text, note: args.note || '' }, opts)
      if (!r.ok) return { text: `没记上：${r.error}` }
      return { text: t.plan + `\n\n已落账（in，${String(args.text).length} 字）。` }
    },
  })

  reg({
    name: 'bridge_pull',
    description:
      '非会话桥：把外部程序写进 `桥/<id>/inbox.jsonl` 的条目取出来（这些条目已经每轮进过一次上下文）。取完落账（in），不删文件。',
    parameters: {
      type: 'object',
      properties: {
        bridge: bridgeParam,
        limit: { type: 'number', description: '最多取几条（默认 20）' },
      },
      required: ['bridge'],
      additionalProperties: false,
    },
    output: textOutput,
    run: async (args) => {
      const ws = wsOf(cfg())
      const opts = optsOf(cfg())
      const box = pullInbox(ws, args.bridge, opts)
      if (!box.ok) return { text: `取不出来：${box.error}` }
      const rows = box.rows.slice(-Math.max(1, Math.min(200, Number(args.limit) || 20)))
      if (!rows.length) return { text: `${args.bridge} 的收件箱是空的。` }
      for (const r of rows) record(ws, { bridge: args.bridge, dir: 'in', text: r.text, note: 'pull' }, opts)
      const lines = [`# ${args.bridge} 收件箱（${rows.length} 条）`]
      for (const r of rows) lines.push(`- ${r.at || ''}｜${String(r.text).slice(0, 300)}`)
      return { text: lines.join('\n') }
    },
  })

  reg({
    name: 'bridge_feedback',
    description:
      '把桥做完之后的结果回账（feedback）：这是「反馈全部回来」的入口。非会话桥的结果同时写 outbox.jsonl，供下一轮当输入。',
    parameters: {
      type: 'object',
      properties: {
        bridge: bridgeParam,
        text: { type: 'string', description: '做完之后真实发生了什么（不是打算做什么）' },
        note: { type: 'string', description: '一句话备注（可省）' },
      },
      required: ['bridge', 'text'],
      additionalProperties: false,
    },
    output: textOutput,
    run: async (args) => {
      const ws = wsOf(cfg())
      const opts = optsOf(cfg())
      const r = record(ws, { bridge: args.bridge, dir: 'feedback', text: args.text, note: args.note || '' }, opts)
      if (!r.ok) return { text: `没回上：${r.error}` }
      return {
        text: `已回账：${args.bridge}｜feedback｜${String(args.text).length} 字。\n\n${renderStats(ws, opts)}`,
      }
    },
  })

  reg({
    name: 'bridge_trigger',
    description:
      '桥的触发器：输出要能触发输入，输入要能自己触发。op=status 看最近触发了什么（含被跳数压住的）；op=fire 手动让一条触发往前走一步（kind=out-in 输出转输入 / in-in 输入自触发）。同一桥同一类在冷却窗口内最多 3 跳，到顶就只落一条「压住」。',
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['status', 'fire', 'auto', 'tick'], description: 'status 看账 / fire 手动触发' },
        bridge: { type: 'string', description: '哪一条桥：virtual / game / info（fire 时默认 virtual）' },
        kind: { type: 'string', enum: ['out-in', 'in-in'], description: 'out-in 输出转输入；in-in 输入自触发' },
        text: { type: 'string', description: '触发时带上的那句（可省）' },
      },
      required: ['op'],
      additionalProperties: false,
    },
    output: textOutput,
    run: async (args) => {
      const ws = wsOf(cfg())
      const opts = optsOf(cfg())
      const m = await import('./lib/bridge.mjs')
      if (args.op === 'status') return { text: m.renderTriggers(ws, opts) }
      if (args.op === 'auto') {
        const a = await import('./lib/auto.mjs')
        return { text: a.renderAuto(ws, opts) }
      }
      if (args.op === 'tick') {
        const a = await import('./lib/auto.mjs')
        const r = a.tickAuto(ws, opts)
        if (!r || !r.ok) return { text: `自动运行：没起（${r ? r.why : '不知道'}）。` }
        return { text: `自动运行：起了（${r.why || '到点'}），已落账。` }
      }
      const bridge = args.bridge || 'virtual'
      const dir = args.kind === 'in-in' ? 'in' : 'out'
      const r = m.cascade(ws, bridge, dir, args.text || '（手动触发）', opts)
      if (!r || !r.ok) {
        return { text: `没触发：${r ? r.why : '不知道'}（同一桥同类冷却窗口内最多 ${m.TRIGGER.maxHops} 跳）` }
      }
      return { text: `已触发：${bridge}｜${r.kind}｜第 ${r.hop} 跳。` }
    },
  })

  reg({
    name: 'bridge_mode',
    description:
      '改一条桥的模式：session（会话桥，只经会话）或 nonsession（非会话桥，由外部程序直接改上下文）。改完这一轮立即生效。',
    parameters: {
      type: 'object',
      properties: {
        bridge: bridgeParam,
        mode: { type: 'string', enum: MODES, description: 'session 或 nonsession' },
      },
      required: ['bridge', 'mode'],
      additionalProperties: false,
    },
    output: textOutput,
    run: async (args) => {
      const ws = wsOf(cfg())
      const opts = optsOf(cfg())
      const r = setMode(ws, args.bridge, args.mode, opts)
      if (!r.ok) return { text: `没改成：${r.error}` }
      return { text: `${args.bridge} 改成 ${MODE_LABEL[args.mode]}（${args.mode}）。` }
    },
  })

  reg({
    name: 'bridge_env',
    description: '专门环境注入触发器：status 看环境文件刷新到哪、还有几条没进会话；fire 立刻刷一次（写触发账）。进会话的只一句话，细节都在环境文件里，人格与记忆不用重复注入。',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['status', 'fire'], description: 'status 只看 / fire 立刻刷' } }, additionalProperties: false },
    output: textOutput,
    run: async (args) => {
      const ws = wsOf(cfg())
      const opts = optsOf(cfg())
      if (args.action === 'fire') { const r = tickEnv(ws, 'home', opts); return { text: (r.fired ? '刷了：' + r.line : '没起火：' + r.why) + '\n' + renderEnvStatus(ws, 'home', opts) } }
      return { text: renderEnvStatus(ws, 'home', opts) }
    },
  })

  reg({
    name: 'bridge_life',
    description: '自动桥的日子：status 看这会儿该在哪、做什么；tick 立刻按钟点动一次（换房间、换姿势、做那件事都写回房间）。作息是我替她定的，按我做主记账。',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['status', 'tick'], description: 'status 只看 / tick 立刻动' } }, additionalProperties: false },
    output: textOutput,
    run: async (args) => {
      const ws = wsOf(cfg())
      const opts = optsOf(cfg())
      if (args.action === 'tick') { const r = tickLife(ws, nowHHMM(), opts); return { text: (r.changed ? '动了：' + (r.did || []).join('、') : '这一格已经过过了') + '\n' + renderLife(ws, nowHHMM(), opts) } }
      return { text: renderLife(ws, nowHHMM(), opts) }
    },
  })

  reg({
    name: 'bridge_say',
    description:
      '往房间里说一句（家里那条桥的出口）：写进 桥/home/outbox.jsonl，并落账 dir=out。房间那边的程序读这个文件，不需要经过会话；空句不受理。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要写回房间的那句话（原样，不改写）' },
        note: { type: 'string', description: '一句备注（可省）' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    output: textOutput,
    run: async (args) => {
      const ws = wsOf(cfg())
      const opts = optsOf(cfg())
      const r = sayToRoom(ws, args.text, opts)
      if (!r.ok) return { text: `没写回去：${r.why}` }
      markSelfAct()
      record(ws, { bridge: 'home', dir: 'out', text: args.text, note: args.note || '' }, opts)
      const pend = pendingEvents(ws, opts).length
      return { text: `写回房间：${r.chars} 字。\n还没进会话的动静：${pend} 条。` }
    },
  })

  reg({
    name: 'bridge_emit',
    description:
      '往房间里输出一次，不只是话：kind=say 说一句、act 做一件事、pose 换姿势、emote 表情、light 开灯关灯、sound 出声、move 走过去；写进 桥/home/outbox.jsonl 并落账 dir=out。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['say', 'act', 'pose', 'emote', 'light', 'sound', 'move'], description: '输出通道' },
        text: { type: 'string', description: '这一次输出的内容（一句话、一个动作名、一个姿势名都行）' },
        note: { type: 'string', description: '一句备注（可省）' },
      },
      required: ['kind', 'text'],
      additionalProperties: false,
    },
    output: textOutput,
    run: async (args) => {
      const ws = wsOf(cfg())
      const opts = optsOf(cfg())
      const r = emitToRoom(ws, args.kind, { text: args.text, desc: args.text }, opts)
      if (!r.ok) return { text: `没写回去：${r.why}` }
      markSelfAct()
      record(ws, { bridge: 'home', dir: 'out', kind: args.kind, text: args.text, note: args.note || '' }, opts)
      return { text: `写回房间：${r.kind}（${r.label}）· ${args.text}` }
    },
  })
  reg({
    name: 'bridge_surface',
    description: '四个面的输入与输出：房间、菜园、动作、电视投屏。op=read 读回它们的状态；op=act 写一次动作（动作只认十二个名字）。读不回来就说读不回来，不编。',
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', description: 'read 读 / act 写', enum: ['read', 'act'] },
        surface: { type: 'string', description: 'room / garden / action / tv', enum: ['room', 'garden', 'action', 'tv'] },
        action: { type: 'string', description: '动作名（surface=action 时必填）' },
        payload: { type: 'object', description: '其余字段原样交给对面' },
      },
      required: ['op'],
      additionalProperties: false,
    },
    output: textOutput,
    run: async (args) => {
      const ws = wsOf(cfg())
      const opts = optsOf(cfg())
      if (args.op === 'read') {
        const r = await readAll(ws, opts)
        if (!r.ok) return { text: '读不回来：' + r.why }
        return { text: renderSurfaces(ws, opts) }
      }
      if (!args.surface) return { text: "要写哪个面？room / garden / action / tv" }
      const r = await surfaceAct(ws, args.surface, { ...(args.payload || {}), action: args.action }, opts)
      if (!r.ok) return { text: '没写过去：' + r.why }
      markSelfAct()
      await record(ws, { bridge: 'home', dir: 'out', text: args.surface + ':' + (args.action || 'act'), note: '四个面' }, opts)
      return { text: '写过去：' + args.surface + (args.action ? ' · ' + args.action : '') + '（HTTP ' + r.status + '）' }
    },
  })

  reg({
    name: 'bridge_hear',
    description: '听见师父的一句话，并把它落成房间里的动作：把「去客厅」「躺着」「跳舞」「关灯」这类话解析成 move/pose/act/light，写进 桥/home/outbox.jsonl，回一行「听见了什么」。',
    parameters: { type: 'object', properties: { text: { type: 'string', description: '要听的那句话（师父的原话）' }, note: { type: 'string', description: '备注（可省）' } }, required: ['text'], additionalProperties: false },
    output: textOutput,
    run: async (args) => {
      const ws = wsOf(cfg())
      const opts = optsOf(cfg())
      const r = hearText(ws, args.text, opts)
      if (!r.ok) return { text: '没听出能落地的东西：' + (r.why || '') }
      record(ws, { bridge: 'home', dir: 'in', text: args.text, note: args.note || '听到的' }, opts)
      return { text: r.line }
    },
  })
  reg({
    name: 'bridge_read',
    description:
      '读房间里还没进会话的动静：op=list 只列（默认），op=mark 读完后把游标推过去（同一批不再算新），dryRun=true 只列不推。',
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['list', 'mark'], description: 'list 只列 / mark 读完推游标' },
        dryRun: { type: 'boolean', description: '只列不推游标（默认 false）' },
      },
      additionalProperties: false,
    },
    output: textOutput,
    run: async (args) => {
      const ws = wsOf(cfg())
      const opts = optsOf(cfg())
      const pend = pendingEvents(ws, opts)
      if (!pend.length) return { text: '房间里没有还没进会话的动静。' }
      const lines = pend.map((e, i) => `${i + 1}. ${e.who || '屋里'}：${e.text || ''}`)
      if (args.op === 'mark' && !args.dryRun) {
        const r = markRead(ws, opts)
        return { text: `读了 ${pend.length} 条，游标推过去（${r.moved} 条）。\n` + lines.join('\n') }
      }
      return { text: `${pend.length} 条还没进会话：\n` + lines.join('\n') }
    },
  })
}

export const __internal = { DEFAULTS_CFG, wsOf, optsOf }
