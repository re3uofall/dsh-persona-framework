/**
 * 嘴账：一句话 + 通道的回执。说「真说出去了」，不是「打算说」。
 * 一行一条，追加写；读只读尾巴。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const MAX_LINES_READ = 200

function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

/** 一条嘴账压成一行：送没送到、送给谁、说了哪半句。 */
export function briefOf(entry) {
  const to = clip(entry?.to, 12)
  const text = clip(entry?.text, 48)
  const head = entry?.ok ? '✓' : `✗(${entry?.code ?? '?'})`
  return `${head} ${to ? `→ ${to}：` : ''}「${text}」${entry?.channel ? `（${entry.channel}）` : ''}`
}

export function appendSaying(file, entry) {
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8')
}

export function readSayings(file, limit = 10) {
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
      /* 坏行跳过 */
    }
  }
  return out
}

export function countSayings(file) {
  if (!existsSync(file)) return 0
  try {
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).length
  } catch {
    return 0
  }
}

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

export function renderSayings(list) {
  if (!Array.isArray(list) || !list.length) return '嘴账还是空的——一句真说出去的话都没有。'
  return list.map((e) => `- ${briefOf(e)}`).join('\n')
}
