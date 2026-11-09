/**
 * 骨架化提炼：不是「一行一条」，而是「四类节点 + 图 + 按字节买」。
 *
 * 抄的是 `dsh-soul` 2.1.0（icyaaaww/dsh-soul，MIT）`src/skeleton.js` 的实现方式：
 *   1) extract   把每一节拆成 constraint / decision / artifact / progress 四类节点
 *   2) buildGraph 同节相连、后一条 progress 取代前一条、decision 由同节 constraint 派生
 *   3) ppr       从「钉住的节点」出发做 Personalized PageRank，算出谁重要
 *   4) select    按「边际收益 /（字节 + 32）」贪心买，预算买完就停
 *
 * 为什么不用「一行一条」：一行一条只按时间排，预算一紧张就只剩最近的流水；
 * 而一段对话里真正不能丢的是**约束**（说了不要什么）和**决策**（为什么这么改），
 * 它们可能出现在这一段的最开始。按价值买，才买得到它们。
 *
 * 与 dsh-soul 的差别（故意留的）：
 *   · 我们没有 event 流，输入是导出的 Markdown 流水（`## 标题` + `师父：` / `她：`）。
 *   · 每一行都带 `源：文件#序号`——没有指针的摘要不许进判断层。
 *   · 只提炼，不写任何判断；写不写由 condenseJournal 决定。
 */

export const NODE_KINDS = Object.freeze(['constraint', 'decision', 'artifact', 'progress'])
export const KIND_LABEL = Object.freeze({ constraint: '约束', decision: '决策', artifact: '产物', progress: '进度' })

/** 钉住的种类：这几类预算再紧也要先买。 */
const PIN_KINDS = new Set(['constraint'])

const CONSTRAINT = /(?:不要|不能|别|禁止|必须|只能|只准|不许|务必|记得|一律|不允许)/
const DECISION = /(?:因为|所以|因此|决定|改成|改用|换成|走.{0,12}而不是|instead of|because)/
const NEGATIVE = /(?:别|不是|不许|不要|禁止|算了|不行)/

/** 这些不是师父说的话，是宿主每轮塞进来的环境块——按约束提炼会把整段注入抬进判断层。 */
const INJECTED = /(?:You are an AI agent powered by DeepSeek Harness|优先级（强制触发器|［身份］|实时环境|账已记：)/
export function looksInjected(text) {
  const t = String(text || '')
  return t.length > 600 || INJECTED.test(t)
}

const PATH = /(?:[A-Za-z]:[\\/][^\s，。；）】"']+|\/[\w.-]+(?:\/[\w.-]+)+|addons\/[\w./-]+)/
const FLAG = /--[a-z][\w-]+/g

/** 只认「看起来像一条可拨的来源」的词，用来算 IDF。 */
export function identifierTerms(text) {
  const out = []
  const s = String(text || '')
  for (const m of s.matchAll(new RegExp(PATH.source, 'g'))) out.push(m[0])
  for (const m of s.matchAll(FLAG)) out.push(m[0])
  return out
}

function clip(s, max) {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const head = t.slice(0, max)
  const cut = Math.max(head.lastIndexOf('。'), head.lastIndexOf('；'), head.lastIndexOf('，'), head.lastIndexOf('？'), head.lastIndexOf('！'))
  return (cut > max * 0.4 ? head.slice(0, cut) : head) + '…'
}

/** 把一份流水切成小节，每节带 `head`、`lines`（已分是谁说的）与 `seq`。 */
export function parseSections(text) {
  const out = []
  let cur = null
  const lines = String(text || '').split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i].trimEnd()
    const h = raw.match(/^##\s+(.+)$/)
    if (h) {
      if (cur) out.push(cur)
      cur = { seq: out.length + 1, lineNo: i + 1, head: h[1].trim(), turns: [] }
      continue
    }
    if (!cur) continue
    const m = raw.match(/^(师父|user|使用者|她|assistant)[：:]\s*(.+)$/)
    if (m) {
      cur.turns.push({ role: /^(师父|user|使用者)/.test(m[1]) ? 'user' : 'assistant', text: m[2] })
      continue
    }
    const m2 = raw.match(/^[-*]\s*(师父|使用者|她)[：:]\s*(.+)$/)
    if (m2) cur.turns.push({ role: /^(师父|使用者)/.test(m2[1]) ? 'user' : 'assistant', text: m2[2] })
  }
  if (cur) out.push(cur)
  return out.filter((s) => s.head || s.turns.length)
}

/**
 * 把小节拆成节点。`src` 是小节序号，渲染时拼成指针。
 *
 * 判据（照抄 dsh-soul 的意思）：
 *   用户说的、带「不要/必须/只能…」→ constraint（钉住，最贵）
 *   我说的话里带「因为/改成/所以」→ decision
 *   话里出现路径或 `--flag`        → artifact（「这个东西存在/被写过」）
 *   其余足够长的我的话            → progress
 */
export function extract(sections, { pointerOf } = {}) {
  const nodes = []
  for (const s of sections) {
    const ptr = pointerOf ? pointerOf(s) : `#${s.seq}`
    let lastProgress = null
    for (const t of s.turns) {
      const text = String(t.text || '').trim()
      if (!text || looksInjected(text)) continue
      const base = { src: ptr, seq: s.seq, kind: null, claim: '', pin: 0, salience: 0.5 }
      if (t.role === 'user' && CONSTRAINT.test(text)) {
        nodes.push({ ...base, kind: 'constraint', claim: clip(text, 70), pin: 1, salience: 1 })
        continue
      }
      if (t.role === 'assistant' && DECISION.test(text) && (NEGATIVE.test(text) || text.length >= 12)) {
        nodes.push({ ...base, kind: 'decision', claim: clip(text, 70), salience: 0.8 })
        continue
      }
      const ids = identifierTerms(text)
      if (ids.length) {
        nodes.push({ ...base, kind: 'artifact', claim: clip(`${ids[0]}${ids.length > 1 ? ` 等 ${ids.length} 处` : ''}`, 60), salience: 0.6 })
        continue
      }
      if (t.role === 'assistant' && text.length >= 12) {
        const n = { ...base, kind: 'progress', claim: clip(text, 60), salience: 0.4, supersedes: null }
        if (lastProgress) n.supersedes = lastProgress
        lastProgress = nodes.length
        nodes.push(n)
      }
    }
  }
  return nodes.map((n, i) => ({ ...n, id: i }))
}

/** 建图：同节相关、同节 decision 由 constraint 派生、后一条 progress 取代前一条。 */
export function buildGraph(nodes) {
  const adj = new Map()
  const add = (a, b, rel, w) => {
    if (a === b) return
    if (!adj.has(a)) adj.set(a, [])
    adj.get(a).push({ to: b, rel, w })
    if (!adj.has(b)) adj.set(b, [])
    adj.get(b).push({ to: a, rel: `${rel}-逆`, w: w * 0.5 })
  }
  const bySeq = new Map()
  for (const n of nodes) {
    if (!bySeq.has(n.seq)) bySeq.set(n.seq, [])
    bySeq.get(n.seq).push(n)
  }
  for (const list of bySeq.values()) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i]
        const b = list[j]
        if (a.kind === 'constraint' && b.kind === 'decision') add(a.id, b.id, 'derived', 1.6)
        else add(a.id, b.id, 'related', 0.6)
      }
    }
  }
  for (const n of nodes) {
    if (n.kind === 'progress' && typeof n.supersedes === 'number') add(n.id, n.supersedes, 'supersedes', 1.2)
  }
  return adj
}

/** Personalized PageRank：从种子出发，看到谁身上。 */
export function ppr(adj, seeds, { alpha = 0.5, iterations = 2 } = {}) {
  const all = [...adj.keys()]
  const rank = new Map(all.map((k) => [k, 0]))
  const prefer = new Map(all.map((k) => [k, 0]))
  let total = 0
  for (const s of seeds) {
    if (!rank.has(s)) continue
    prefer.set(s, (prefer.get(s) || 0) + 1)
    total += 1
  }
  if (!total) return rank
  for (const k of prefer.keys()) prefer.set(k, (prefer.get(k) || 0) / total)
  for (const k of all) rank.set(k, prefer.get(k) || 0)
  for (let it = 0; it < iterations; it += 1) {
    const next = new Map(all.map((k) => [k, alpha * (prefer.get(k) || 0)]))
    for (const [from, edges] of adj) {
      const r = rank.get(from) || 0
      if (!r || !edges.length) continue
      const sum = edges.reduce((a, e) => a + e.w, 0) || 1
      for (const e of edges) next.set(e.to, (next.get(e.to) || 0) + (1 - alpha) * r * (e.w / sum))
    }
    for (const [k, v] of next) rank.set(k, v)
  }
  return rank
}

/**
 * 按预算买节点：每个词的边际价值 = 图上分数 × idf × 种类权重；
 * 价格按「渲染后字节 + 32」算——那 32 是每行的固定开销，防止 20 字节的碎片靠便宜取胜。
 */
export function select(nodes, adj, { budget = 1200, seeds = [], priceCap } = {}) {
  const rank = ppr(adj, seeds.length ? seeds : nodes.filter((n) => n.kind === 'constraint').map((n) => n.id))
  const freq = new Map()
  for (const n of nodes) {
    for (const term of identifierTerms(`${n.claim} ${n.src}`)) {
      freq.set(term, (freq.get(term) || 0) + 1)
    }
  }
  const n = nodes.length || 1
  const weightOf = (node) => (node.kind === 'constraint' ? 3 : node.kind === 'decision' ? 2.2 : node.kind === 'artifact' ? 2 : 1)
  const value = new Map()
  for (const node of nodes) {
    let v = (rank.get(node.id) || 0) * weightOf(node) * (0.5 + node.salience)
    for (const term of new Set(identifierTerms(node.claim))) {
      v += Math.log2(1 + n / (1 + (freq.get(term) || 1)))
    }
    value.set(node.id, v)
  }
  const picks = []
  const taken = new Set()
  let left = budget
  const order = [...nodes].sort((a, b) => (b.pin ? 1 : 0) - (a.pin ? 1 : 0))
  for (const node of order) {
    if (!node.pin || taken.has(node.id)) continue
    const bytes = Buffer.byteLength(renderLine(node)) + 32
    if (bytes > left) continue
    picks.push(node)
    taken.add(node.id)
    left -= bytes
  }
  for (;;) {
    let best = null
    let bestScore = 0
    for (const node of nodes) {
      if (taken.has(node.id)) continue
      const bytes = priceCap ? Math.min(Buffer.byteLength(renderLine(node)), priceCap) : Buffer.byteLength(renderLine(node))
      const cost = bytes + 32
      if (cost > left) continue
      const score = (value.get(node.id) || 0) / cost
      if (score > bestScore) {
        bestScore = score
        best = node
      }
    }
    if (!best) break
    picks.push(best)
    taken.add(best.id)
    left -= Buffer.byteLength(renderLine(best)) + 32
  }
  return { picks, left, rank }
}

/** 一行的渲染：标签 + 话 + 指针。指针是硬的——没有它，这一行不许进判断层。 */
export function renderLine(node) {
  const label = KIND_LABEL[node.kind] || node.kind
  return `- ${label}: ${node.claim}（源：${node.src}）`
}

/** 从一份流水里压出骨架行。 */
export function condenseSkeleton(text, { budget = 1200, pointerOf, maxLines = 40 } = {}) {
  const sections = parseSections(text)
  if (!sections.length) return { lines: [], stats: { sections: 0, nodes: 0, picked: 0, bytes: 0 } }
  const nodes = extract(sections, { pointerOf })
  if (!nodes.length) return { lines: [], stats: { sections: sections.length, nodes: 0, picked: 0, bytes: 0 } }
  const adj = buildGraph(nodes)
  const seeds = nodes.filter((n) => n.pin).map((n) => n.id)
  const { picks } = select(nodes, adj, { budget, seeds })
  const ordered = picks.sort((a, b) => a.seq - b.seq).slice(0, maxLines)
  const lines = ordered.map(renderLine)
  return {
    lines,
    stats: {
      sections: sections.length,
      nodes: nodes.length,
      picked: ordered.length,
      bytes: lines.reduce((a, l) => a + Buffer.byteLength(l), 0),
    },
  }
}
