/**
 * 遗忘 · 不是删，是降权
 *
 * 「删掉一条不是忘，是抹。」——抹了就回不来；
 * 忘是**它还在那儿，只是不再主动取。**
 *
 * 所以这里一个字都不删。它只干一件事：**把某条的权重压下去。**
 *
 * 落盘：`.persona-framework/忘.json`
 *   { list: [{ path, why, at, weight }] }
 *
 * 谁读它：`01 捞记忆`。降过权的排到最后，不主动浮上来。
 * 想拿的时候拿得到——**但知道它是被降过权的**，不是它自己走回来的。
 *
 * 三条边界：
 *   一、不删文件。删是抹，不归它管。
 *   二、不写记忆内容。它只记「这条降过权」和为什么。
 *   三、**不碰人格文件**。人格那条线由人自己走（自我反写），功能不替它下决定。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

export function forgetFile(ws) {
  return join(String(ws || process.cwd()), '.persona-framework', '忘.json')
}

export function openForget(ws) {
  const f = forgetFile(ws)
  let v = {}
  try { v = JSON.parse(readFileSync(f, 'utf8')) } catch { /* 没忘过就是空的 */ }
  return {
    _f: f,
    _dirty: false,
    list: Array.isArray(v.list) ? v.list.slice(-500) : [],
  }
}

export function saveForget(book) {
  if (!book?._dirty) return 0
  const d = dirname(book._f)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  writeFileSync(book._f, JSON.stringify({ list: book.list.slice(-500) }, null, 2), 'utf8')
  book._dirty = false
  return 1
}

/** 权重档：0 = 正常，1 = 淡了，2 = 快想不起来，3 = 只剩痕迹 */
export const WEIGHTS = [0, 1, 2, 3]

/**
 * 忘一条。
 *
 * **weight 只加不减**——越忘越淡；要它重新亮起来，得再被提到（那归 recall 管，不归这里）。
 * 同一条忘两次，weight 涨一格，不是记两条。
 */
export function forgetOne(book, path, why, step = 1) {
  const p = String(path || '').trim()
  if (!p) return { ok: false, cant: ['得说清忘哪一条'] }
  const hit = book.list.find((x) => x.path === p)
  if (hit) {
    hit.weight = Math.min(3, (hit.weight || 0) + Math.max(1, step))
    hit.at = new Date().toISOString()
    if (why) hit.why = String(why).slice(0, 200)
  } else {
    book.list.push({
      path: p,
      why: String(why || '').slice(0, 200),
      weight: Math.min(3, Math.max(1, step)),
      at: new Date().toISOString(),
    })
  }
  book._dirty = true
  return { ok: true, weight: book.list.find((x) => x.path === p).weight }
}

/** 这条被忘到几档了。没忘过 = 0。 */
export function weightOf(book, path) {
  const hit = (book?.list || []).find((x) => x.path === path)
  return hit ? hit.weight || 0 : 0
}

/**
 * 给 `01 捞记忆` 用：把浮上来的几段按「忘的程度」重排。
 * **越淡的排越后**——不是删掉，是不让它挤在前面。
 */
export function orderByForget(book, items = []) {
  return [...items]
    .map((x, i) => ({ x, i, w: weightOf(book, x.path || x.file || x.where || '') }))
    .sort((a, b) => (a.w - b.w) || (a.i - b.i))
    .map((o) => o.x)
}

/**
 * 一轮走完。**它不主动忘**——忘要有由头（太旧、被推翻、没出处）。
 * 这一层只负责：把显式说了「忘掉这条」的记下来。
 *
 * 一个字都不往外交。
 */
export function forgetStep(ws, opts = {}) {
  const book = openForget(ws)
  const wants = Array.isArray(opts.forget) ? opts.forget : []
  let recorded = 0
  for (const w of wants) {
    const r = forgetOne(book, w?.path || w?.what, w?.why, w?.step || 1)
    if (r.ok) recorded++
  }
  const wrote = saveForget(book)
  return {
    did: [],
    out: [],
    cant: [
      // 它自己不做的事，说清楚
      '「该忘哪条」不替它挑：忘要有由头（太旧、被推翻、没出处），由由头那一层说',
    ],
    recorded,
    total: book.list.length,
    wrote,
  }
}
