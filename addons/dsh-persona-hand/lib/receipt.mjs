/**
 * 手账：动作 + 回执。说「做了什么」，不是「打算做什么」。
 * 一行一条，追加写；读只读尾巴。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const MAX_LINES_READ = 200

/** 一条回执压成一行给人看的。命令本身截短，输出只留第一行有内容的。 */
export function briefOf(entry) {
  const cmd = String(entry?.command || '').replace(/\s+/g, ' ').trim()
  const shown = cmd.length > 80 ? cmd.slice(0, 77) + '…' : cmd
  // 注意：Number(null) === 0，超时那条 code 是 null，不能让它显示成 ✓
  const code = entry?.code
  const ok = code !== null && code !== undefined && Number(code) === 0
  const first = String(entry?.first || '').replace(/\s+/g, ' ').trim()
  return `${ok ? '✓' : `✗(${entry?.code ?? '?'})`} ${shown}${first ? ` → ${first.length > 60 ? first.slice(0, 57) + '…' : first}` : ''}`
}

export function appendReceipt(file, entry) {
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8')
}

export function readReceipts(file, limit = 10) {
  if (!existsSync(file)) return []
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const lines = raw.split('\n').filter(Boolean)
  const tail = lines.slice(-Math.max(1, Math.min(MAX_LINES_READ, Number(limit) || 10)))
  const out = []
  for (const line of tail) {
    try {
      out.push(JSON.parse(line))
    } catch {
      /* 坏行跳过，不影响别的 */
    }
  }
  return out
}

export function countReceipts(file) {
  if (!existsSync(file)) return 0
  try {
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).length
  } catch {
    return 0
  }
}

/** 未说出口的那几次动手：触发器要拿它决定注不注。 */
export function readPending(file) {
  if (!existsSync(file)) return { pending: [], spokenAt: '' }
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'))
    return { pending: Array.isArray(j.pending) ? j.pending : [], spokenAt: String(j.spokenAt || '') }
  } catch {
    return { pending: [], spokenAt: '' }
  }
}

export function writePending(file, state) {
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ ...state, at: new Date().toISOString() }, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

export function renderReceipts(list) {
  if (!Array.isArray(list) || !list.length) return '手账还是空的——一件真动过的事都没有。'
  return list.map((e) => `- ${briefOf(e)}`).join('\n')
}
