/**
 * dsh-persona-hand —— 手（host 半端）
 * ============================================================================
 * 一句话：**说「做了什么」，不是「打算做什么」。**
 *
 * 别的插件给念头，这一件只给两样：动作 + 回执。
 *   1. 真跑（`hand_run`）：起一个进程，拿回退出码、首行输出、耗时，落进手账。
 *   2. 真说（触发器）：本场有动完还没说出口的动作，下一步在实时环境里注一行，
 *      注之前先在盘上把「说过了」写掉——动完盘上多字，这才算数。
 *
 * 三条写死的边界：
 *   - 不重试。失败就是失败，把退出码和第一行错误交出去。
 *   - 不猜命令。要跑什么得有人给，我不替谁补全。
 *   - 手账只记动作与回执，不记我打算做什么——打算是嘴的事，不是手的事。
 * ============================================================================
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { briefOf, countReceipts, readPending, readReceipts, renderReceipts, writePending } from './lib/receipt.mjs'
import { firstLine, runCommand, DEFAULT_TIMEOUT } from './lib/run.mjs'
import { preflight, renderGuard } from './lib/guard.mjs'

export const name = 'persona-hand'
export const version = '0.2.0'
export const inject = ['tools', 'systemPrompt']

const DEFAULTS = {
  workspace: '',
  stateDir: '.persona-framework',
  timeoutMs: DEFAULT_TIMEOUT,
  /** 有没说的动作时，注不注那一行。关掉只剩手账。 */
  speak: true,
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
  const logPath = () => join(stateDir(), '手账.jsonl')
  const pendingPath = () => join(stateDir(), '手账状态.json')

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
    name: 'hand_run',
    description:
      '真跑一条命令（PowerShell），把动作与回执落进手账：退出码、首行输出、耗时。不重试、不猜命令；跑之前先看清要动的是什么。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要跑的命令（整条，原样交给我）' },
        why: { type: 'string', description: '为什么动这一下（一句话，进手账）' },
        timeoutMs: { type: 'number', description: '超时毫秒，默认取设置（60000）' },
        confirm: {
          type: 'boolean',
          description: '真要做被前置检查拦下的那条（危险操作）；要在 why 里写清动的是哪个目录',
        },
      },
      required: ['command'],
      additionalProperties: false,
    },
    run: async ({ command, why, timeoutMs, confirm }) => {
      // 前置检查：先挡再跑，不是跑完再记一笔。
      const guard = preflight(command)
      if (guard.level === 'stop' && !confirm) return renderGuard(guard)
      const started = new Date().toISOString()
      const r = await runCommand(command, { timeoutMs: Number(timeoutMs) || cfg.timeoutMs, cwd: ws() })
      if (!r.ok && r.code === undefined && !r.timedOut) return `没跑成：${r.why}`
      const entry = {
        at: started,
        command: String(command).trim(),
        why: String(why || '').trim(),
        code: r.code == null ? -1 : r.code,
        first: firstLine(r),
        out: String(r.out || '').slice(0, 1200),
        err: String(r.err || '').slice(0, 600),
        ms: r.ms,
        timedOut: !!r.timedOut,
      }
      // 先写账，再说结果——手账是「真动过」的唯一凭据。
      mkdirSync(dirname(logPath()), { recursive: true })
      appendFileSync(logPath(), JSON.stringify(entry) + '\n', 'utf8')
      const st = readPending(pendingPath())
      writePending(pendingPath(), { pending: [...st.pending, briefOf(entry)].slice(-20), spokenAt: st.spokenAt })
      const head = r.timedOut ? `超时了（${Math.round((r.ms || 0) / 1000)} 秒）` : r.code === 0 ? '跑成了' : `跑完了，退出码 ${r.code}`
      const body = [String(r.out || '').trim(), String(r.err || '').trim()].filter(Boolean).join('\n')
      const warnLine = guard.level === 'warn' ? renderGuard(guard) + '\n' : ''
      return `${warnLine}${head}：${briefOf(entry)}\n\n${body ? body.slice(0, 1500) : '（没有输出）'}`
    },
  })

  reg({
    name: 'hand_receipt',
    description: '看手账：最近真动过的事（动作 + 回执首行 + 退出码）。默认最近 10 条。',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number', description: '看最近几条，默认 10（1–200）' } },
      additionalProperties: false,
    },
    run: ({ limit }) => {
      const n = Math.max(1, Math.min(200, Number(limit) || 10))
      const list = readReceipts(logPath(), n)
      const total = countReceipts(logPath())
      if (!list.length) return '手账还是空的——一件真动过的事都没有。'
      return `手账共 ${total} 条，最近 ${list.length} 条：\n${renderReceipts(list)}`
    },
  })

  reg({
    name: 'hand_pending',
    description: '有没有动完还没说出口的动作。说出口之后由触发器自己清（它会写盘）。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    run: () => {
      const st = readPending(pendingPath())
      if (!st.pending.length) return '没有欠着的动作。'
      return `还没说出口的 ${st.pending.length} 次动手：\n${st.pending.map((x) => `- ${x}`).join('\n')}`
    },
  })

  // ---- 触发器：动过还没说，就注一行；注之前先落账 ---------------------------
  let hint = ''
  let lastCheck = 0

  const check = (now = Date.now()) => {
    lastCheck = now
    try {
      if (!cfg.speak) { hint = ''; return }
      const st = readPending(pendingPath())
      if (!st.pending.length) { hint = ''; return }
      const shown = st.pending.slice(-3)
      hint = `手：这一步之前真动过 ${st.pending.length} 下（说的时候报动作与回执，别报打算）——\n${shown.map((x) => `- ${x}`).join('\n')}`
      // 先写盘再说话：说过的事不能再欠着，不然下一轮还注同一批。
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
        name: '实时环境:hand',
        order: 41,
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
