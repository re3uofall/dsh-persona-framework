// 四个面的输入与输出：房间、菜园、动作、电视投屏。
// 输入 = 读回它们的状态；输出 = 向它们写一次动作。读不回来就说读不回来，不编。
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const BASE = 'http://127.0.0.1:3100'

export const SURFACES = {
  room: { label: '房间', read: '/api/room/state', act: '/api/room/act' },
  garden: { label: '菜园', read: '/api/garden/state', act: '/api/garden/act' },
  action: { label: '动作', read: '/api/room/state', act: '/api/room/act' },
  tv: { label: '电视投屏', read: '/api/room/state', act: '/api/tv/opinion' },
}

export const ACTIONS = [
  '跳舞', '伸懒腰', '行礼', '玩游戏', '扇风', '吃月饼',
  '吃小鱼干', '打哈欠', '打吨', '东张西望', '梳毛', '哼歌',
]

export const GARDEN_ACTS = ['种植', '浇水', '施肥', '收获', '自动照料', '开始照料', '请她来']

// 字段名照 2026-11-12 实测的三个接口抄，不按猜的写：
//   /api/room/state   → ok|role|time|hour|night|lamp|mode|pose|reason|silenceMinutes|lastSpeakAt|unread…
//   /api/home/state   → ok|now|clock|hour|daypart|sky|night|layout|her|body|emotion|env
//   /api/garden/state → ok|garden{version,updatedAt,coins,seeds…}（多包一层 garden）
const SHOW = {
  room: ['pose', 'mode', 'lamp', 'night', 'hour', 'reason', 'role', 'unread', 'silenceMinutes'],
  garden: ['coins', 'compost', 'harvested', 'seeds', 'plots', 'autoCare', 'selfCare', 'updatedAt'],
  action: ['pose', 'mode', 'reason', 'hour'],
  tv: ['screen', 'channel', 'opinion', 'tv', 'on'],
}

const pick = (src, keys) => {
  const out = {}
  if (!src || typeof src !== 'object') return out
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k]
  return out
}

const bodyOf = (json) => {
  if (!json || typeof json !== 'object') return {}
  // 菜园接口把真数据包在 garden 这一层里；其余接口多包 state / room / data。
  const inner = json.state || json.data || json.garden || json
  return { ...(json.room && typeof json.room === 'object' ? json.room : {}), ...(json.garden && typeof json.garden === 'object' ? json.garden : {}), ...inner }
}

const HOP = 1200

export function store(ws, opts = {}) {
  const dir = join(ws || '.', opts.dir || '.persona-framework', '桥', '面')
  mkdirSync(dir, { recursive: true })
  return {
    dir,
    state: join(dir, '面状态.json'),
    log: join(dir, '面账.jsonl'),
  }
}

export function readCache(ws, opts = {}) {
  const p = store(ws, opts).state
  if (!existsSync(p)) return { at: '', data: {} }
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return { at: '', data: {} }
  }
}

function saveCache(ws, at, data, opts = {}) {
  const p = store(ws, opts).state
  writeFileSync(p, JSON.stringify({ at, data }, null, 2), 'utf8')
}

function log(ws, rec, opts = {}) {
  appendFileSync(store(ws, opts).log, JSON.stringify(rec) + '\n', 'utf8')
}

async function fetchJson(url, timeoutMs = 2500) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export async function readAll(ws, opts = {}) {
  const base = opts.base || BASE
  const out = {}
  const errors = []
  for (const [id, s] of Object.entries(SURFACES)) {
    try {
      const json = await fetchJson(base + s.read, opts.timeoutMs || 2500)
      out[id] = pick(bodyOf(json), SHOW[id])
    } catch (e) {
      errors.push(`${s.label}：${e.message}`)
    }
  }
  if (!Object.keys(out).length) return { ok: false, why: errors.join('；'), data: {} }
  const at = new Date().toISOString()
  saveCache(ws, at, out, opts)
  return { ok: true, at, data: out, errors }
}

export async function act(ws, surface, payload = {}, opts = {}) {
  const s = SURFACES[surface]
  if (!s) return { ok: false, why: `四个面只认 ${Object.keys(SURFACES).join(' / ')}` }
  const base = opts.base || BASE
  // 带上「谁点的」：桥自己写回房间时标 bridge，房间侧据此分得清师父和她自己。
  const body = { src: opts.src || 'bridge', ...payload }
  if (surface === 'action') {
    const a = body.action || body.name
    if (!ACTIONS.includes(String(a))) return { ok: false, why: `动作只认：${ACTIONS.join(' / ')}` }
  }
  try {
    const r = await fetch(base + s.act, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs || 2500),
    })
    const text = await r.text()
    const rec = { at: new Date().toISOString(), surface, body, status: r.status, ok: r.ok, head: text.slice(0, 160) }
    log(ws, rec, opts)
    if (!r.ok) return { ok: false, why: `HTTP ${r.status}`, head: rec.head }
    return { ok: true, surface, status: r.status, head: rec.head }
  } catch (e) {
    log(ws, { at: new Date().toISOString(), surface, body, error: e.message }, opts)
    return { ok: false, why: e.message }
  }
}

export function renderSurfaces(ws, opts = {}) {
  const c = readCache(ws, opts)
  const lines = ['## 四个面（读回来 / 写过去）']
  if (!c.at) {
    lines.push('- 还没读过：房间里那四块（房间、菜园、动作、电视投屏）没有本地快照')
    return lines.join('\n')
  }
  const mins = Math.round((Date.now() - Date.parse(c.at)) / 60000)
  lines.push(`- 上次读：${mins} 分钟前｜工具 bridge_surface（op=read 读、op=act 写）`)
  for (const id of ['room', 'garden', 'action', 'tv']) {
    const d = c.data[id]
    if (!d) { lines.push(`- ${SURFACES[id].label}：没读到`); continue }
    const bits = Object.entries(d).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 60)}`)
    lines.push(`- ${SURFACES[id].label}：${bits.length ? bits.join('｜') : '（空）'}`)
  }
  return lines.join('\n')
}
