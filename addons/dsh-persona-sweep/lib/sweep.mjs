// 清扫：把越写越长的账压实。
// 这一层不改任何文字，只搬、只删尾、只记一行——按 GUIDE-FEATURES.md 的话说，它不给人格字。

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, copyFileSync } from 'node:fs'
import { join, basename } from 'node:path'

export const DEFAULTS = {
  maxLines: 300,   // 超过这么多行才压实
  keepLines: 80,   // 压实后留尾部这么多行
  cooldownMin: 15, // 两次自动清扫之间至少隔这么久
  dir: '.persona-framework',
}

export function stampNow(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, '-')
}

export function ledgerDir(ws, opts = {}) {
  return join(ws, opts.dir || DEFAULTS.dir)
}

export function listLedgers(ws, opts = {}) {
  const dir = ledgerDir(ws, opts)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => {
      const p = join(dir, f)
      let lines = 0
      let bytes = 0
      try {
        const t = readFileSync(p, 'utf8')
        bytes = Buffer.byteLength(t, 'utf8')
        lines = t.length ? t.split('\n').filter((x) => x.trim()).length : 0
      } catch { /* 读不了就按 0 报，不假装 */ }
      return { file: f, path: p, lines, bytes, mtime: safeMtime(p) }
    })
    .sort((a, b) => b.lines - a.lines)
}

function safeMtime(p) {
  try { return statSync(p).mtime.toISOString() } catch { return '' }
}

export function sweepFile(file, opts = {}) {
  const maxLines = opts.maxLines ?? DEFAULTS.maxLines
  const keepLines = opts.keepLines ?? DEFAULTS.keepLines
  const text = readFileSync(file, 'utf8')
  const rows = text.split('\n').filter((x) => x.trim())
  if (rows.length <= maxLines) return { skipped: true, file, lines: rows.length }

  const archiveDir = join(opts.archiveDir || join(file, '..'), '_archive')
  mkdirSync(archiveDir, { recursive: true })
  const archive = join(archiveDir, `${basename(file)}.${stampNow()}.jsonl`)
  copyFileSync(file, archive)

  const kept = rows.slice(-keepLines)
  writeFileSync(file, kept.join('\n') + '\n', 'utf8')
  return {
    skipped: false,
    file,
    before: rows.length,
    after: kept.length,
    archived: archive,
  }
}

export function sweepAll(ws, opts = {}) {
  const at = new Date().toISOString()
  const all = listLedgers(ws, opts)
  const compacted = []
  let bytesBefore = 0
  let bytesAfter = 0
  for (const item of all) {
    bytesBefore += item.bytes
    try {
      const r = sweepFile(item.path, { ...opts, archiveDir: ledgerDir(ws, opts) })
      if (!r.skipped) compacted.push(r)
    } catch (err) {
      compacted.push({ file: item.file, error: String(err && err.message || err) })
    }
  }
  for (const item of listLedgers(ws, opts)) bytesAfter += item.bytes
  return { at, scanned: all.length, compacted, bytesBefore, bytesAfter }
}

export function statePath(ws, opts = {}) {
  return join(ledgerDir(ws, opts), '清扫账.json')
}

export function readState(ws, opts = {}) {
  const p = statePath(ws, opts)
  if (!existsSync(p)) return { at: '', scanned: 0, compacted: 0, bytesBefore: 0, bytesAfter: 0 }
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return { at: '', scanned: 0, compacted: 0, bytesBefore: 0, bytesAfter: 0, error: '状态文件读不出来' } }
}

export function writeState(ws, result, opts = {}) {
  const p = statePath(ws, opts)
  mkdirSync(ledgerDir(ws, opts), { recursive: true })
  const row = {
    at: result.at,
    scanned: result.scanned,
    compacted: result.compacted.filter((x) => !x.skipped && !x.error).length,
    failed: result.compacted.filter((x) => x.error).length,
    bytesBefore: result.bytesBefore,
    bytesAfter: result.bytesAfter,
  }
  writeFileSync(p, JSON.stringify(row, null, 2) + '\n', 'utf8')
  return row
}

export function appendRecord(ws, result, opts = {}) {
  const dir = ledgerDir(ws, opts)
  mkdirSync(dir, { recursive: true })
  const p = join(dir, '清扫账.jsonl')
  for (const c of result.compacted) {
    if (c.skipped) continue
    const line = c.error
      ? { at: result.at, file: c.file, error: c.error }
      : { at: result.at, file: basename(c.file), before: c.before, after: c.after, archived: basename(c.archived) }
    writeFileSync(p, JSON.stringify(line) + '\n', { encoding: 'utf8', flag: 'a' })
  }
  if (!result.compacted.length) {
    writeFileSync(p, JSON.stringify({ at: result.at, scanned: result.scanned, compacted: 0 }) + '\n', { encoding: 'utf8', flag: 'a' })
  }
  return p
}

export function dueNow(state, opts = {}, now = new Date()) {
  const cooldown = (opts.cooldownMin ?? DEFAULTS.cooldownMin) * 60000
  if (!state || !state.at) return true
  const last = Date.parse(state.at)
  if (Number.isNaN(last)) return true
  return now.getTime() - last >= cooldown
}

export function renderStatus(state) {
  if (!state || !state.at) return '清扫：一次都没跑过。'
  const saved = Math.max(0, (state.bytesBefore || 0) - (state.bytesAfter || 0))
  return `清扫：上一次 ${state.at}，扫了 ${state.scanned} 本账，压实 ${state.compacted} 本${state.failed ? `（失败 ${state.failed} 本）` : ''}，省下 ${saved} 字节。`
}

export function renderReport(items) {
  if (!items.length) return '清扫：账目录里还没有任何 .jsonl。'
  return items
    .map((i) => `${i.file}　${i.lines} 行　${i.bytes} 字节`)
    .join('\n')
}
