// 结构与拓扑：把一堆语言卡当成一张图，看它怎么连、怎么变、哪里会滑。
// 参考：拓扑学（连通、环、边界、不变量）、后结构主义（意义不在单个词里，
// 在它与别的词的差异与位置里；位置一移，意思就滑）。
//
// 判据：说得出「什么没变」，才允许说「什么变了」。

import { cardKey, CARD } from './lang.mjs'

export const TOPO = {
  dir: CARD.dir,
  file: CARD.topoFile,
}

function norm(edges) {
  return edges
    .map((e) => `${e.from}->${e.to}:${e.rel || ''}`)
    .sort()
}

// 并查集求连通分量
function components(nodes, edges) {
  const parent = new Map(nodes.map((n) => [n, n]))
  const find = (x) => {
    let p = parent.get(x)
    while (p !== undefined && p !== x) {
      x = p
      p = parent.get(x)
    }
    return x
  }
  for (const e of edges) {
    if (!parent.has(e.from) || !parent.has(e.to)) continue
    const a = find(e.from)
    const b = find(e.to)
    if (a !== b) parent.set(a, b)
  }
  const groups = new Map()
  for (const n of nodes) {
    const r = find(n)
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r).push(n)
  }
  return [...groups.values()]
}

// 邻接表
function adjacency(nodes, edges) {
  const adj = new Map(nodes.map((n) => [n, new Set()]))
  for (const e of edges) {
    if (!adj.has(e.from) || !adj.has(e.to)) continue
    adj.get(e.from).add(e.to)
    adj.get(e.to).add(e.from)
  }
  return adj
}

// 断裂点：拿掉它，连通分量变多。没有它，图就断成两半。
export function articulations(nodes, edges) {
  const base = components(nodes, edges).length
  const out = []
  for (const n of nodes) {
    const rest = nodes.filter((x) => x !== n)
    const es = edges.filter((e) => e.from !== n && e.to !== n)
    if (components(rest, es).length > base) out.push(n)
  }
  return out
}

export function invariants(res) {
  const nodes = res.cards.map((c) => c.id)
  const edges = res.edges || []
  const comps = components(nodes, edges)
  const leaves = nodes.filter((n) => {
    let deg = 0
    for (const e of edges) if (e.from === n || e.to === n) deg += 1
    return deg === 1
  })
  return {
    nodes: nodes.length,
    edges: edges.length,
    components: comps.length,
    cycles: edges.length - nodes.length + comps.length,
    leaves: leaves.length,
    articulation: articulations(nodes, edges),
    groups: comps.map((g) => g.length).sort((a, b) => b - a),
  }
}

// 两张卡集之间：加了什么、减了什么、谁的邻居换了、不变量破没破。
export function compareSets(prev, next) {
  const pk = new Map(prev.cards.map((c) => [c.id, cardKey(c)]))
  const nk = new Map(next.cards.map((c) => [c.id, cardKey(c)]))
  const prevKeys = new Set([...pk.values()])
  const nextKeys = new Set([...nk.values()])
  const added = [...nextKeys].filter((k) => !prevKeys.has(k))
  const removed = [...prevKeys].filter((k) => !nextKeys.has(k))
  // 滑动：同一张卡（同 key），前后连到的邻居不同
  const nei = (res) => {
    const m = new Map()
    for (const c of res.cards) m.set(c.id, [])
    for (const e of res.edges || []) {
      if (m.has(e.from)) m.get(e.from).push(e.to)
      if (m.has(e.to)) m.get(e.to).push(e.from)
    }
    for (const [k, v] of m) m.set(k, v.sort())
    return m
  }
  const pn = nei(prev)
  const nn = nei(next)
  const slips = []
  for (const [id, key] of nk) {
    if (!prevKeys.has(key)) continue
    const a = (pn.get(id) || []).filter((x) => nk.has(x) || pk.has(x))
    const b = nn.get(id) || []
    if (a.join(',') !== b.join(',')) slips.push({ card: key, from: a, to: b })
  }
  const ip = invariants(prev)
  const inn = invariants(next)
  const broke = []
  for (const k of ['components', 'cycles', 'leaves', 'articulation']) {
    const a = JSON.stringify(ip[k])
    const b = JSON.stringify(inn[k])
    if (a !== b) broke.push({ what: k, from: ip[k], to: inn[k] })
  }
  return {
    at: new Date().toISOString(),
    added,
    removed,
    slips,
    invariants: { before: ip, after: inn },
    broke,
  }
}

// 变化本身有多大：用边与卡片的差值算一个 0..1 的漂移度。
export function driftOf(cmp) {
  const total = cmp.added.length + cmp.removed.length + cmp.slips.length
  if (!total) return 0
  return Number(Math.min(1, total / (total + 8)).toFixed(3))
}

export function renderTopo(res, opts = {}) {
  const inv = invariants(res)
  const lines = []
  lines.push(`# 结构卡（${inv.nodes} 个点；${inv.edges} 条边；连通 ${inv.components} 段；环 ${inv.cycles}；悬挂 ${inv.leaves}）`)
  if (inv.articulation.length) lines.push(`- 断裂点：${inv.articulation.slice(0, 6).join('、')}（拿掉它，图就断）`)
  const limit = opts.limit || 12
  for (const e of (res.edges || []).slice(0, limit)) lines.push(`- ${e.from} —${e.rel || '连'}→ ${e.to}`)
  if ((res.edges || []).length > limit) lines.push(`…另有 ${res.edges.length - limit} 条边`)
  return lines.join('\n')
}

export function renderCompare(cmp, opts = {}) {
  const lines = []
  lines.push(`# 结构变化（加 ${cmp.added.length}｜减 ${cmp.removed.length}｜滑动 ${cmp.slips.length}｜漂移 ${driftOf(cmp)}）`)
  for (const b of cmp.broke) lines.push(`- 不变量破了：${b.what} ${JSON.stringify(b.from)} → ${JSON.stringify(b.to)}`)
  for (const s of cmp.slips.slice(0, opts.limit || 5)) lines.push(`- 滑了：${s.card} 〔${s.from.join(',') || '空'}〕→〔${s.to.join(',') || '空'}〕`)
  if (!cmp.broke.length && !cmp.slips.length) lines.push('- 不变量没破，也没有卡换过邻居')
  return lines.join('\n')
}
