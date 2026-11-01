/**
 * 一本账：所有"运行时的状态"只放一个文件。
 *
 * 上一版把状态摊成八个文件——阈值.md、撞车.md、称重.md、卡住.md、待判.jsonl、
 * autonomy.json……**这不是巧妙，是把一个东西切碎了藏。**
 *
 * 现在只有两样在外面，而且它们本来就不是状态：
 *   · 台账.md / 收件箱.md —— **人写的输入**，程序只读
 * and 其它一切：一个 .persona-framework/ledger.json
 *
 * 好处不是"文件少"，是**改一处不会漏另一处**：
 * 上一版 findGaps 和 runAutonomy 各算一遍缺口就是同一个病。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const EMPTY = () => ({
  done: {},        // 做过什么：key → 日期（同一件一天不做第二遍）
  weighs: {},      // 称重：缺口名 → { want, cost }
  thresholds: {},  // 阈值：假设 → { at, now }
  clashes: [],     // 撞车：报过还没判的
  blocked: [],     // 卡住：走到哪一步没过去
  pending: [],     // 待判：做完算不算数
  refused: [],     // 不干：三种理由
  closed: [],      // 收口：判过的
  runs: [],        // 跑过几轮
})

export function ledgerPath(ws) {
  return join(String(ws || process.cwd()), '.persona-framework', 'ledger.json')
}

export function load(ws) {
  const f = ledgerPath(ws)
  if (!existsSync(f)) return EMPTY()
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'))
    return { ...EMPTY(), ...(j && typeof j === 'object' ? j : {}) }
  } catch {
    return EMPTY()
  }
}

export function save(ws, st) {
  const f = ledgerPath(ws)
  const d = dirname(f)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  writeFileSync(f, JSON.stringify(st, null, 2), 'utf8')
  return f
}

/** 改一个键，别处不碰。 */
export function patch(ws, fn) {
  const st = load(ws)
  const out = fn(st) || st
  return { state: out, file: save(ws, out) }
}

/* ── 各状态的读写，全走这一本账 ── */

export const weigh = {
  get: (ws, src) => load(ws).weighs[src] || null,
  all: (ws) => load(ws).weighs,
  // **by 记谁称的**：人亲口的，还是号表撞上的。两者硬度不同，不能混成一个数。
  set(ws, src, want, cost, by = '人') {
    return patch(ws, (st) => { st.weighs[src] = { want, cost, by }; return st })
  },
}

export const threshold = {
  all: (ws) => load(ws).thresholds,
  bump(ws, what, at = 3) {
    return patch(ws, (st) => {
      const cur = st.thresholds[what] || { at, now: 0 }
      st.thresholds[what] = { at: cur.at || at, now: (cur.now || 0) + 1 }
      return st
    })
  },
  set(ws, what, at, now) {
    return patch(ws, (st) => { st.thresholds[what] = { at, now }; return st })
  },
}

export const clash = {
  all: (ws) => load(ws).clashes,
  add(ws, a, b, note = '') {
    return patch(ws, (st) => {
      st.clashes.push({ at: new Date().toISOString(), a, b, note, judged: null })
      return st
    })
  },
}

export const blocked = {
  all: (ws) => load(ws).blocked,
  add(ws, source, why, ask) {
    return patch(ws, (st) => {
      st.blocked = (st.blocked || []).filter((x) => x.source !== source)
      st.blocked.push({ at: new Date().toISOString(), source, why, ask })
      return st
    })
  },
  clear(ws, source) {
    return patch(ws, (st) => {
      st.blocked = (st.blocked || []).filter((x) => x.source !== source)
      return st
    })
  },
}

export const pending = {
  all: (ws) => load(ws).pending,
  add(ws, row) {
    return patch(ws, (st) => {
      st.pending.push({ at: new Date().toISOString(), judged: null, ...row })
      return st
    })
  },
}

export const refusal = {
  all: (ws) => load(ws).refused,
  add(ws, source, reason, why) {
    return patch(ws, (st) => {
      st.refused.push({ at: new Date().toISOString(), source, reason, why })
      return st
    })
  },
}

export const done = {
  has: (ws, key, today) => load(ws).done[key] === today,
  mark(ws, key, today) {
    return patch(ws, (st) => { st.done[key] = today; return st })
  },
}

/** 一句话摘要，给注入用。 */
export function summary(ws) {
  const st = load(ws)
  const n = (a) => (Array.isArray(a) ? a.length : 0)
  return {
    done: Object.keys(st.done).length,
    weighed: Object.keys(st.weighs).length,
    th: Object.keys(st.thresholds).length,
    clash: n(st.clashes),
    blocked: n(st.blocked),
    pending: n(st.pending),
    refused: n(st.refused),
    runs: n(st.runs),
  }
}
