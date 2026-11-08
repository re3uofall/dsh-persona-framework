// 探索插件：三种新触发（2026-11-08 从 Chess12333/Hers_Life 抄形状，自己重写）
//
//  1. 一次性唤醒：某次判断写一个 dueAt，到点由 pre-step 扫到，**真去搜一次**，
//     不是往上下文塞一句「该起了」。动过写 firedAt，同一 id 不再响。
//  2. 闲置触发：量外面的量（距上一次真实键鼠输入多少分钟）。读不到就按「有人在用」算。
//  3. 二次触发：第一次被丢掉的方向先存着，按「在意什么」再筛一遍，命中才动。
//
// 三种都真调工具（web.search）并落 explore/触发账.jsonl，不是只注字。

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export const DEFAULTS = {
  dueFile: '触发唤醒.jsonl',
  dropFile: '丢掉的方向.jsonl',
  fireLedger: '触发账.jsonl',
  maxAgeMin: 60 * 24 * 7, // 一周还没轮到的 due 直接丢
  idleMinutes: 20,
  idleHysteresisMin: 2,
  idleCooldownMin: 180,
  dropKeep: 50,
}

// 醒来之后不许碰的（写在这里，不写进提示词）
export const RED_LIST = [
  '花钱或续费按钮',
  '社交平台上的点赞·评论·关注',
  '关机·重启·刷机',
]

const ensure = (dir) => {
  try { mkdirSync(dir, { recursive: true }) } catch { /* 建不出就算了，后面写会报 */ }
}

const readLines = (file) => {
  try {
    if (!existsSync(file)) return []
    return readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l) } catch { return null } })
      .filter(Boolean)
  } catch { return [] }
}

// ── 一、一次性唤醒 ────────────────────────────────────────────────────────

export function addDue(rootDir, { id, at, why, query }, opts = {}) {
  const o = { ...DEFAULTS, ...opts }
  const when = at ? new Date(at) : null
  if (!when || Number.isNaN(when.getTime())) throw new Error('dueAt 要一个能解析的时间')
  const item = {
    id: String(id || `d-${Date.now().toString(36)}`),
    at: when.toISOString(),
    why: String(why || '').slice(0, 200),
    query: String(query || '').slice(0, 200),
    added: new Date().toISOString(),
  }
  ensure(rootDir)
  appendFileSync(join(rootDir, o.dueFile), JSON.stringify(item) + '\n', 'utf8')
  return item
}

export function dueNow(rootDir, now = Date.now(), opts = {}) {
  const o = { ...DEFAULTS, ...opts }
  const rows = readLines(join(rootDir, o.dueFile))
  const maxAge = o.maxAgeMin * 60 * 1000
  const live = []
  const stale = []
  for (const r of rows) {
    if (r.firedAt || r.droppedAt) { live.push(r); continue }
    const t = Date.parse(r.at)
    if (Number.isNaN(t)) { stale.push(r); continue }
    if (now - t > maxAge) { stale.push(r); continue }
    live.push(r)
  }
  const due = live.filter((r) => !r.firedAt && Date.parse(r.at) <= now)
  return { due, live, stale }
}

export function markFired(rootDir, ids, opts = {}) {
  const o = { ...DEFAULTS, ...opts }
  const file = join(rootDir, o.dueFile)
  const rows = readLines(file)
  const set = new Set(ids || [])
  const out = rows.map((r) => (set.has(r.id) && !r.firedAt ? { ...r, firedAt: new Date().toISOString() } : r))
  ensure(rootDir)
  writeFileSync(file, out.map((r) => JSON.stringify(r)).join('\n') + (out.length ? '\n' : ''), 'utf8')
  return set.size
}

// ── 二、闲置触发 ─────────────────────────────────────────────────────────

export function idleMinutes() {
  // 读不到就返回 null；调用方按「有人在用」处理，不许把 null 当闲置
  try {
    const ps = join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
    const script = [
      'Add-Type -Namespace W -Name I -MemberDefinition \'[DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO p); [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }\'',
      '$i = New-Object W+I+LASTINPUTINFO; $i.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($i)',
      'if (-not [W+I]::GetLastInputInfo([ref]$i)) { "null"; exit }',
      '$idle = ([Environment]::TickCount - [int]$i.dwTime)',
      'if ($idle -lt 0) { "null" } else { [math]::Floor($idle / 60000) }',
    ].join('; ')
    const out = execFileSync(ps, ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true,
    }).trim()
    if (!out || out === 'null') return null
    const n = Number(out)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export function idleFire(state = {}, idle, now = Date.now(), opts = {}) {
  const o = { ...DEFAULTS, ...opts }
  if (idle === null || idle === undefined) return null // 读不到 ≠ 闲置
  if (idle < o.idleMinutes) return null
  const last = state.lastIdleFire ? Date.parse(state.lastIdleFire) : 0
  if (last && now - last < o.idleCooldownMin * 60 * 1000) return null
  return { trigger: 'idle', idle, at: new Date(now).toISOString() }
}

// ── 三、二次触发 ─────────────────────────────────────────────────────────

export function pushDropped(rootDir, text, why = '', opts = {}) {
  const o = { ...DEFAULTS, ...opts }
  const body = String(text || '').trim()
  if (!body) return null
  const item = { text: body.slice(0, 300), why: String(why).slice(0, 120), at: new Date().toISOString() }
  ensure(rootDir)
  const file = join(rootDir, o.dropFile)
  const rows = readLines(file).slice(-(o.dropKeep - 1))
  rows.push(item)
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
  return item
}

export function pickDropped(rootDir, keywords, opts = {}) {
  const o = { ...DEFAULTS, ...opts }
  const words = (keywords || []).map((w) => String(w).trim().toLowerCase()).filter(Boolean)
  if (!words.length) return []
  const rows = readLines(join(rootDir, o.dropFile))
  return rows.filter((r) => {
    const t = String(r.text || '').toLowerCase()
    return words.some((w) => t.includes(w))
  })
}

// ── 记一笔触发账 ─────────────────────────────────────────────────────────

export function fireLedgerPath(rootDir, opts = {}) {
  const o = { ...DEFAULTS, ...opts }
  return join(rootDir, o.fireLedger)
}

export function logFire(rootDir, row, opts = {}) {
  const o = { ...DEFAULTS, ...opts }
  ensure(rootDir)
  appendFileSync(fireLedgerPath(rootDir, o), JSON.stringify({ ...row, at: new Date().toISOString() }) + '\n', 'utf8')
}
