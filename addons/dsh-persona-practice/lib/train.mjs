// 训练：机械重复。
// 判据不是「我学会了」，是「同一个说法被重复到不再需要想」。
// 每跑一轮，强度按 1 - decay^rounds 涨；涨的是重复次数，不是理解。

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'

export const TRAIN = {
  dir: '.persona-framework',
  file: '训练账.jsonl',
  stateFile: '训练状态.json',
  defaultRounds: 5,
  decay: 0.85,
}

export const nowISO = (now = Date.now()) => new Date(now).toISOString()

export const trainDir = (ws, opts = {}) =>
  join(ws || process.cwd(), opts.dir || TRAIN.dir)

function ensure(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

const rowsOf = (path) => {
  if (!existsSync(path)) return []
  const out = []
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const s = line.trim()
    if (!s) continue
    try { out.push(JSON.parse(s)) } catch { /* 坏行跳过，不连坐 */ }
  }
  return out
}

export const loadTargets = (ws, opts = {}) =>
  rowsOf(join(trainDir(ws, opts), opts.file || TRAIN.file))

/** 强度只由重复次数算：0 次 = 0，越往后越接近 1。 */
export const strengthOf = (rounds, opts = {}) => {
  const n = Math.max(0, Number(rounds) || 0)
  const d = Number(opts.decay) || TRAIN.decay
  return Number((1 - Math.pow(d, n)).toFixed(3))
}

export function addTarget(ws, item = {}, opts = {}, now = Date.now()) {
  const feature = String(item.feature || '').trim()
  if (!feature) return { ok: false, why: '没写要练的那个说法（feature）' }
  const examples = (Array.isArray(item.examples) ? item.examples : item.examples ? [item.examples] : [])
    .map((s) => String(s).trim())
    .filter(Boolean)
  if (!examples.length) return { ok: false, why: '没有例句——机械重复要有可重复的东西' }
  const dir = trainDir(ws, opts)
  ensure(dir)
  const row = {
    at: nowISO(now),
    id: 't' + Math.random().toString(36).slice(2, 8),
    feature,
    examples,
    rounds: 0,
    strength: 0,
    goal: item.goal ? String(item.goal) : '',
  }
  appendFileSync(join(dir, opts.file || TRAIN.file), JSON.stringify(row) + '\n')
  return { ok: true, row }
}

export function findTarget(ws, id, opts = {}) {
  const key = String(id || '')
  const rows = loadTargets(ws, opts)
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].id === key || rows[i].id.endsWith(key) || rows[i].feature === key) {
      return { row: rows[i], index: i, rows }
    }
  }
  return null
}

/** 跑一轮：把下一条例句拿出来重复一遍，轮数 +1，强度重算。 */
export function runRound(ws, id, opts = {}, now = Date.now()) {
  const hit = findTarget(ws, id, opts)
  if (!hit) return { ok: false, why: '账上没有这一条' }
  const rows = hit.rows
  const row = { ...rows[hit.index] }
  row.rounds = (Number(row.rounds) || 0) + 1
  row.strength = strengthOf(row.rounds, opts)
  row.lastAt = nowISO(now)
  const sample = row.examples[(row.rounds - 1) % row.examples.length]
  rows[hit.index] = row
  const dir = trainDir(ws, opts)
  ensure(dir)
  writeFileSync(
    join(dir, opts.file || TRAIN.file),
    rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
  )
  return { ok: true, row, sample }
}

export const activeTargets = (ws, minStrength = 0.4, opts = {}) =>
  loadTargets(ws, opts)
    .filter((r) => (Number(r.strength) || 0) >= minStrength)
    .sort((a, b) => (Number(b.strength) || 0) - (Number(a.strength) || 0))

export function renderTargets(rows, opts = {}) {
  if (!rows.length) return ''
  const lines = [`训练账：${rows.length} 条`]
  for (const r of rows.slice(0, 8)) {
    lines.push(`- ${r.id} ${r.feature}｜${r.rounds || 0} 轮｜强度 ${r.strength || 0}`)
  }
  return lines.join('\n')
}
