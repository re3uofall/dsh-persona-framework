/**
 * 整理人格文件：只看数、只搬不删、原地改。
 * ============================================================================
 * 一条判据管住全部动作：**进前缀的才花钱**。
 *   人格文件每轮都进系统提示，所以它省下来的字是真省的；
 *   搬去归档的那份不进前缀，删它一分不省——所以只搬，不删。
 *
 * 这里只放纯函数，不碰 fs、不认识 ctx。读写由 index.js 负责，好测。
 * ============================================================================
 */

export const LONG_SECTION = 1200
export const ARCHIVE_HINT = /旧|历史|已归档|过时|曾经|v\d+\.\d+\s*之前/

/** 按 `## ` 切段；`###` 与正文都算在所属那一段里。 */
export function parseSections(md) {
  const text = String(md ?? '')
  const lines = text.split(/\r?\n/)
  const out = []
  let cur = null
  for (const line of lines) {
    if (/^##\s+/.test(line) && !/^###/.test(line)) {
      if (cur) out.push(cur)
      cur = { title: line.replace(/^##\s+/, '').trim(), lines: [line] }
    } else if (cur) {
      cur.lines.push(line)
    }
  }
  if (cur) out.push(cur)
  return out.map((s, i) => ({
    i,
    title: s.title,
    text: s.lines.join('\n').replace(/\s+$/, ''),
    chars: s.lines.join('\n').replace(/\s+$/, '').length,
  }))
}

/** 段落级重复：同样 40 字以上的行出现两次以上。 */
export function duplicateLines(md) {
  const seen = new Map()
  for (const line of String(md ?? '').split(/\r?\n/)) {
    const t = line.trim()
    if (t.length < 40) continue
    if (t.startsWith('#') || t.startsWith('>') || t.startsWith('- ')) continue
    seen.set(t, (seen.get(t) || 0) + 1)
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([t, n]) => ({ text: t.slice(0, 60), times: n }))
}

export function analyze(md, opts = {}) {
  const long = Number(opts.long) > 0 ? Number(opts.long) : LONG_SECTION
  const text = String(md ?? '')
  const sections = parseSections(text)
  const longSections = sections.filter((s) => s.chars > long).map((s) => ({ i: s.i, title: s.title, chars: s.chars }))
  const archiveable = sections.filter((s) => ARCHIVE_HINT.test(s.title)).map((s) => ({ i: s.i, title: s.title, chars: s.chars }))
  return {
    chars: text.length,
    lines: text.split(/\r?\n/).length,
    sections: sections.map((s) => ({ i: s.i, title: s.title, chars: s.chars })),
    longSections,
    archiveable,
    dups: duplicateLines(text),
  }
}

/** 体检报告：先给数，再给「能搬什么」，最后说清代价。 */
export function renderReport(a, extra = {}) {
  const lines = [
    `人格文件：${a.chars} 字 / ${a.lines} 行 / ${a.sections.length} 段`,
    `　每轮都进前缀，所以这些字每步都付一遍（一轮十来步就是十来遍）。`,
  ]
  if (extra.stateLine) lines.push(`　${extra.stateLine}`)
  const top = [...a.sections].sort((x, y) => y.chars - x.chars).slice(0, 5)
  if (top.length) {
    lines.push('', '最大的几段：')
    for (const s of top) lines.push(`　${s.i}. ${s.title} — ${s.chars} 字`)
  }
  if (a.longSections.length) {
    lines.push('', `超过 ${LONG_SECTION} 字的长段（可以考虑搬走或拆开）：`)
    for (const s of a.longSections) lines.push(`　${s.i}. ${s.title} — ${s.chars} 字`)
  }
  if (a.archiveable.length) {
    lines.push('', '标题里带「旧 / 历史 / 已归档 / 过时」的段（`grow_compact` 会搬走它们）：')
    for (const s of a.archiveable) lines.push(`　${s.i}. ${s.title} — ${s.chars} 字`)
  }
  if (a.dups.length) {
    lines.push('', `重复的段落行 ${a.dups.length} 处：`)
    for (const d of a.dups.slice(0, 5)) lines.push(`　×${d.times}　${d.text}…`)
  }
  lines.push('', '只搬不删：搬走的落在 `persona-ai/characters/_archive/`，不回前缀，所以删它一分不省。')
  return lines.join('\n')
}

/** 取出一段（按标题片段找），找不到给候选。 */
export function pickSection(md, key) {
  const sections = parseSections(md)
  const k = String(key ?? '').trim()
  if (!k) return { error: '要说搬哪一段：给标题或编号（编号看 grow_report）。', sections }
  if (/^\d+$/.test(k)) {
    const s = sections[Number(k)]
    return s ? { section: s } : { error: `没有第 ${k} 段。`, sections }
  }
  const hits = sections.filter((s) => s.title.includes(k))
  if (hits.length === 1) return { section: hits[0] }
  if (!hits.length) return { error: `没有标题含「${k}」的段。`, sections }
  return { error: `「${k}」对上好几段，说细一点：` + hits.map((s) => `${s.i}. ${s.title}`).join(' / '), sections }
}

/** 从正文里摘掉一整段。 */
export function removeSection(md, index) {
  const sections = parseSections(md)
  const s = sections[index]
  if (!s) return { error: `没有第 ${index} 段。` }
  const text = String(md ?? '')
  const at = text.indexOf(s.text)
  if (at < 0) return { error: '这段在原文里对不上（可能刚被改过），重跑一次 grow_report。' }
  const rest = (text.slice(0, at) + text.slice(at + s.text.length)).replace(/\n{3,}/g, '\n\n')
  return { text: rest, moved: s.text, title: s.title }
}

/** 在文件里放一行指针，别让人以为那段凭空没了。 */
export function pointerFor(title, where) {
  return `> 「${title}」已搬到 \`${where}\`（只搬不删：要原文去那儿翻）`
}

const DIGEST_START = '<!-- DIGEST:START -->'
const DIGEST_END = '<!-- DIGEST:END -->'

/** 重建 DIGEST：一段目录，插在第一个 `## ` 之前；没有就放最前面。 */
export function rebuildDigest(md, at = new Date().toISOString().slice(0, 10)) {
  const text = String(md ?? '')
  const sections = parseSections(text)
  // 目录自己也进前缀，所以要短：只列标题，不列字数（字数在 grow_report 里看）。
  const body = [
    DIGEST_START,
    `> 目录（${at} 重建，${sections.length} 段）：` + sections.map((s) => s.title).join('｜'),
    DIGEST_END,
  ].join('\n')

  const s = text.indexOf(DIGEST_START)
  const e = text.indexOf(DIGEST_END)
  if (s >= 0 && e > s) return text.slice(0, s) + body + text.slice(e + DIGEST_END.length)

  const firstH2 = text.search(/^##\s+/m)
  if (firstH2 < 0) return `${body}\n\n${text}`.trim()
  return `${text.slice(0, firstH2)}${body}\n\n${text.slice(firstH2)}`
}

/** 原地替换：只许唯一命中，命中 0 或多次都不动。 */
export function replaceOnce(md, from, to) {
  const text = String(md ?? '')
  const needle = String(from ?? '')
  if (!needle) return { error: '要说清换哪一段（from）。' }
  const first = text.indexOf(needle)
  if (first < 0) return { error: '原文里找不到这段，什么都没改。' }
  if (text.indexOf(needle, first + 1) >= 0) return { error: '这段在原文里出现不止一次，说长一点再换。' }
  return { text: text.slice(0, first) + String(to ?? '') + text.slice(first + needle.length) }
}

/** 归档文件里的那一块。 */
export function archiveBlock(title, body, at = new Date().toISOString()) {
  return `\n\n---\n\n<!-- 从人格文件搬来 · ${at} -->\n\n${body}\n`
}
