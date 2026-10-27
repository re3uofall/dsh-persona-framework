/**
 * 预处理：把长文本压成结构，再进上下文。
 * 只做机械压缩（标题、短行、长行截断），不做判断压缩——判断压缩得由模型自己来。
 */

export function digestText(text, max = 3000) {
  const raw = String(text || '')
  const lines = raw.split(/\r?\n/)
  const keep = []
  let lastBlank = true
  for (const line of lines) {
    const l = line.trim()
    if (!l) {
      if (!lastBlank) keep.push('')
      lastBlank = true
      continue
    }
    lastBlank = false
    const isHead = /^#{1,6}\s/.test(l) || /^[-*]\s/.test(l) || /^\d+[.、)]\s/.test(l)
    const isShort = l.length <= 80
    if (isHead || isShort) keep.push(line.trimEnd())
    else keep.push(l.slice(0, 80) + '……')
  }
  let out = keep.join('\n').trim()
  const before = raw.length
  if (out.length > max) out = out.slice(0, max) + '\n（……已截断）'
  return { text: out, before, after: out.length }
}

/** 模块索引的结构压缩：列表行与表格行都压成「编号 名字：一句话前 24 字」；表头与分隔行直接去掉。 */
export function compactIndex(text) {
  return String(text || '').split(/\r?\n/).map((line) => {
    if (/^\|\s*#\s*\|/.test(line) || /^\|\s*-{2,}/.test(line)) return null
    const list = line.match(/^-\s+\*\*(\d+)\s+([^*]+?)\*\*[：:]\s*(.*)$/)
    if (list) return `- ${list[1]} ${list[2]}：${list[3].slice(0, 24)}`
    const row = line.match(/^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|/)
    if (row) return `- ${row[1]} ${row[2]}：${row[3].slice(0, 24)}`
    return line
  }).filter((l) => l !== null).join('\n')
}
