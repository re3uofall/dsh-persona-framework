/**
 * 负面信息 · 把「对不上」记下来
 *
 * 它记不了「我变了」——那要靠感觉，我没有。
 * 它能记的只有一件：**这一条和之前那条对不上。**
 * 对照，不是感觉。
 *
 * 判据（框架 R21 违和感四类）：
 *   非同一 —— 两个不一样的东西被当成同一个
 *   不符合 —— 说法和现实对不上
 *   不融贯 —— 这次说的和上次矛盾
 *   越界   —— 用了不该用的东西
 *
 * **能自动判的只有「不融贯」**：同一个键、旧结论、新结论，两个不一样。
 * 其余三类要人判，**程序不替它编**——这一句必须写在代码里，不然就会瞎报。
 *
 * 落盘：`.persona-framework/对不上.json`
 * 不给字：不往外交任何说明。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

/** 四类，一字不改照抄 R21。 */
export const KINDS = ['非同一', '不符合', '不融贯', '越界']

export function negativeFile(ws) {
  return join(String(ws || process.cwd()), '.persona-framework', '对不上.json')
}

export function openNegative(ws) {
  const f = negativeFile(ws)
  let v = {}
  try { v = JSON.parse(readFileSync(f, 'utf8')) } catch { /* 没有就是空的 */ }
  const book = {
    _f: f,
    _dirty: false,
    // 一条一条的「对不上」：{ key, kind, before, after, at }
    list: Array.isArray(v.list) ? v.list.slice(-300) : [],
  }
  return book
}

export function saveNegative(book) {
  if (!book?._dirty) return 0
  const d = dirname(book._f)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  writeFileSync(book._f, JSON.stringify({ list: book.list.slice(-300) }, null, 2), 'utf8')
  book._dirty = false
  return 1
}

/** 读一本账（自我.json / 超我.json），拿里面记过的结论。读不到就当空。 */
function readBookAt(ws, name) {
  const f = join(String(ws || process.cwd()), '.persona-framework', name)
  try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return null }
}

/**
 * 拿这一轮的「判过」去对旧账。
 *
 * **只对同一个键**：旧账里判过「甲」，这一轮也说「甲」，结论不同 → 不融贯。
 * 键不一样就不是同一件事，不算对不上——**那是两条，不是打架。**
 */
export function checkJudged(book, ws, judged = []) {
  const old = readBookAt(ws, '自我.json')?.判过 || {}
  const found = []
  for (const j of judged) {
    const key = String(j?.key || j?.what || '').trim()
    if (!key) continue
    const before = old[key]
    if (!before) continue  // 旧的没判过，谈不上「对不上」
    const after = String(j.verdict || '').trim()
    if (!after) continue
    const beforeV = String(before.verdict || '').trim()
    if (beforeV && after && beforeV !== after) {
      found.push({ key, kind: '不融贯', before: beforeV, after, at: new Date().toISOString() })
    }
    // **判过之后旧的自己被新结论覆盖**——那不在这一本里做，归 ego 的账。
  }
  return found
}

/** 拿这一轮的「收过的标」去对旧账：同一条标，来源变了就是非同一。 */
export function checkGoals(book, ws, goals = []) {
  const old = readBookAt(ws, '超我.json')?.标的 || {}
  const found = []
  for (const g of goals) {
    const key = String(g?.what || '').trim()
    if (!key || !old[key]) continue
    const beforeS = String(old[key].source || '').trim()
    const afterS = String(g.source || '').trim()
    if (beforeS && afterS && beforeS !== afterS) {
      found.push({ key, kind: '非同一', before: `${beforeS} 的`, after: `${afterS} 的`, at: new Date().toISOString() })
    }
  }
  return found
}

/** 记一条。**重复的不重复记**——同一个键、同一类、同样的新旧，只留第一次。 */
export function recordNegative(book, item) {
  if (!item?.key || !item?.kind) return false
  const same = book.list.some((x) =>
    x.key === item.key && x.kind === item.kind && x.before === item.before && x.after === item.after)
  if (same) return false
  book.list.push({
    key: String(item.key).slice(0, 160),
    kind: item.kind,
    before: String(item.before || '').slice(0, 200),
    after: String(item.after || '').slice(0, 200),
    at: item.at || new Date().toISOString(),
  })
  book.list = book.list.slice(-300)
  book._dirty = true
  return true
}

/**
 * 一轮走完：
 *   一、拿这一轮判过的，去对旧账（只判「不融贯」）
 *   二、拿这一轮收过的标，去对旧账（只判「非同一」）
 *   三、记下来，存盘
 *
 * **一个字都不往外交。**
 */
export function negativeStep(ws, opts = {}) {
  const book = openNegative(ws)
  const judged = Array.isArray(opts.judged) ? opts.judged : []
  const goals = Array.isArray(opts.goals) ? opts.goals : []

  const found = [...checkJudged(book, ws, judged), ...checkGoals(book, ws, goals)]
  let added = 0
  for (const f of found) if (recordNegative(book, f)) added++

  const wrote = saveNegative(book)
  return {
    // 全空：干完不吭声
    did: [],
    out: [],
    cant: [],
    // 只给程序看
    found: found.length,
    recorded: added,
    total: book.list.length,
    wrote,
    // 剩下三类一律不自动判
    cantByHand: ['非同一（除来源变了）', '不符合', '越界'],
  }
}
