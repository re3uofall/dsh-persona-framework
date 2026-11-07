/**
 * dsh-persona-sweep —— 清扫（功能实现层）
 * ============================================================================
 * 它只做一件事：把 `<ws>/.persona-framework/*.jsonl` 那些越写越长的账压实——
 * 超过阈值就整份归档进 `_archive/`，原账只留尾部若干行，再往 `清扫账.jsonl` 记一行。
 *
 * 按 GUIDE-FEATURES.md 的三条判据：改状态 + 不给人格字 + 下一轮它真的变了。
 * 所以这个插件**不注册任何 systemPrompt.section**，一个字都不往上下文里放；
 * 它只在盘上动手，被问到才由工具报数。
 * ============================================================================
 */
import { existsSync } from 'node:fs'
import {
  DEFAULTS, listLedgers, sweepAll, readState, writeState, appendRecord,
  dueNow, renderStatus, renderReport, ledgerDir,
} from './lib/sweep.mjs'

export const name = 'dsh-persona-sweep'

const DEFAULTS_CFG = {
  enabled: true,
  maxLines: DEFAULTS.maxLines,
  keepLines: DEFAULTS.keepLines,
  cooldownMin: DEFAULTS.cooldownMin,
  dir: DEFAULTS.dir,
}

let sessionWs = ''
let lastRun = null
let lastError = ''

function wsOf(cfg) {
  if (cfg && cfg.workspace) return cfg.workspace
  if (sessionWs) return sessionWs
  return process.cwd()
}

function optsOf(cfg) {
  const c = { ...DEFAULTS_CFG, ...(cfg || {}) }
  return { maxLines: c.maxLines, keepLines: c.keepLines, cooldownMin: c.cooldownMin, dir: c.dir }
}

function runSweep(cfg) {
  const ws = wsOf(cfg)
  const opts = optsOf(cfg)
  const result = sweepAll(ws, opts)
  const state = writeState(ws, result, opts)
  appendRecord(ws, result, opts)
  lastRun = { at: result.at, scanned: result.scanned, compacted: state.compacted, bytesBefore: state.bytesBefore, bytesAfter: state.bytesAfter }
  lastError = ''
  return lastRun
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

export function apply(ctx, config) {
  const cfg = () => ({ ...DEFAULTS_CFG, ...(config || {}) })

  try {
    ctx.on('agent/pre-step', (payload, next) => {
      try {
        const cwd = payload?.agent?.session?.header?.cwd
        if (cwd) sessionWs = cwd
        const c = cfg()
        if (c.enabled !== false) {
          const ws = wsOf(c)
          const opts = optsOf(c)
          if (existsSync(ledgerDir(ws, opts))) {
            const st = readState(ws, opts)
            if (dueNow(st, opts)) runSweep(c)
          }
        }
      } catch (err) {
        lastError = String(err && err.message || err)
      }
      return next()
    })
  } catch { /* 钩子挂不上不该拖垮插件 */ }

  const reg = (spec) => {
    try { ctx.effect(() => ctx.tools.register({ ...spec, output: textOutput })) } catch (err) {
      lastError = String(err && err.message || err)
    }
  }

  reg({
    name: 'sweep_status',
    description: '清扫现在的状态：上一次什么时候跑的、扫了几本账、压实了几本、省下多少字节。只读，不跑。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      const ws = wsOf(cfg())
      const opts = optsOf(cfg())
      const st = readState(ws, opts)
      const items = listLedgers(ws, opts)
      const over = items.filter((i) => i.lines > opts.maxLines).length
      const head = renderStatus(st)
      const errLine = lastError ? `\n上一次出错：${lastError}` : ''
      return { text: `${head}\n账目录：${ledgerDir(ws, opts)}\n现在有 ${items.length} 本，超过 ${opts.maxLines} 行的有 ${over} 本。${errLine}` }
    },
  })

  reg({
    name: 'sweep_run',
    description: '现在真扫一次：把超阈值的那几本账归档、只留尾部若干行，并记一行清扫账。会改盘上的文件。',
    parameters: {
      type: 'object',
      properties: {
        maxLines: { type: 'number', description: '超过多少行才压实（默认 300）' },
        keepLines: { type: 'number', description: '压实后留尾部多少行（默认 80）' },
      },
      additionalProperties: false,
    },
    async execute(args) {
      const c = cfg()
      const opts = { ...optsOf(c), ...(args || {}) }
      try {
        const r = runSweep(c)
        const detail = r.compacted
          ? `压实 ${r.compacted} 本`
          : '没有一本超阈值'
        return { text: `扫过 ${r.scanned} 本账，${detail}；${(r.bytesBefore || 0) - (r.bytesAfter || 0)} 字节从账上省掉（原件在 _archive/）。` }
      } catch (err) {
        const msg = String(err && err.message || err)
        lastError = msg
        return { text: `没扫成：${msg}` }
      }
    },
  })

  reg({
    name: 'sweep_report',
    description: '列出账目录里每一本 .jsonl 的行数与字节数，按行数从多到少。只读。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      const ws = wsOf(cfg())
      const items = listLedgers(ws, optsOf(cfg()))
      return { text: renderReport(items) }
    },
  })
}

export const version = '0.1.0'
