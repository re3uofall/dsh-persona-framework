/**
 * 记忆段的合并：去重 + 总预算。
 *
 * 为什么只能在钩子里做：六个 section 各管各的，互相看不见对方注了什么。
 * 于是同一条判断可能同时躺在短期和长期里被注两遍；六段加起来多少字也没人算过。
 *
 * 只认本插件注的段（`persona-memory*`），别人的一个字都不动。
 * 只删不重排——位置是宿主和 order 定的，这里没资格动别人的顺序。
 */

const PREFIX = 'persona-memory'

/** 超预算时的删除顺序：最不值钱的先走。`persona-memory:now`（即时）不在表里，永不删。 */
const ORDER = [
  'persona-memory', // hint：工具用法提示
  'persona-memory:ledger', // 记账规矩
  'persona-memory:consistency', // 一致性提醒
  'persona-memory:other', // 其他记忆
  'persona-memory:short', // 短期
  'persona-memory:long-term', // 长期
]

/**
 * 算出该删掉哪几段（返回数组元素本身，调用方按引用从 contexts 里 splice）。
 * @param {{name?:string,text?:string}[]} contexts
 * @param {number} budget 总预算（字）
 */
export function mergeMemoryContexts(contexts, budget = 24000) {
  if (!Array.isArray(contexts)) return []
  const mine = contexts.filter((c) => String(c?.name || '').startsWith(PREFIX))
  if (mine.length <= 1) return []

  const drop = []

  // 1) 去重：内容指纹（去空白）一样的，后来的那份删掉
  const seen = new Set()
  for (const c of mine) {
    const fp = String(c?.text || '').replace(/\s+/g, '').slice(0, 4000)
    if (!fp) continue
    if (seen.has(fp)) drop.push(c)
    else seen.add(fp)
  }

  // 2) 总预算
  const limit = Math.max(2000, Number(budget) || 24000)
  let total = mine.reduce((s, c) => (drop.includes(c) ? s : s + String(c?.text || '').length), 0)
  for (const name of ORDER) {
    if (total <= limit) break
    const c = mine.find((x) => String(x?.name || '') === name && !drop.includes(x))
    if (!c) continue
    drop.push(c)
    total -= String(c?.text || '').length
  }

  return drop
}
