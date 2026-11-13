// 看房间：房间那边（模板桥接）有自己的状态，但它不往我们的 events.jsonl 写。
// 这个模块定时读它的 /api/room/state 与 /api/home/state，把变化 diff 成 events.jsonl 的行，
// 环境文件与家里段就有真输入源了。读不到就明说读不到，不编。

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const WATCH = {
  base: 'http://127.0.0.1:3100',
  dir: '.persona-framework',
  sub: '桥/home',
  events: 'events.jsonl',
  state: 'watch.json',
  minGapMs: 15000,
  timeoutMs: 2500,
}

const KEYS = [
  ['room', '房间'],
  ['roomName', '房间'],
  ['pose', '姿势'],
  ['action', '动作'],
  ['activity', '在过什么'],
  ['bubble', '气泡'],
  ['say', '说话'],
  ['text', '说话'],
  ['energy', '力气'],
  ['awake', '醒着'],
  ['lastSrc', '来源'],
]

const dirOf = (ws, opts = {}) => join(ws || '.', opts.dir || WATCH.dir, WATCH.sub)
const fileOf = (ws, name, opts = {}) => join(dirOf(ws, opts), name)

function readJson(p, fallback) {
  if (!existsSync(p)) return fallback
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(p, value) {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(value, null, 2), 'utf8')
}

export function readWatch(ws, opts = {}) {
  return readJson(fileOf(ws, WATCH.state, opts), { at: '', snap: {} })
}

function flat(v) {
  if (v == null) return ''
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v).slice(0, 60)
    } catch {
      return ''
    }
  }
  return String(v).slice(0, 60)
}

// 只认我们自己关心的那几个字段；其余一律不进快照，免得每轮都被随机字段扰动。
export function snapshotOf(json) {
  const src = (json && (json.state || json.room || json.data)) || json || {}
  const out = {}
  if (typeof src !== 'object') return out
  for (const [key] of KEYS) {
    if (Object.prototype.hasOwnProperty.call(src, key) && src[key] != null) out[key] = flat(src[key])
  }
  if (json && typeof json.room === 'object' && json.room) {
    for (const [key] of KEYS) {
      if (Object.prototype.hasOwnProperty.call(json.room, key) && json.room[key] != null) out[key] = flat(json.room[key])
    }
  }
  // 她的走动在 /api/home/state 的 her 里（room/pose/act）；/api/room/state 的 pose 是面板状态，不是她。
  // 不把 her 写进快照，点「走到床上」在她那边动了，这边也永远算「没变化」。
  const her = json && json.her
  if (her && typeof her === 'object') {
    if (her.room != null) out.room = flat(her.room)
    if (her.pose != null) out.pose = flat(her.pose)
    if (her.act != null) out.action = flat(her.act)
  }
  // 谁点的：房间在 act 里写了 lastAct（user / bridge / self），带进快照。
  // 少了这一栏，会话那边就分不出「师父叫我」和「她自己走出来的」。
  const lastAct = (json && json.lastAct) || (her && her.lastAct) || (src && src.lastAct)
  if (lastAct && typeof lastAct === 'object' && lastAct.src != null) out.lastSrc = flat(lastAct.src)
  return out
}

export function diffOf(prev = {}, cur = {}) {
  const lines = []
  const keys = new Set([...Object.keys(prev), ...Object.keys(cur)])
  for (const key of keys) {
    if (prev[key] === cur[key]) continue
    const label = (KEYS.find(([k]) => k === key) || [key, key])[1]
    lines.push(`${label}：${prev[key] || '—'} → ${cur[key] || '—'}`)
  }
  return lines
}

async function fetchJson(url, timeoutMs) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) return null
  return res.json()
}

// 看一次房间。节流、diff、落 events.jsonl，都在这里。
export async function watchRoom(ws, opts = {}) {
  const state = readWatch(ws, opts)
  const minGapMs = opts.minGapMs ?? WATCH.minGapMs
  if (state.at && Date.now() - Date.parse(state.at) < minGapMs) {
    return { ok: true, skipped: `刚看过（${Math.round((Date.now() - Date.parse(state.at)) / 1000)} 秒前）` }
  }

  const base = opts.base || WATCH.base
  const timeoutMs = opts.timeoutMs ?? WATCH.timeoutMs
  let hit = ''
  let snap = {}
  for (const path of ['/api/room/state', '/api/home/state']) {
    try {
      const json = await fetchJson(base + path, timeoutMs)
      if (!json) continue
      hit = path
      snap = { ...snap, ...snapshotOf(json) }
    } catch {
      // 一条路不通不算错，另一条也许通；两条都不通才报。
    }
  }

  if (!hit) {
    writeJson(fileOf(ws, WATCH.state, opts), { ...state, at: state.at || '', why: `读不到房间（${base} 没响应）` })
    return { ok: false, why: `读不到房间：${base} 的 /api/room/state 与 /api/home/state 都没响应` }
  }

  const lines = diffOf(state.snap || {}, snap)
  writeJson(fileOf(ws, WATCH.state, opts), { at: new Date().toISOString(), path: hit, snap })

  if (!lines.length) return { ok: true, path: hit, changed: 0 }

  mkdirSync(dirOf(ws, opts), { recursive: true })
  const at = new Date().toISOString()
  for (const text of lines) {
    appendFileSync(fileOf(ws, WATCH.events, opts), JSON.stringify({ at, who: '屋里', text }) + '\n', 'utf8')
  }
  return { ok: true, path: hit, changed: lines.length, lines }
}

export function renderWatchStatus(ws, opts = {}) {
  const state = readWatch(ws, opts)
  const events = fileOf(ws, WATCH.events, opts)
  const total = existsSync(events) ? readFileSync(events, 'utf8').split(/\r?\n/).filter(Boolean).length : 0
  const mins = state.at ? Math.max(0, Math.round((Date.now() - Date.parse(state.at)) / 60000)) : null
  return [
    `看房间：${state.at ? `上次 ${mins} 分钟前（${state.path || '—'}）` : '还没看过'}`,
    `屋里记下的动静：${total} 条`,
    state.why ? `上一次读不到：${state.why}` : '',
  ]
    .filter(Boolean)
    .join('｜')
}

export const __internal = { fileOf, dirOf, flat }
