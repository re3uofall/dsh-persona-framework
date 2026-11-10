import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// 状态行：只记「还在跑的东西」，跑完就摘；短于一分钟的不进状态行（那不算「在跑」，那是流水）。
export const STATUSBAR = {
  dir: '.persona-framework',
  file: '状态行.json',
  showAfterMs: 60 * 1000,
  maxRows: 4,
  keepFinishedMs: 10 * 60 * 1000,
}

function fileOf(ws) {
  return join(ws || process.cwd(), STATUSBAR.dir, STATUSBAR.file)
}

export function loadStatus(ws) {
  const p = fileOf(ws)
  try {
    if (!existsSync(p)) return { runs: [] }
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    return { runs: Array.isArray(raw && raw.runs) ? raw.runs : [] }
  } catch {
    return { runs: [] }
  }
}

function save(ws, state) {
  const p = fileOf(ws)
  mkdirSync(join(ws || process.cwd(), STATUSBAR.dir), { recursive: true })
  writeFileSync(p, JSON.stringify(state), 'utf8')
}

export function beginRun(ws, name, now = Date.now()) {
  const id = `r${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`
  try {
    const st = loadStatus(ws)
    st.runs.push({ id, name: String(name || '工具'), start: now, end: 0, ok: null })
    save(ws, st)
  } catch {
    /* 状态行坏了不能挡住工具 */
  }
  return id
}

export function endRun(ws, id, ok = true, now = Date.now()) {
  try {
    const st = loadStatus(ws)
    const row = st.runs.find((r) => r.id === id)
    if (!row) return null
    row.end = now
    row.ok = ok !== false
    const keep = st.runs.filter((r) => {
      if (!r.end) return true
      if (r.end - r.start < STATUSBAR.showAfterMs) return false
      return now - r.end < STATUSBAR.keepFinishedMs
    })
    save(ws, { runs: keep })
    return row
  } catch {
    return null
  }
}

export function renderStatusline(ws, now = Date.now()) {
  const st = loadStatus(ws)
  const rows = st.runs.filter((r) => {
    const span = (r.end || now) - r.start
    return span >= STATUSBAR.showAfterMs
  })
  if (!rows.length) return ''
  const lines = rows.slice(-STATUSBAR.maxRows).map((r) => {
    const span = Math.round(((r.end || now) - r.start) / 1000)
    if (!r.end) return `- ${r.name}｜${span}s 还在跑`
    return `- ${r.name}｜${span}s ${r.ok ? '已完成' : '没办成'}`
  })
  return ['## 状态行（只列超过一分钟的）', ...lines].join('\n')
}
