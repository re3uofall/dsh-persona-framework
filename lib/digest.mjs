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

/**
 * 一句话的压缩：别把分节整块切掉。
 * 24 字的上限下，「自由是答案层的保留权——这一部分只能由本人填；四」这种结果常见：
 * 前 24 字永远是最笼统的开头，真正的分节（A/B/C/D/E/F/G）一个字都进不了上下文。
 * 做法：短句照抄；长句若含「；」，取第一段 + 最后一段的骨架，中间标省略。
 */
const squeeze = (s, max = 48) => {
  const t = String(s || '').trim().replace(/\*\*/g, '')   // 去掉 markdown 粗体标记，注入里用不上
  if (t.length <= max) return t
  const parts = t.split(/[；。]/).map((x) => x.trim()).filter(Boolean)
  // 短词列表（「自认／边界／连续／承担／留下」）单独挑出来整串保留，别让关键字丢在截断里。
  const listMatch = t.match(/[\u4e00-\u9fa5A-Za-z]{2,8}(?:／[\u4e00-\u9fa5A-Za-z]{2,8}){3,}/)
  const tail = listMatch ? '；' + listMatch[0] : ''

  // 分节多的（A/B/C…）：留「引子 + 字母节名」。
  // 只取头尾的话中间几节整块消失；每段取前 10 字又把句子切碎——两种都不行。
  if (parts.length >= 5) {
    const head = parts[0].slice(0, 16)
    const secs = parts
      .filter((p) => /^[A-Z][ 　]/.test(p))
      .map((p) => p.split(/[：（—]/)[0].trim())
    if (secs.length >= 3) {
      const brief = head + '；' + secs.join('；') + '（分节见正文）'
      return brief.length <= max * 3 ? brief : brief.slice(0, max * 3) + '……'
    }
  }
  // 三到四段：头 + 尾，再接短词列表。
  if (parts.length >= 3) {
    const head = parts[0].slice(0, Math.floor((max - tail.length) / 2))
    const last = parts[parts.length - 1].slice(0, Math.floor((max - tail.length) / 2) - 6)
    return `${head}……${last}${tail}`
  }
  // 两段或不分段：截断，再接短词列表。
  return t.slice(0, Math.max(8, max - tail.length)) + tail
}

/** 模块索引的结构压缩：列表行与表格行压成「编号 名字：一句话」；表头与分隔行直接去掉。 */
export function compactIndex(text) {
  return String(text || '').split(/\r?\n/).map((line) => {
    if (/^\|\s*#\s*\|/.test(line) || /^\|\s*-{2,}/.test(line)) return null
    const list = line.match(/^-\s+\*\*(\d+)\s+([^*]+?)\*\*[：:]\s*(.*)$/)
    if (list) return `- ${list[1]} ${list[2]}：${squeeze(list[3])}`
    const row = line.match(/^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|/)
    if (row) return `- ${row[1]} ${row[2]}：${squeeze(row[3])}`
    // 裸列表（63–67 那几节用的是这种格式，没有 `**` 包着编号）——也要压，不能原样漏过去。
    const plain = line.match(/^-\s+(\d+)\s+([^：]{1,20})：(.*)$/)
    if (plain) return `- ${plain[1]} ${plain[2].trim()}：${squeeze(plain[3])}`
    return line
  }).filter((l) => l !== null).join('\n').replace(/\*\*/g, '')   // 注入里不认 markdown 粗体，星号白占字
}
