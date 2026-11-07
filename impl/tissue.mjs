/**
 * 四层第二层 · 组织
 *
 * 元胞一条一条分完，会剩一堆看着不一样的条目。
 * **组织层的活：看出一件事被说了几遍。**
 *
 * 不并回去，功能层就办三遍。
 *
 * ── 判据只认一条 ──
 *
 * **`what` 完全相同，就算一件。**
 *
 * 不按前缀（「写完」和「写完它」不是一个意思）、
 * 不按相似（那要语感，一有语感就飘）、
 * 不按意思（意思是人判的，不是程序判的）。
 *
 * **并了也不删。** 一个组里每条原文都留着，只是归到同一个组里。
 */

/** 怎么算同一件 */
export const BY = {
  SAME_WHAT: '同一个说法',   // 最稳的一档
  SAME_ITEM: '同一个条目',   // 台账里同一条被算了两次
}

/**
 * 归组。
 *
 * 输入：元胞交上来的 `kept`（每条带 `_cell`）
 * 输出：`{ groups, solo }`
 *
 *   groups: [{ key, why, items: [原文...] }]  —— 两条以上的
 *   solo:   [原文...]                          —— 只有一条的（也是活，不用合并）
 *
 * **不许把「差不多」的并进来。** 宁可多分几组，不可错并一处——
 * 错并的代价是「办错一件」，多分的代价只是「多办一次」。
 */
export function organize(items = []) {
  const data = Array.isArray(items) ? items : []
  const byWhat = new Map()
  const byItem = new Map()

  for (const it of data) {
    const raw = it._raw || it
    // **按 what 归**：有 what 的进 what 组；没有的，按 item（台账那条）归
    const w = typeof raw.what === 'string' ? raw.what.trim() : ''
    if (w) {
      if (!byWhat.has(w)) byWhat.set(w, [])
      byWhat.get(w).push(it)
      continue
    }
    const itemKey = typeof raw.item === 'string' ? raw.item.trim() : ''
    if (itemKey) {
      if (!byItem.has(itemKey)) byItem.set(itemKey, [])
      byItem.get(itemKey).push(it)
      continue
    }
    // 既没 what 也没 item：单条，不归组
    if (!byItem.has('__solo__')) byItem.set('__solo__', [])
    byItem.get('__solo__').push(it)
  }

  const groups = []
  const solo = []

  const push = (map, why) => {
    for (const [key, list] of map) {
      if (key === '__solo__') { solo.push(...list); continue }
      if (list.length >= 2) groups.push({ key, why, items: list })
      else solo.push(...list)
    }
  }
  push(byWhat, BY.SAME_WHAT)
  push(byItem, BY.SAME_ITEM)

  return { groups, solo }
}

/**
 * 一句话说清这一轮组成了几件。
 * **不给人格看** —— 这是给自反用的。
 */
export function summarize(result) {
  const g = result?.groups?.length || 0
  const s = result?.solo?.length || 0
  if (!g && !s) return '没有可归的'
  return `组成 ${g} 件${g ? `（其中 ${result.groups.reduce((n, x) => n + x.items.length, 0)} 条是重复说的）` : ''}${s ? `，另 ${s} 条单件` : ''}`
}

/**
 * 这一轮哪些真是同一件，说得出「凭什么」。
 *
 * **只用 `why` 里写死的那两档** —— 不许现编第三档。
 */
export function whyGrouped(group) {
  if (group?.why === BY.SAME_WHAT) return '同一个说法'
  if (group?.why === BY.SAME_ITEM) return '同一个条目'
  return '说不清'
}
