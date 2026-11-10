import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { refreshCards } from './cardstore.mjs'

// 空闲整理：判据不是「到点了」，是「真的没人说话已经这么久」。
export const IDLE = {
  dir: '.persona-framework',
  file: '空闲整理账.jsonl',
  stateFile: '空闲状态.json',
  idleMinutes: 45,
  cooldownMinutes: 180,
  maxRunsPerDay: 2,
}

function dirOf(ws) {
  return join(ws || process.cwd(), IDLE.dir)
}
function stateOf(ws) {
  return join(dirOf(ws), IDLE.stateFile)
}
function ledgerOf(ws) {
  return join(dirOf(ws), IDLE.file)
}

export function loadIdleState(ws) {
  try {
    const p = stateOf(ws)
    if (!existsSync(p)) return { lastSeen: 0, runs: [], lastRun: 0 }
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    return { lastSeen: raw.lastSeen || 0, runs: Array.isArray(raw.runs) ? raw.runs : [], lastRun: raw.lastRun || 0 }
  } catch {
    return { lastSeen: 0, runs: [], lastRun: 0 }
  }
}

export function recordIdle(ws, now = Date.now()) {
  const st = loadIdleState(ws)
  const prev = st.lastSeen || now
  const gap = Math.max(0, now - prev)
  const next = { ...st, lastSeen: now }
  try {
    mkdirSync(dirOf(ws), { recursive: true })
    writeFileSync(stateOf(ws), JSON.stringify(next), 'utf8')
  } catch {
    /* 记不下就算了 */
  }
  return { ...next, gap, idleMinutes: Math.floor(gap / 60000) }
}

export function idleDue(st, now = Date.now()) {
  if (!st || !st.lastSeen) return false
  const gapMin = (now - st.lastSeen) / 60000
  if (gapMin < IDLE.idleMinutes) return false
  if (st.lastRun && now - st.lastRun < IDLE.cooldownMinutes * 60000) return false
  const today = new Date(now).toISOString().slice(0, 10)
  const todayRuns = (st.runs || []).filter((r) => String(r.at || '').slice(0, 10) === today).length
  return todayRuns < IDLE.maxRunsPerDay
}

// 一步做完：记一次「人还在」；闲够久就落一行账（只落账，不动别人的账本）。
export function noteIdleStep(ws, now = Date.now()) {
  try {
    const st = recordIdle(ws, now)
    if (!idleDue(st, now)) return null
    const row = { at: new Date(now).toISOString(), kind: 'idle-due', idleMinutes: st.idleMinutes }
    try { row.cards = refreshAll(ws, now) } catch { row.cards = null }
    mkdirSync(dirOf(ws), { recursive: true })
    appendFileSync(ledgerOf(ws), JSON.stringify(row) + '\n')
    const next = { ...st, lastRun: now, runs: [...(st.runs || []), row].slice(-50) }
    writeFileSync(stateOf(ws), JSON.stringify(next), 'utf8')
    return row
  } catch {
    return null
  }
}

export function renderIdle(ws, now = Date.now()) {
  const st = loadIdleState(ws)
  const gapMin = st.lastSeen ? Math.floor((now - st.lastSeen) / 60000) : null
  const lines = [
    '## 空闲整理',
    gapMin == null ? '还没记过「人还在」。' : `距上一次说话：${gapMin} 分钟（阈值 ${IDLE.idleMinutes}）。`,
    `今天已整理：${(st.runs || []).filter((r) => String(r.at || '').slice(0, 10) === new Date(now).toISOString().slice(0, 10)).length} / ${IDLE.maxRunsPerDay}`,
  ]
  return lines.join('\n')
}

// 三类文件卡片：人格 / 记忆 / 框架。读旧卡、比指纹、写回，只报三样：新加、改过、删掉。
export function refreshAll(ws, now = Date.now()) {
  const roots = {
    persona: join(ws || process.cwd(), 'persona-ai', 'characters'),
    memory: join(ws || process.cwd(), 'persona-ai', 'knowledge'),
    framework: ws || process.cwd(),
  }
  const out = {}
  for (const [kind, dir] of Object.entries(roots)) {
    try {
      const r = refreshCards(ws, kind + '-files', dir)
      out[kind] = r.diff
    } catch (error) {
      out[kind] = { error: String(error && error.message ? error.message : error) }
    }
  }
  return out
}

export function cardsSummary(diff) {
  if (!diff) return ''
  const parts = []
  for (const [kind, d] of Object.entries(diff)) {
    if (!d || d.error) { parts.push(kind + '：读不出来'); continue }
    parts.push(kind + ' 新' + d.added.length + ' 改' + d.modified.length + ' 删' + d.removed.length)
  }
  return parts.join('｜')
}
