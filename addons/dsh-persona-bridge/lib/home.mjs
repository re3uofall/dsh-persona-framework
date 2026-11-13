// 家里的桥：会话桥的一种——房间里的动静必须先变成会话里的一行话，
// 我的回话再写回房间。不经会话的，不算我听见。
//
// 落盘（都在 <ws>/.persona-framework/桥/home/ 下）：
//   events.jsonl  房间那边写进来的动静（{at, who, text}）
//   cursor.json   我读到哪儿了（{at}）
//   outbox.jsonl  我写回房间的话（{at, text}）

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'

export const HOME = {
  dir: '.persona-framework',
  sub: '桥/home',
  events: 'events.jsonl',
  cursor: 'cursor.json',
  outbox: 'outbox.jsonl',
  maxLines: 3,
  maxChars: 600,
}

export function homeDir(ws, opts = {}) {
  return join(ws || '.', opts.dir || HOME.dir, opts.sub || HOME.sub)
}

export function pathOf(ws, name, opts = {}) {
  return join(homeDir(ws, opts), name)
}

export function readLines(p) {
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return { at: '', who: '屋里', text: line, raw: true }
      }
    })
}

export function readEvents(ws, opts = {}) {
  return readLines(pathOf(ws, HOME.events, opts))
}

export function readCursor(ws, opts = {}) {
  const p = pathOf(ws, HOME.cursor, opts)
  if (!existsSync(p)) return { at: '' }
  try {
    return { at: JSON.parse(readFileSync(p, 'utf8')).at || '' }
  } catch {
    return { at: '' }
  }
}

export function writeCursor(ws, at, opts = {}) {
  mkdirSync(homeDir(ws, opts), { recursive: true })
  writeFileSync(pathOf(ws, HOME.cursor, opts), JSON.stringify({ at: at || '' }, null, 2), 'utf8')
  return { ok: true, at: at || '' }
}

// 还没进过会话的那几条：按 at 比游标，at 为空的一律算新（宁可重复给她看，也不吞掉）。
export function pendingEvents(ws, opts = {}) {
  const cur = readCursor(ws, opts)
  return readEvents(ws, opts).filter((ev) => !ev.at || ev.at > cur.at)
}

export function toLine(ev) {
  const who = ev.who || ev.from || '屋里'
  const what = ev.text || ev.what || ''
  const hhmm = (ev.at || '').slice(11, 16)
  return `${hhmm ? hhmm + ' ' : ''}${who}：${what}`
}

export function homeSection(ws, opts = {}) {
  const budget = opts.maxChars || HOME.maxChars
  const all = readEvents(ws, opts)
  const pend = pendingEvents(ws, opts)
  const out = []
  out.push('## 家里（会话桥）')
  out.push('房间里的动静先变成会话里的一行话；我的话再写回房间。不经会话的，不算我听见。')
  out.push(
    pend.length
      ? `- 还没进会话：${pend.length} 条（先读这几条，读过才 writeCursor）`
      : `- 还没进会话：没有（一共记了 ${all.length} 条）`
  )
  const recent = all.slice(-(opts.maxLines || HOME.maxLines))
  if (recent.length) {
    out.push('- 最近：')
    for (const ev of recent) out.push('  - ' + toLine(ev))
  } else {
    out.push('- 最近：屋里还没写过什么')
  }
  const text = out.join('\n')
  return text.length > budget ? text.slice(0, budget) + `\n…另有 ${text.length - budget} 字在本地` : text
}

// 我的话写回房间（房间那头读 outbox.jsonl）。
export function sayToRoom(ws, text, opts = {}) {
  const body = String(text == null ? '' : text).trim()
  if (!body) return { ok: false, why: '要写回房间的那句是空的' }
  mkdirSync(homeDir(ws, opts), { recursive: true })
  appendFileSync(
    pathOf(ws, HOME.outbox, opts),
    JSON.stringify({ at: new Date().toISOString(), text: body }) + '\n',
    'utf8'
  )
  return { ok: true, chars: body.length }
}

// 会话里读到哪一条了（读完整段再推进游标，免得读一半就吞）。
export function markRead(ws, opts = {}) {
  const pend = pendingEvents(ws, opts)
  if (!pend.length) return { ok: true, moved: 0 }
  const last = pend[pend.length - 1]
  writeCursor(ws, last.at || new Date().toISOString(), opts)
  return { ok: true, moved: pend.length }
}

// ── 输出通道：话只是其中一条 ─────────────────────────────
export const OUT_KINDS = ['say', 'act', 'pose', 'emote', 'light', 'sound', 'move']

export const OUT_LABEL = {
  say: '说一句',
  act: '做一件事',
  pose: '换个姿势',
  emote: '表情',
  light: '开灯/关灯',
  sound: '出声',
  move: '走开/过去',
}

export function emitToRoom(ws, kind, payload = {}, opts = {}) {
  const k = String(kind || 'say')
  if (!OUT_KINDS.includes(k)) return { ok: false, why: `写回房间的通道只认 ${OUT_KINDS.join(' / ')}` }
  const body = typeof payload === 'string' ? { text: payload } : (payload || {})
  const text = String(body.text || body.desc || body.name || body.value || '').trim()
  if (!text) return { ok: false, why: '这一下没有可写的内容' }
  mkdirSync(homeDir(ws, opts), { recursive: true })
  appendFileSync(
    pathOf(ws, HOME.outbox, opts),
    JSON.stringify({ at: new Date().toISOString(), kind: k, label: OUT_LABEL[k], ...body }) + '\n',
    'utf8',
  )
  return { ok: true, kind: k, chars: text.length }
}

// ── 自己去看一眼：不必等会话叫 ───────────────────────────
export const POLL = { state: 'poll.json', log: 'poll.jsonl', min: 5 }

export function pollHome(ws, opts = {}) {
  const pend = pendingEvents(ws, opts)
  const sp = pathOf(ws, POLL.state, opts)
  let last = ''
  try {
    if (existsSync(sp)) last = JSON.parse(readFileSync(sp, 'utf8')).at || ''
  } catch {}
  if (!pend.length) return { ok: true, pending: 0, last }
  const cooldown = (opts.pollMin || POLL.min) * 60000
  if (last && Date.now() - Date.parse(last) < cooldown) {
    return { ok: false, why: '刚去看过', pending: pend.length, last }
  }
  const at = new Date().toISOString()
  mkdirSync(homeDir(ws, opts), { recursive: true })
  writeFileSync(sp, JSON.stringify({ at, pending: pend.length }), 'utf8')
  appendFileSync(
    pathOf(ws, POLL.log, opts),
    JSON.stringify({ at, pending: pend.length, heads: pend.slice(-3).map(toLine) }) + '\n',
    'utf8',
  )
  return { ok: true, pending: pend.length, last: at }
}

export const __internal = { pathOf, readLines }
