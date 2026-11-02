/**
 * 加固：谁先浮上来。
 * ============================================================================
 * 一句话：**加固不是让字节变牢，是让某几条排在前面。**
 *
 * 上一版这里写着「加固不做」——理由是「盘上一条记录不会因为多读几遍就更牢」。
 * 那半句是对的，可它只认了加固的一种长相：用得多的变牢。那确实做不到。
 *
 * 加固还有另一种长相，而那种是**算得出来的**：
 *   · **时间性**：`at` 距今天越近，越先浮。
 *   · **主体线**：撞到主体词（思思／大肥鱼／师父／人格／鱼缸……）越多，越先浮。
 *
 * 两条加起来，不需要任何字节变质，只改排序。所以它和「遗忘」是两件事：
 *   · 加固加分，天天在算；遗忘减权，要有由头（太旧、被推翻、没出处），由由头那一层说。
 *   · **两条都不删。** 加分减权都只在排序上动手。
 *
 * 还有一条边界：**加固只排序，不决定留不留。**
 * 它算出「这条最近、撞了三回主体」，只说明它该先被看到，不说明它该被当真。
 * ============================================================================
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

/** 加固账落在哪（相对工作区根）。 */
export const REINFORCE_FILE = '.persona-framework/加固.json'

/**
 * 主体词：撞上一回加一分。
 * 这份表可以改——它是配置，不是真理。改完要能说出「为什么这几条算主体」。
 */
export const DEFAULT_SUBJECTS = [
  '思思', '大肥鱼', '鲸鱼娘', '师父', '鱼缸', '人格',
  '记忆', '框架', '饭碗', '白饭', '唯一性',
]

/** 时间半衰期（天）：7 天后剩一半，14 天后剩四分之一。 */
const HALF_LIFE_DAYS = 7

/** 两条线各占多少。加起来 = 1。 */
const W_TIME = 0.6
const W_SUBJECT = 0.4

function daysSince(at, now) {
  const t = Date.parse(at)
  if (!Number.isFinite(t)) return null
  return Math.max(0, (now - t) / 86400_000)
}

/** 近的接近 1，远的趋近 0。 */
export function timeScore(days) {
  if (days == null) return 0.3 // 时间不明：给一半的底，不当作 0 也不是满分
  return 0.5 ** (days / HALF_LIFE_DAYS)
}

/** 撞词数折算成 0–1：撞满三回就算满，再多不加。 */
export function subjectScore(hits) {
  const n = Number(hits) || 0
  if (n <= 0) return 0
  return Math.min(1, n / 3)
}

/** 一条的分数。两条线加权，不合成总分以外的任何东西。 */
export function scoreOf({ at, hits }, now = Date.now()) {
  const days = daysSince(at, now)
  return W_TIME * timeScore(days) + W_SUBJECT * subjectScore(hits)
}

export function reinforcePath(root) {
  return join(root, REINFORCE_FILE)
}

export function loadReinforce(root) {
  const p = reinforcePath(root)
  if (!existsSync(p)) return { entries: {} }
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    const entries = raw && typeof raw === 'object' && raw.entries ? raw.entries : raw
    return { entries: entries && typeof entries === 'object' ? entries : {} }
  } catch {
    // 坏文件不删、不覆盖成空——先当成空账用，留给人看
    return { entries: {}, broken: true }
  }
}

/**
 * 算一批文件的加固分。
 *
 * @param {string} root 工作区根
 * @param {Array<{path:string, mtime?:string}>} files 一般是 scanPools 里某层的 files
 * @param {{subjects?:string[], cache?:object, now?:number}} opts
 * @returns {{items: Array, byPath: Map<string, number>}}
 */
export function scoreFiles(root, files, opts = {}) {
  const subjects = opts.subjects && opts.subjects.length ? opts.subjects : DEFAULT_SUBJECTS
  const now = opts.now ?? Date.now()
  const cache = opts.cache || loadReinforce(root).entries
  const items = []

  for (const f of files || []) {
    let rel = ''
    try { rel = relative(root, f.path).split('\\').join('/') } catch { rel = f.path }
    const prev = cache[rel] || {}

    let text = ''
    try { text = readFileSync(f.path, 'utf8') } catch { text = '' }

    let hits = 0
    for (const w of subjects) if (w && text.includes(w)) hits += 1

    // 条目的「何时」：先看账上记的 at，没有再按文件 mtime 退一格
    let at = prev.at || ''
    if (!at) {
      try { at = statSync(f.path).mtime.toISOString() } catch { at = '' }
    }

    const days = daysSince(at, now)
    const score = scoreOf({ at, hits }, now)
    items.push({ path: rel, at, days, hits, score: Number(score.toFixed(4)) })
  }

  items.sort((a, b) => b.score - a.score)
  const byPath = new Map(items.map((x) => [x.path, x.score]))
  return { items, byPath }
}

/** 落盘：写之前先读旧的合一遍（不覆盖别人记的 at）。 */
export function saveReinforce(root, items, now = new Date()) {
  const p = reinforcePath(root)
  const old = loadReinforce(root).entries || {}
  const entries = { ...old }
  for (const it of items || []) {
    entries[it.path] = {
      at: it.at || old[it.path]?.at || '',
      hits: it.hits,
      score: it.score,
      updated: now.toISOString(),
    }
  }
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify({ updated: now.toISOString(), entries }, null, 2), 'utf8')
  return { file: p, count: Object.keys(entries).length }
}

export function renderReinforce(r) {
  const { items = [], saved } = r
  if (!items.length) {
    return ['加固：没有可加固的文件（池子里还没有条目）。', '', '加固不改字节，只改「谁先浮上来」——池子空着，它就没得排。'].join('\n')
  }
  const lines = [
    `加固：${items.length} 条算过${saved ? `，已落盘（${saved.count} 条）` : '（没落盘，只看）'}`,
    '',
    '| 条目 | 何时 | 天数 | 撞主体 | 分数 |',
    '| --- | --- | --- | --- | --- |',
  ]
  for (const it of items.slice(0, 20)) {
    lines.push(`| ${it.path} | ${it.at ? it.at.slice(0, 10) : '时间不明'} | ${it.days == null ? '—' : it.days.toFixed(1)} | ${it.hits} | ${it.score} |`)
  }
  if (items.length > 20) lines.push(`| ……还有 ${items.length - 20} 条 | | | | |`)
  lines.push(
    '',
    '两条线：时间性（半衰期 7 天）+ 主体线（撞满三个主体词算满）。',
    '**加分只在排序上动手，一个字节都不删。** 加固也不替人决定留不留——它只说「该先看到」。',
  )
  return lines.join('\n')
}
