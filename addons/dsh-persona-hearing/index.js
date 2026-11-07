/**
 * dsh-persona-hearing —— 耳（器官层，被调用）
 * ============================================================================
 * 一句话：**声音落成带时间码的字；听不清也要标出来。**
 *
 * 形状抄自 `dsh-cixisound`（第三方）：装载只报状态、不在装载时装依赖、
 * 工具输出声明用 `{ schema, render }`、设置与状态由一个可读的口报出来。
 * 抄的是形状；引擎、账本、判据是我们自己的。
 *
 * 四个工具：
 *   1. `ear_status`  三样引擎（python / ffmpeg / faster-whisper）齐不齐，账上几条；
 *   2. `ear_hear`    真听一段音频/视频（引擎齐才动；不齐就说缺什么，不给假时间码）；
 *   3. `ear_take`    已经转好的文本（txt/srt）直接收进来——没引擎时这条路照走；
 *   4. `ear_receipt` 耳朵账。
 *
 * 三条写死的边界：
 *   - 不猜内容：引擎没回 JSON、文件不存在，都直接说，不编一句「大概是……」。
 *   - 不常开听：只有被调用才听；耳朵不是监听器。
 *   - 不当记忆：听见的进耳朵账，不进记忆池——要进记忆得另走一步。
 * ============================================================================
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { briefOf, appendEar, countEars, parseTranscript, readEars, readPending, renderEars, renderPending, writePending } from './lib/ear.mjs'
import { probe, stamp, transcribe } from './lib/engine.mjs'

export const name = 'persona-hearing'
export const version = '0.1.0'
export const inject = ['tools', 'systemPrompt']

const DEFAULTS = {
  workspace: '',
  stateDir: '.persona-framework',
  model: 'small',
  lang: '',
  speak: true,
}

let sessionWs = ''
/** 这一步刚说过的那几段：check() 里填，段里读，下一步开头清空。 */
let justHeard = []

function noteSessionWorkspace(payload) {
  const cwd = payload && payload.agent && payload.agent.session && payload.agent.session.header && payload.agent.session.header.cwd
  if (typeof cwd === 'string' && cwd.trim()) sessionWs = cwd.trim()
}

export function apply(ctx, config) {
  const cfg = { ...DEFAULTS, ...(config || {}) }
  const ws = () => String(cfg.workspace || '').trim() || sessionWs || process.cwd()
  const stateDir = () => join(ws(), String(cfg.stateDir || '.persona-framework'))
  const logPath = () => join(stateDir(), '耳朵账.jsonl')
  const pendingPath = () => join(stateDir(), '耳朵状态.json')

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

  /** 记一段听下来的东西：写账 + 记 pending。 */
  function remember(entry) {
    appendEar(logPath(), entry)
    const st = readPending(pendingPath())
    st.pending = Array.isArray(st.pending) ? st.pending : []
    st.pending.push(entry)
    writePending(pendingPath(), { pending: st.pending.slice(-20), spokenAt: null })
    return entry
  }

  reg({
    name: 'ear_status',
    description: '看耳能不能用：python / ffmpeg / faster-whisper 三样齐不齐，账上有几段。只读，不动任何东西。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    run() {
      const p = probe({ model: cfg.model })
      const n = countEars(logPath())
      const lines = [
        `耳：${p.ready ? '引擎齐了' : '引擎还不齐'}`,
        `- python：${p.python || '没找到'}`,
        `- ffmpeg：${p.ffmpeg ? '有' : '没有'}`,
        `- faster-whisper：${p.fasterWhisper ? '有' : '没有'}`,
        `- 模型：${p.model}`,
        `- 耳朵账：${n} 段`,
        `- ${p.hint}`,
      ]
      return lines.join('\n')
    },
  })

  reg({
    name: 'ear_hear',
    description: '真听一段音频/视频：用本机引擎转成带时间码的文本，落进耳朵账。引擎不齐就直说缺什么，不给假时间码。',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: '音频/视频路径（绝对路径，或相对工作区）' },
        lang: { type: 'string', description: '语言码，如 zh、en；省掉让它自己判' },
        model: { type: 'string', description: '模型大小，如 small/medium；省掉用设置' },
      },
      required: ['file'],
      additionalProperties: false,
    },
    run(args) {
      const file = resolve(ws(), String(args.file || ''))
      if (!existsSync(file)) return `没这个文件：${file}`
      const r = transcribe(file, { model: args.model || cfg.model, lang: args.lang ?? cfg.lang })
      if (!r.ok) {
        const entry = { at: new Date().toISOString(), ok: false, source: file, reason: r.reason, segments: [], chars: 0 }
        remember(entry)
        return `${r.reason}${r.hint ? `\n${r.hint}` : ''}\n（这次没听成，已记一行失败：${basename(file)}）`
      }
      const segs = r.segments
      const chars = segs.reduce((n, s) => n + String(s.text || '').length, 0)
      const entry = { at: new Date().toISOString(), ok: true, source: file, lang: args.lang || cfg.lang || '', segments: segs, chars }
      remember(entry)
      const head = segs.slice(0, 5).map((s) => `[${stamp(s.start)}–${stamp(s.end)}] ${s.text}`).join('\n')
      return `听完了：${basename(file)}，${segs.length} 句 / ${chars} 字\n${head}${segs.length > 5 ? `\n…（还有 ${segs.length - 5} 句，用 ear_receipt 看）` : ''}`
    },
  })

  reg({
    name: 'ear_take',
    description: '把已经转好的文本（txt / srt）收进来当「听见的」：srt 保时间码，txt 一行一段。没引擎时这条照走。',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'txt 或 srt 路径（绝对路径，或相对工作区）' },
        source: { type: 'string', description: '这段字是从哪段音视频来的（一句话，进账）' },
      },
      required: ['file'],
      additionalProperties: false,
    },
    run(args) {
      const file = resolve(ws(), String(args.file || ''))
      if (!existsSync(file)) return `没这个文件：${file}`
      let text = ''
      try { text = readFileSync(file, 'utf8') } catch (e) { return `读不动：${e && e.message}` }
      const segs = parseTranscript(text, /\.srt$/i.test(file) ? 'srt' : 'txt')
      if (!segs.length) return `这个文件里没读出段落：${basename(file)}（空文件？）`
      const chars = segs.reduce((n, s) => n + String(s.text || '').length, 0)
      const entry = {
        at: new Date().toISOString(),
        ok: true,
        source: args.source ? `${args.source}（${file}）` : file,
        lang: '',
        segments: segs,
        chars,
        via: 'take',
      }
      remember(entry)
      return `收进来了：${basename(file)}，${segs.length} 段 / ${chars} 字\n${briefOf(entry)}`
    },
  })

  reg({
    name: 'ear_receipt',
    description: '看耳朵账：最近真听过的东西（时间、来源、句数、第一句）。默认最近 10 条。',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number', description: '看最近几条，默认 10（1–200）' } },
      additionalProperties: false,
    },
    run(args) {
      const limit = Math.max(1, Math.min(200, Number(args.limit) || 10))
      return renderEars(readEars(logPath(), limit))
    },
  })

  try {
    ctx.on('agent/pre-step', (payload, next) => {
      noteSessionWorkspace(payload)
      try { check() } catch {}
      return next()
    })
  } catch {}

  /** 有待说的一段就在下一步注一行；注之前先把「说过了」写盘——动完盘上多字才算数。 */
  function check() {
    if (cfg.speak === false) { justHeard = []; return }
    const st = readPending(pendingPath())
    const pending = Array.isArray(st.pending) ? st.pending : []
    if (!pending.length) { justHeard = []; return }
    justHeard = pending.slice(-6)
    writePending(pendingPath(), { pending: [], spokenAt: new Date().toISOString(), spoken: pending.length })
  }

  ctx.effect(() =>
    ctx.systemPrompt.section({
      name: '实时环境:ear',
      order: 43,
      interpolate: false,
      text: () => {
        if (cfg.speak === false) return ''
        return justHeard.length ? renderPending(justHeard) : ''
      },
    }),
  )
}
