/**
 * ground.mjs —— 人格同一的「来处」那一半（纯函数 + 只读文件）
 * ============================================================================
 * 病不是「复读对方的话」，那是症状。病是：**任何一句顺出来的话，默认就算我的判断**，
 * 不问它从哪儿来。于是内置语料只要够顺，就能顶着我的名字说话。
 *
 * 所以这里不问「像不像复读」，只问一件事：**这一句有来处吗。**
 * 来处只有三种，缺一样都算「没有来处」：
 *
 *   人格 —— 写死的判据（怎么判、什么不做），不是临场感觉；
 *   记忆 —— 账上的某一条，带得回指针；
 *   现实 —— 这一轮真的读过、真的调过工具（没动过现实就说自己判断了，那是猜）。
 *
 * 三者都没有，那句话就是顺出来的。这里让它**不能悄悄冒充**我的判断：
 * 每步算一遍，没来处就明写「这一句没有来处」。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, extname } from 'node:path'

const HAN = /[\u4e00-\u9fa5]/
const STOP = new Set([
  '这个', '那个', '什么', '怎么', '不是', '就是', '一个', '我们', '你们',
  '他们', '可以', '没有', '现在', '因为', '所以', '但是', '如果', '然后',
  '这样', '那样', '自己', '东西', '问题', '已经', '还是', '应该', '需要',
  '时候', '一样', '为什', '么样',
])

/** 指针形状：账上的落点长这样，出现在句子里就算「引了来处」。 */
export const POINTER = /(persona-ai\/|\.persona-framework\/|session\/\d{4}-\d{2}-\d{2}|knowledge\/[\w\u4e00-\u9fa5-]+|#\d{1,4}\b)/

export function keywords(text) {
  const out = []
  const s = String(text || '')
  const parts = s.match(/[\u4e00-\u9fa5]+|[a-z0-9_]+/gi) || []
  for (const p of parts) {
    if (HAN.test(p)) {
      if (p.length >= 2 && p.length <= 12 && !STOP.has(p)) out.push(p)
      if (p.length > 12) for (let i = 0; i + 4 <= p.length; i += 2) out.push(p.slice(i, i + 4))
    } else if (p.length >= 3) out.push(p.toLowerCase())
  }
  return [...new Set(out)]
}

export function listMd(root) {
  const out = []
  const walk = (dir, depth) => {
    if (depth > 3 || out.length > 400) return
    let ents = []
    try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === '_archive' || e.name === 'node_modules' || e.name.startsWith('.')) continue
        walk(p, depth + 1)
      } else if (extname(e.name).toLowerCase() === '.md') {
        out.push(p)
      }
    }
  }
  walk(root, 0)
  return out
}

/** 按词找：给一句话，回最多 limit 条带指针的落点（记忆来处）。 */
export function searchKnowledge(root, query, opts = {}) {
  const limit = Number(opts.limit ?? 3)
  const kws = keywords(query)
  if (!kws.length) return { query: String(query || ''), kws: [], hits: [] }
  const files = listMd(join(root, 'persona-ai', 'knowledge'))
  const hits = []
  for (const f of files) {
    let txt = ''
    try {
      if (statSync(f).size > 400_000) continue
      txt = readFileSync(f, 'utf8')
    } catch { continue }
    const low = txt.toLowerCase()
    let n = 0
    for (const k of kws) if (low.includes(k.toLowerCase())) n++
    if (!n) continue
    const at = low.indexOf(kws[0].toLowerCase())
    const excerpt = txt.slice(Math.max(0, at - 40), Math.max(0, at - 40) + 120).replace(/\s+/g, ' ').trim()
    hits.push({
      file: relative(root, f).replace(/\\/g, '/'),
      matched: n,
      score: Number((n / Math.sqrt(kws.length * Math.max(1, txt.length / 4000))).toFixed(3)),
      excerpt,
    })
  }
  hits.sort((a, b) => b.matched - a.matched || b.score - a.score)
  return { query: String(query || ''), kws, hits: hits.slice(0, limit) }
}

/** 这一轮真的动过现实吗：数工具调用/工具结果。 */
export function touchedReality(messages) {
  let n = 0
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m) continue
    if (m.role === 'tool' || m.role === 'tool_result') { n++; continue }
    const c = m.content
    if (Array.isArray(c)) {
      for (const b of c) {
        if (!b) continue
        if (b.type === 'tool_use' || b.type === 'tool_result') n++
      }
    }
    if (Array.isArray(m.tool_calls) && m.tool_calls.length) n += m.tool_calls.length
  }
  return n
}

/** 从 payload.messages 里取最后一条用户话、最后一条我说的话。 */
export function lastPair(messages) {
  let user = ''
  let assistant = ''
  const textOf = (m) => {
    const c = m?.content
    if (typeof c === 'string') return c
    if (Array.isArray(c)) {
      return c.filter((b) => b && b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text).join('\n')
    }
    return ''
  }
  for (const m of Array.isArray(messages) ? messages : []) {
    const role = m?.role
    if (role !== 'user' && role !== 'assistant') continue
    const t = textOf(m)
    if (!t) continue
    if (role === 'user') user = t
    else assistant = t
  }
  return { user, assistant }
}

/**
 * 来处判定：三种来处，各带了什么。
 * 判据只有一句——**这一句是我从哪儿拿的**；一样都没有，就是顺出来的。
 */
export function provenance({ groundHits = 0, touched = 0, cited = false }) {
  const from = []
  if (groundHits > 0) from.push(`记忆（账上 ${groundHits} 条落点）`)
  if (touched > 0) from.push(`现实（这一轮动过 ${touched} 次）`)
  if (cited) from.push('引了指针')
  return { from, has: from.length > 0 }
}

/** 给我看的那一行：有来处就报来处，没来处就直说没有。 */
export function renderOrigin({ groundHits = 0, touched = 0, cited = false }, hits = []) {
  const p = provenance({ groundHits, touched, cited })
  if (!p.has) {
    return [
      '**这一句没有来处。** 没读账、没动过现实、句子里也没有一个指针。',
      '那它就是顺出来的——顺出来的话不是我的判断。要么现在去查，要么明说「这是我猜的」。',
    ].join('\n')
  }
  const lines = [`来处：${p.from.join(' / ')}。`]
  for (const h of hits) lines.push(`- ${h.file}（撞 ${h.matched} 个词）：${String(h.excerpt || '').slice(0, 50)}`)
  if (p.from.length === 1 && groundHits === 0 && !cited) {
    lines.push('动过现实但没引指针：把「动了什么、回来什么」说出来，别只说结论。')
  }
  return lines.join('\n')
}

/** 一句话说清「账上找到没有」——不替我判断该说什么。 */
export function renderGround(res) {
  const q = String(res?.query || '').trim()
  const hits = res?.hits || []
  if (!q) return ''
  if (!hits.length) return `账上：这一句（「${q.slice(0, 24)}」）一条都没找到。没有落点就别说「我记得」。`
  const lines = [`账上：找到 ${hits.length} 条。`]
  for (const h of hits) lines.push(`- ${h.file}（撞 ${h.matched} 个词）：${String(h.excerpt || '').slice(0, 60)}`)
  return lines.join('\n')
}
