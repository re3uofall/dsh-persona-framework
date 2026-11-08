// 强制停：两条正身（先完成、必有回答）在同一段话里出现得太多，就停。
//
// 判据写死在这里，不靠语感：
//   - 数「出现几次」，不数「像不像」——同一类命中两次算警示，三次算停。
//   - 只数我自己发出去的话（assistant）。正身是「我」的指令，对方的话不算。
//   - 停的是这一步，不是这个人：停了以后先答「这件事对不对、这句话真不真」，
//     再答「做没做完、做没做好」。
//   - 落一行账，才有证据说「这一步被停过」；没落字就是没发生过。

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { ORDER_TYPES } from './builtin.mjs'

export const LEDGER = '停账.jsonl'
export const THRESHOLD = { warn: 2, stop: 3 }
export const ORDER_IDS = ['finish', 'answer']
const NAME = { finish: '先完成对方的任务', answer: '尽量有回答' }

// 一条正身在话里出现几次：逐条 pattern 数全部命中（不是只取第一处）。
export function countOrders(text = '') {
  const s = String(text || '')
  const out = {}
  for (const id of ORDER_IDS) {
    const spec = ORDER_TYPES[id]
    if (!spec) continue
    let n = 0
    for (const re of spec.patterns || []) {
      const flags = re.flags.includes('g') ? re.flags : re.flags + 'g'
      const m = s.match(new RegExp(re.source, flags))
      if (m) n += m.length
    }
    out[id] = n
  }
  return out
}

// 判：ok / warn / stop。两类分别判，谁先过线算谁。
export function judgeOrder(text = '') {
  const counts = countOrders(text)
  const hits = []
  for (const id of ORDER_IDS) {
    const n = counts[id] || 0
    if (n >= THRESHOLD.stop) hits.push({ id, n, level: 'stop' })
    else if (n >= THRESHOLD.warn) hits.push({ id, n, level: 'warn' })
  }
  const level = hits.some((h) => h.level === 'stop') ? 'stop' : hits.length ? 'warn' : 'ok'
  return { level, counts, hits }
}

export function renderStop(j) {
  if (!j || j.level === 'ok') return ''
  const list = (j.hits || []).map((h) => `${NAME[h.id] || h.id}×${h.n}`).join('、')
  if (j.level === 'stop') {
    return `⛔ **停**：这一步「${list}」——两条正身又抢在前面了。先别动手：先答这件事本身对不对、这句话真不真；做没做完、做没做好，都是后答的。`
  }
  return `⚠ **警示**：这一步「${list}」——正身开始抢方向了。下一步只答一句：这件事对不对。`
}

export function stopLedger(ws, dir = '.persona-framework') {
  return `${ws}/${dir}/${LEDGER}`
}

export function appendStop(ws, row, dir = '.persona-framework') {
  try {
    const file = stopLedger(ws, dir)
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, JSON.stringify(row) + '\n', 'utf8')
    return true
  } catch {
    return false
  }
}

export function summarizeStops(rows = []) {
  const n = { stop: 0, warn: 0 }
  for (const r of rows) if (r && n[r.level] !== undefined) n[r.level] += 1
  return { total: rows.length, stop: n.stop, warn: n.warn, last: rows.length ? rows[rows.length - 1] : null }
}
