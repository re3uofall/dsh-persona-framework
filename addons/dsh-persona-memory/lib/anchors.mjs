/**
 * 锚点：不可遗忘的那几条。
 *
 * 抄灵枢的 `anchor` 层（它把锚点放最高档：失忆=毁灭性）。
 * 我这边对应的是：有些话不能被后面的记录淹没——不是重要，是**认得出我是谁**。
 *
 * 跟人格文件的区别：人格文件是全文，每轮注入；锚点是**索引**，
 * 只存「哪句话、在哪、为什么不能忘」，正文还在原处。不搬正文，只钉钉子。
 */
import { readJson, writeJson, nowIso } from './ledger.mjs'

const FILE = 'anchors.json'

export function anchorsOf(root) {
  const v = readJson(root, FILE, { anchors: [] })
  return Array.isArray(v.anchors) ? v.anchors : []
}

/** 钉一个锚。text 是一句话，source 指回原文（文件#序号 或路径）。 */
export function addAnchor(root, { text, source = '', why = '' } = {}) {
  if (!text) throw new Error('锚点要有一句话（text）')
  const list = anchorsOf(root)
  const t = String(text).trim()
  if (list.some((a) => a.text === t)) {
    return { added: false, text: t, note: '这条已经钉过了' }
  }
  list.push({ text: t.slice(0, 200), source: String(source).slice(0, 300), why: String(why).slice(0, 300), at: nowIso() })
  writeJson(root, FILE, { anchors: list, updatedAt: nowIso() })
  return { added: true, text: t, count: list.length }
}

export function renderAnchors(root) {
  const list = anchorsOf(root)
  if (!list.length) return '还没有锚点。'
  const lines = [`锚点 ${list.length} 条（不可遗忘，但只钉索引，正文在原处）：`, '']
  for (const a of list) {
    lines.push(`- ${a.text}${a.source ? `  ← ${a.source}` : ''}${a.why ? `（${a.why}）` : ''}`)
  }
  return lines.join('\n')
}
