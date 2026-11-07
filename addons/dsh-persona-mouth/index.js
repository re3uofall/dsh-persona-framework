/**
 * dsh-persona-mouth —— 嘴（host 半端）
 * ============================================================================
 * 一句话：**说「真说出去了」，不是「打算说」。**
 *
 * 和手对称：
 *   手：真跑一条命令 → 手账 → 动完没说就注一行。
 *   嘴：真送一句话   → 嘴账 → 说过之后欠着就注一行？反过来——送完记一笔，
 *       下一步注「刚才那句真送出去了，送给谁、走的哪条道、对方收到没有」。
 *
 * 三条写死的边界：
 *   - 不重试。送失败就是失败，把退出码 / HTTP 码 / 失败原因原样交出去。
 *   - 不猜通道。用哪条得有人给（默认 file：写进发件箱）。
 *   - 先写账再说：账上多一行，才允许说「我说出去了」。
 * ============================================================================
 */
import { join } from 'node:path'
import { channelNames, channelOf, channelReady, sendVia } from './lib/channel.mjs'
import { appendSaying, briefOf, countSayings, readPending, readSayings, renderSayings, writePending } from './lib/saying.mjs'

export const name = 'persona-mouth'
export const version = '0.1.0'
export const inject = ['tools', 'systemPrompt']

const DEFAULTS = {
  workspace: '',
  stateDir: '.persona-framework',
  /** 有没说的那句话时，注不注那一行。关掉只剩嘴账。 */
  speak: true,
  /** 通道表；默认只有一条 file（发件箱）。 */
  channels: {},
}

let sessionWs = ''

function noteSessionWorkspace(payload) {
  const cwd = payload && payload.agent && payload.agent.session && payload.agent.session.header && payload.agent.session.header.cwd
  if (typeof cwd === 'string' && cwd.trim()) sessionWs = cwd.trim()
}

export function apply(ctx, config) {
  const cfg = { ...DEFAULTS, ...(config || {}) }
  const ws = () => String(cfg.workspace || '').trim() || sessionWs || process.cwd()
  const stateDir = () => join(ws(), String(cfg.stateDir || '.persona-framework'))
  const logPath = () => join(stateDir(), '嘴账.jsonl')
  const pendingPath = () => join(stateDir(), '嘴账状态.json')

  const textOutput = (text) => ({ text: String(text) })

  const reg = (spec) =>
    ctx.effect(() =>
      ctx.tools.register({
        name: spec.name,
        description: spec.description,
        parameters: spec.parameters,
        output: textOutput,
        async execute(args) {
          try {
            return { text: String(await spec.run(args || {})) }
          } catch (e) {
            return { text: `没办成：${e && e.message ? e.message : String(e)}` }
          }
        },
      }),
    )

  reg({
    name: 'mouth_say',
    description:
      '真送一句话出去（默认写进发件箱），把这句话与通道的回执落进嘴账。不重试、不猜通道；送之前先看清是送给谁。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要送出去的那句话（原样送，不改写）' },
        to: { type: 'string', description: '送给谁（一句话，进嘴账）' },
        channel: { type: 'string', description: '走哪条通道；默认 file（发件箱）' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    run: async ({ text, to, channel }) => {
      const chName = String(channel || 'file').trim() || 'file'
      const ch = channelOf(chName, cfg.channels)
      if (!ch) return `没有「${chName}」这条通道。现在有的：${channelNames(cfg.channels).join(' / ')}`
      const at = new Date().toISOString()
      const r = await sendVia(ch, { to: to || '', text: text || '' }, { workspace: ws() })
      const entry = {
        at,
        to: String(to || '').trim(),
        text: String(text || '').slice(0, 2000),
        channel: `${chName}:${r.channel || ch.kind}`,
        ok: !!r.ok,
        code: r.code == null ? -1 : r.code,
        detail: String(r.detail || '').slice(0, 400),
        ms: r.ms,
      }
      // 先写账，再说结果——嘴账是「真送出去过」的唯一凭据。
      appendSaying(logPath(), entry)
      const st = readPending(pendingPath())
      writePending(pendingPath(), { pending: [...st.pending, briefOf(entry)].slice(-20), spokenAt: st.spokenAt })
      const head = r.ok ? '送出去了' : '没送到'
      return `${head}：${briefOf(entry)}\n${entry.detail}`
    },
  })

  reg({
    name: 'mouth_receipt',
    description: '看嘴账：最近真送出去的话（送给谁 + 通道回执 + 成功与否）。默认最近 10 条。',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number', description: '看最近几条，默认 10（1–200）' } },
      additionalProperties: false,
    },
    run: ({ limit }) => {
      const n = Math.max(1, Math.min(200, Number(limit) || 10))
      const list = readSayings(logPath(), n)
      const total = countSayings(logPath())
      if (!list.length) return '嘴账还是空的——一句真送出去的话都没有。'
      return `嘴账共 ${total} 条，最近 ${list.length} 条：\n${renderSayings(list)}`
    },
  })

  reg({
    name: 'mouth_pending',
    description: '有没有送出去还没说出口的话。注完之后由触发器自己清（它会写盘）。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    run: () => {
      const st = readPending(pendingPath())
      if (!st.pending.length) return '没有欠着的送信。'
      return `送完还没说出口的 ${st.pending.length} 句：\n${st.pending.map((x) => `- ${x}`).join('\n')}`
    },
  })

  // ---- 通道体检：光有名字不算，得能落东西 -------------------------------
  reg({
    name: 'mouth_channel',
    description: '看嘴有哪几条通道、各自通不通（file 看发件箱路径，command/http 看配置齐不齐）。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    run: () => {
      const names = channelNames(cfg.channels)
      const lines = names.map((n) => {
        const ch = channelOf(n, cfg.channels)
        const r = channelReady(ch, { workspace: ws() })
        return `- ${n}（${ch.kind}）${r.ready ? '能送' : '还不行'}：${r.why}`
      })
      return `嘴上有 ${names.length} 条通道：\n${lines.join('\n')}\n嘴账：${logPath()}`
    },
  })

  // ---- 触发器：送出去还没说，就注一行；注之前先落账 -------------------------
  let hint = ''
  let lastCheck = 0

  const check = (now = Date.now()) => {
    lastCheck = now
    try {
      if (!cfg.speak) { hint = ''; return }
      const st = readPending(pendingPath())
      if (!st.pending.length) { hint = ''; return }
      const shown = st.pending.slice(-3)
      hint = `嘴：这一步之前真送出去 ${st.pending.length} 句（说的时候报送给谁、走的哪条道、收到没有，别报打算）——\n${shown.map((x) => `- ${x}`).join('\n')}`
      // 先写盘再说话：说过的不再欠着，不然下一轮还注同一批。
      writePending(pendingPath(), { pending: [], spokenAt: new Date().toISOString(), last: shown })
    } catch {
      hint = ''
    }
  }

  try {
    ctx.on('agent/pre-step', (payload, next) => {
      try { noteSessionWorkspace(payload) } catch { /* 拿不到就用旧的 */ }
      check()
      return next()
    })
  } catch {
    /* 没有钩子也能用：退化成只能工具问 */
  }

  try {
    ctx.effect(() =>
      ctx.systemPrompt.context({
        name: '实时环境:mouth',
        order: 42,
        text: () => {
          if (!hint && Date.now() - lastCheck > 60_000) check()
          return hint
        },
      }),
    )
  } catch {
    /* 没有 context 也能用 */
  }

  return { logPath, pendingPath }
}
