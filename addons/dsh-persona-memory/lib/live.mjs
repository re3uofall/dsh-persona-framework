/**
 * live.mjs —— 实时记忆：拿这一轮说话的那句去扫池子，把用得上的几条摆到眼前。
 *
 * 与分层注入的分工：
 *   分层（renderShortLibrary 等）摆的是**全量档案**——最近几天的流水整块端上来。
 *   这里摆的是**这一轮用得上的那几条**——按当前这句话现算，下一轮就换。
 *   一个是主食，一个是这一筷子夹的那菜。
 *
 * 三条纪律：
 *   1. **每条必须带指针**（`session/2026-11-04.md#12`）。指不回原话的不进——
 *      浮上来的东西要是编的，比不浮更坏。
 *   2. **每轮现算，不缓存**。缓存住的就成了「上一轮相关」，不是这一轮。
 *   3. **有上限**（条数 + 字数）。实时段是加菜，不许长成第二份主食。
 *
 * 抄的是 Cerebrum 的「命中就摆到眼前」，没抄它的「CA3 补全」——
 * 拿关联去填没记全的那块，填出来不是原话。
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { rank } from './bm25.mjs'
import { sectionsOf } from './trace.mjs'

export const DEFAULT_LIVE = {
  on: true,
  limit: 4, // 最多摆几条
  maxChars: 900, // 这一段总共多少字
  days: 3, // 只扫最近几天
  merge: true, // 相邻的几条并成一件事
  minLen: 12, // 太短的一节不当一条（标题空壳）
}

/** 把 session 目录里最近几天的文件切成「一节一条」。 */
export function collectDocs(root, { days = 3 } = {}) {
  const dir = join(root, 'persona-ai', 'knowledge', 'session')
  if (!existsSync(dir)) return []
  let files = []
  try {
    files = readdirSync(dir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
      .slice(-Math.max(1, Number(days) || 3))
  } catch {
    return []
  }
  const docs = []
  for (const f of files) {
    let text = ''
    try {
      text = readFileSync(join(dir, f), 'utf8')
    } catch {
      continue // 单篇读不到就跳过，不拿别的顶
    }
    for (const sec of sectionsOf(text)) {
      const body = String(sec.body || '').trim()
      if (body.length < 12) continue
      const pointer = `session/${f}#${sec.no}`
      docs.push({
        key: pointer,
        pointer,
        day: f.replace(/\.md$/, ''),
        no: sec.no,
        title: String(sec.title || '').trim(),
        text: `${sec.title || ''}\n${body}`,
        body,
      })
    }
  }
  return docs
}

/** 元数据行：`- tags: …` 这种。它不属于「话」，摆在实时段里只会把人带偏。 */
const META_LINE = /^[-*]\s*(tags|kind|source|updated|title|date|id|at|from|to)\s*:/i

/** 压成一行：说话人 + 前多少字。 */
function oneLine(body, max = 160) {
  const t = String(body || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#') && !s.startsWith('>') && !META_LINE.test(s))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (t.length <= max) return t
  return `${t.slice(0, max)}…`
}

/**
 * 算这一轮要摆什么。返回 [{ pointer, day, no, line }]，可能为空。
 * 空就是空——没撞上就不摆，不拿别的东西凑数。
 */
export function liveMemory(root, query, opts = {}) {
  const cfg = { ...DEFAULT_LIVE, ...(opts || {}) }
  if (!cfg.on) return []
  const q = String(query || '').trim()
  if (q.length < 2) return []
  const docs = collectDocs(root, cfg)
  if (!docs.length) return []

  let ranked
  try {
    ranked = rank(q, docs)
  } catch {
    return []
  }
  if (!ranked || !ranked.size) return []

  const hits = docs
    .filter((d) => ranked.has(d.key))
    .map((d) => ({ d, s: ranked.get(d.key) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, Math.max(1, Number(cfg.limit) || 4))
    .map(({ d }) => ({ pointer: d.pointer, day: d.day, no: d.no, line: oneLine(d.body) }))

  if (!cfg.merge || hits.length < 2) return hits

  // 事件聚合：同一天、序号挨着的并成一件事。挨着说明它是同一场对话里连着发生的。
  const out = []
  for (const h of hits) {
    const prev = out[out.length - 1]
    if (prev && prev.day === h.day && prev.noTo + 1 === h.no) {
      prev.noTo = h.no
      prev.pointer = `session/${h.day}.md#${prev.noFrom}-${h.no}`
      prev.line = `${prev.line} ／ ${h.line}`
    } else {
      out.push({ ...h, noFrom: h.no, noTo: h.no })
    }
  }
  return out
}

/** 摆成一段。空数组返回空串——不产出「暂无」这种占位。 */
export function renderLive(hits, { maxChars = 900 } = {}) {
  if (!Array.isArray(hits) || !hits.length) return ''
  const lines = ['## 实时记忆（按这一句浮上来的）', '']
  let used = 0
  for (const h of hits) {
    const at = String(h.day || '').slice(5) // MM-DD
    const row = `- \`${h.pointer}\`（${at}）${h.line}`
    if (used + row.length > maxChars) break
    lines.push(row)
    used += row.length
  }
  if (lines.length <= 2) return ''
  lines.push('', '（这几条是拿刚那一句浮上来的；要原文用 `memory_source` 按指针翻。指不回去的不算。）')
  return lines.join('\n')
}
