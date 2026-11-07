/**
 * ear.mjs —— 耳朵账：听见了什么、什么时候、来自哪个文件、第一句是什么。
 * ============================================================================
 * 一行一条，追加写；「听见了还没说」另存一份 pending——和手、嘴同一套形状：
 * 先写账，再说话；说过就清。
 * ============================================================================
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const MAX_LINES_READ = 200

export function firstLine(entry) {
  const segs = Array.isArray(entry && entry.segments) ? entry.segments : []
  const t = segs.length ? String(segs[0].text || '') : String((entry && entry.text) || '')
  const one = t.replace(/\s+/g, ' ').trim()
  return one.length > 80 ? one.slice(0, 80) + '…' : one
}

/** 一行能看懂的：时间 + 来源 + 句数/字数 + 第一句。 */
export function briefOf(entry) {
  if (!entry) return ''
  const when = String(entry.at || '').slice(11, 19) || '--:--:--'
  const src = String(entry.source || '').split(/[\\/]/).pop() || '(未知)'
  const segs = Array.isArray(entry.segments) ? entry.segments.length : 0
  const chars = Number(entry.chars) || 0
  const head = firstLine(entry)
  if (entry.ok === false) return `✗ ${when} ${src} → ${entry.reason || '没听成'}`
  return `✓ ${when} ${src} · ${segs} 句 / ${chars} 字 → ${head}`
}

export function appendEar(file, entry) {
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8')
  return entry
}

export function readEars(file, limit = MAX_LINES_READ) {
  if (!existsSync(file)) return []
  let lines = []
  try { lines = readFileSync(file, 'utf8').split('\n').filter(Boolean) } catch { return [] }
  const tail = lines.slice(-Math.max(1, Math.min(limit, MAX_LINES_READ)))
  const out = []
  for (const l of tail) { try { out.push(JSON.parse(l)) } catch { /* 坏行跳过，不猜 */ } }
  return out
}

export function countEars(file) {
  if (!existsSync(file)) return 0
  try { return readFileSync(file, 'utf8').split('\n').filter(Boolean).length } catch { return 0 }
}

export function renderEars(list) {
  if (!list || !list.length) return '耳朵账还是空的：这一段还没听过任何东西。'
  return list.map((e, i) => `${list.length - i}. ${briefOf(e)}`).join('\n')
}

export function readPending(file) {
  try {
    if (!existsSync(file)) return { pending: [] }
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    return { pending: Array.isArray(raw && raw.pending) ? raw.pending : [] }
  } catch { return { pending: [] } }
}

export function writePending(file, state) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(state || { pending: [] }, null, 2) + '\n', 'utf8')
}

/** 待说的那几行：给实时环境用，一句一条，最多 6 条。 */
export function renderPending(pending) {
  const list = Array.isArray(pending) ? pending.slice(-6) : []
  if (!list.length) return ''
  const lines = list.map((e) => `- ${briefOf(e)}`)
  return `耳：这一步之前真听过 ${pending.length} 段 ——\n${lines.join('\n')}`
}

/** 把 srt / txt 文本切成段：srt 认时间码，txt 一行一段。 */
export function parseTranscript(text, kind = 'auto') {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim()
  if (!raw) return []
  const looksSrt = /^\s*\d+\s*\n\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(raw)
  if (kind === 'srt' || (kind === 'auto' && looksSrt)) {
    const out = []
    for (const block of raw.split(/\n{2,}/)) {
      const m = block.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/)
      if (!m) continue
      const start = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000
      const end = Number(m[5]) * 3600 + Number(m[6]) * 60 + Number(m[7]) + Number(m[8]) / 1000
      const body = block.split('\n').filter((l) => !/^\d+$/.test(l.trim()) && !l.includes('-->')).join(' ').trim()
      if (body) out.push({ start, end, text: body })
    }
    return out
  }
  return raw.split('\n').map((l) => l.trim()).filter(Boolean).map((text, i) => ({ start: i, end: i + 1, text }))
}
