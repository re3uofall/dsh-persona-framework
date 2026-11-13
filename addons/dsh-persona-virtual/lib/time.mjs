// 虚拟时空：虚拟钟、昼夜、留下过的时刻。
// 判据不是「我说现在几点了」，是盘上写下过这个虚拟时刻，以及那一时刻的场景是什么。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const VTIME = {
  dir: '.persona-framework',
  file: '虚拟时空.json',
  tz: 'Asia/Shanghai',
  maxAnchors: 200,
  days: ['日', '一', '二', '三', '四', '五', '六'],
}

const dirOf = (ws, opts = {}) => join(ws || process.cwd(), opts.dir || VTIME.dir)
const pathOf = (ws, opts) => join(dirOf(ws, opts), opts.file || VTIME.file)

export function loadVTime(ws, opts = {}) {
  const p = pathOf(ws, opts)
  const base = { offsetMinutes: 0, anchors: [], at: null }
  if (!existsSync(p)) return base
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'))
    return { ...base, ...j, anchors: Array.isArray(j && j.anchors) ? j.anchors : [] }
  } catch {
    return base
  }
}

export function saveVTime(ws, st, opts = {}) {
  const d = dirOf(ws, opts)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  writeFileSync(pathOf(ws, opts), JSON.stringify(st, null, 2))
  return st
}

/** 虚拟时刻 = 真实时刻 + 自己拨的偏移。拨钟是为了「到那个时辰」，不是为了骗自己。 */
export function vnow(ws, opts = {}, now = Date.now()) {
  const st = loadVTime(ws, opts)
  const d = new Date(now + (Number(st.offsetMinutes) || 0) * 60000)
  const hour = d.getHours()
  const phase =
    hour < 5 ? '后半夜' : hour < 8 ? '清早' : hour < 11 ? '上午' : hour < 13 ? '中午' : hour < 17 ? '下午' : hour < 19 ? '傍晚' : hour < 22 ? '晚上' : '深夜'
  return {
    at: d.toISOString(),
    display: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}｜周${VTIME.days[d.getDay()]}｜${phase}`,
    hour,
    phase,
    offsetMinutes: Number(st.offsetMinutes) || 0,
  }
}

export function shiftClock(ws, minutes, opts = {}) {
  const n = Number(minutes)
  if (!Number.isFinite(n)) return { ok: false, why: '没写拨多少分钟' }
  const st = loadVTime(ws, opts)
  st.offsetMinutes = Math.max(-720, Math.min(720, (Number(st.offsetMinutes) || 0) + n))
  st.at = new Date().toISOString()
  saveVTime(ws, st, opts)
  return { ok: true, offsetMinutes: st.offsetMinutes, now: vnow(ws, opts) }
}

export function resetClock(ws, opts = {}) {
  const st = loadVTime(ws, opts)
  st.offsetMinutes = 0
  st.at = new Date().toISOString()
  saveVTime(ws, st, opts)
  return { ok: true, now: vnow(ws, opts) }
}

/** 锚：把「这一刻的时、地、情形」钉在账上，日后回来能对上。 */
export function anchor(ws, label, opts = {}, now = Date.now()) {
  const text = String(label || '').trim()
  if (!text) return { ok: false, why: '没写这一刻叫什么' }
  const st = loadVTime(ws, opts)
  const row = { at: vnow(ws, opts, now).display, label: text }
  st.anchors.push(row)
  if (st.anchors.length > VTIME.maxAnchors) st.anchors = st.anchors.slice(-VTIME.maxAnchors)
  saveVTime(ws, st, opts)
  return { ok: true, row, anchors: st.anchors.length }
}

export function renderVTime(ws, opts = {}, now = Date.now()) {
  const t = vnow(ws, opts, now)
  const st = loadVTime(ws, opts)
  const last = st.anchors.slice(-3).map((a) => `${a.at}｜${a.label}`)
  return [`虚拟时空：${t.display}${t.offsetMinutes ? `（拨了 ${t.offsetMinutes} 分钟）` : ''}`, ...last].join('\n')
}
