/**
 * 边：记忆条目之间的关系。
 *
 * 灵感来自灵枢的认知图（`md_cg/links.py` 676 行）——它把记忆做成有边的图。
 * 我这边不搬那套图数据库，只留最要紧的一件事：**知道两条记忆为什么有关**。
 *
 * 为什么需要：现在翻记忆只知道「这条在哪」，不知道「这条和那条是什么关系」。
 * 于是同一个判断会以三种说法躺在三处，谁也不认谁；改口了旧的还在，
 * 看起来像两个我都说过。
 *
 * 边类型只有五种，多一种都不要：
 *   cites      引用：这条引用了那条的原话
 *   refutes    反驳：这条推翻了那条
 *   refines    细化：这条是那条的更细版本
 *   same       同一件事：两处记的是同一笔（这就是「认账」要查的）
 *   supersedes 替代：这条取代了那条（旧的不删，但不再引用）
 */
import { appendJsonl, readJsonl, nowIso } from './ledger.mjs'

export const EDGE_TYPES = ['cites', 'refutes', 'refines', 'same', 'supersedes']

const FILE = 'edges.jsonl'

/** 加一条边。from / to 都用记忆指针（`chat/2026-11-03.md#2`）或文件路径。 */
export function link(root, { from, to, type, why = '' } = {}) {
  if (!from || !to) throw new Error('边要有两头：from 和 to')
  if (!EDGE_TYPES.includes(type)) throw new Error(`边类型只能是 ${EDGE_TYPES.join(' / ')}`)
  const row = { at: nowIso(), from: String(from), to: String(to), type, why: String(why).slice(0, 300) }
  appendJsonl(root, FILE, row)
  return row
}

/** 查某一条的边（两头都算）。 */
export function edgesOf(root, node) {
  const n = String(node ?? '')
  return readJsonl(root, FILE).filter((e) => e.from === n || e.to === n)
}

/** 全表。 */
export function allEdges(root) {
  return readJsonl(root, FILE)
}

/**
 * 「同一件事」两边记的是不是同一笔——这是认账的机器判据。
 * 给出一个节点，列出所有标了 same 的对家。
 */
export function counterparts(root, node) {
  return edgesOf(root, node)
    .filter((e) => e.type === 'same')
    .map((e) => (e.from === String(node) ? e.to : e.from))
}

export function renderEdges(root, node) {
  const list = node ? edgesOf(root, node) : allEdges(root)
  if (!list.length) return node ? `「${node}」没有连边。` : '（还没有边）'
  const lines = [node ? `「${node}」的边：${list.length} 条` : `全部边：${list.length} 条`, '']
  for (const e of list.slice(-40)) {
    lines.push(`- ${e.from} --${e.type}--> ${e.to}${e.why ? `（${e.why}）` : ''}`)
  }
  return lines.join('\n')
}

/**
 * 沿边往外走：给一条记忆，走到它连着的、再连着的那几条。
 *
 * 抄 dsh-prime-memory 的两步检索里的第二步（`expand_graph_node`）：
 * 它有「从节点扩到邻居」这个动作，我原来只存边、不会走路。
 *
 * 广度优先，一层一层走；同一个节点只出现一次（走回头路没意义）。
 * 不排序、不打分——只把走到的摆出来，值不值得看是人判断。
 */
export function walk(root, node, { depth = 2, max = 30 } = {}) {
  const start = String(node ?? '')
  if (!start) return []
  const seen = new Set([start])
  const out = []
  let frontier = [start]

  for (let d = 1; d <= depth; d += 1) {
    const next = []
    for (const n of frontier) {
      for (const e of edgesOf(root, n)) {
        const other = e.from === n ? e.to : e.from
        if (seen.has(other)) continue
        seen.add(other)
        out.push({ node: other, via: e.type, from: n, depth: d, why: e.why })
        next.push(other)
        if (out.length >= max) return out
      }
    }
    frontier = next
    if (!frontier.length) break
  }
  return out
}

export function renderWalk(root, node, opts = {}) {
  const hits = walk(root, node, opts)
  if (!hits.length) return `「${node}」没有连着的东西，走不出去。`
  const d = opts.depth ?? 2
  const lines = [`从「${node}」走 ${d} 层，走到 ${hits.length} 条：`, '']
  for (const h of hits) {
    lines.push(`${'  '.repeat(Math.max(0, h.depth - 1))}- [${h.via}] ${h.node}${h.why ? `（${h.why}）` : ''}`)
  }
  return lines.join('\n')
}
