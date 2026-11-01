/**
 * 12 · 自主 —— 功能层程序。
 *
 * 正文五步，照着一句一句翻，一步不省、顺序不倒：
 *   一、起念。念只从缺口来。六个源，指不出缺在哪就不起念。
 *   二、称重。想要、要付，两样都写出来才准上场；**这两样从账里读，不替它编**。
 *   三、决断。硬缺口直接做，软的排；留一部分「不干」——真硬 / 价太高 / 不想付。
 *   四、做。一次一件，同一件一天不做第二遍。做完落成能查的字。
 *   五、收口。算不算数由下一次翻记录的人判，不由当时的手感判。
 *
 * 交出去的是**过程**，不是结论：翻了什么、比了什么、选了哪个、放下哪个、卡在哪。
 *
 * 运行时状态只在 **一本账**：.persona-framework/ledger.json
 * 外面只留两样人写的输入：台账.md、收件箱.md。
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { weightOf } from './adjust.mjs'
import {
  blocked as BLK, clash as CLASH, done as DONE, ledgerPath, patch,
  pending as PEND, refusal as REF, summary as ledgerSummary, threshold as TH, weigh as WEIGH,
} from './ledger.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 「不干」的理由只认这三种（正文第三节明写）。 */
export const REFUSE_REASONS = {
  真硬: '缺口是真的做不了——条件不具备，不是我不肯',
  价太高: '做得到，但要付的价大过这件事值——算过了才说',
  不想付: '付得起，我不肯付——这一条最要说清楚，别包装成前两种',
}

/* ═════════ 一、起念 ═════════ */

/**
 * 六个缺口源，一个都不能凭空造。落点：
 *   台账到期 ← 台账.md｜假设到阈值 ← 账里 thresholds｜问题攒着没问 ← 收件箱.md
 *   方向堆着没挖 ← explore-queue.json｜记录断更 ← 日记/｜记忆撞车 ← 账里 clashes
 */
export function findGaps(ws, now = new Date()) {
  const root = String(ws || process.cwd())
  const gaps = []
  const dayOf = (n) => ((/(\d{4}-\d{2}-\d{2})/.exec(n) || [])[1] || '')

  // 源一：台账到期
  for (const name of ['台账.md', '待办.md', 'TODO.md']) {
    const p = join(root, name)
    if (!existsSync(p)) continue
    let t = ''
    try { t = readFileSync(p, 'utf8') } catch { continue }
    const open = (t.match(/^\s*[-*]\s*\[ \]/gm) || []).length
    if (open > 0) gaps.push({ source: '台账到期', at: p, count: open, hard: true, what: `${open} 条没勾` })
    break
  }

  // 源二：假设到阈值
  const ths = readThresholds(ws)
  const due = ths.filter((x) => x.now >= x.at)
  for (const x of due) {
    gaps.push({
      source: '假设到阈值', at: ledgerPath(ws), count: due.length, hard: true,
      what: `「${x.what}」撞了 ${x.now} 次，到 ${x.at} 次了`,
    })
  }
  if (!ths.length) {
    gaps.push({
      source: '假设到阈值', at: ledgerPath(ws), count: 0, hard: false, noFile: true,
      what: '阈值台账里一条都没有——这个源还没长出来',
    })
  }

  // 源三：问题攒着没问
  for (const rel of [['persona-ai', 'knowledge', '收件箱.md'], ['收件箱.md']]) {
    const p = join(root, ...rel)
    if (!existsSync(p)) continue
    let t = ''
    try { t = readFileSync(p, 'utf8') } catch { continue }
    const open = (t.match(/^\s*[-*]\s*(?!\[x\])/gm) || []).length
    if (open > 0) gaps.push({ source: '问题攒着没问', at: p, count: open, hard: false, what: `${open} 条没处理` })
    break
  }

  // 源四：方向堆着没挖
  for (const name of ['explore-queue.json', 'queue.json']) {
    const p = join(root, '.persona-framework', name)
    if (!existsSync(p)) continue
    try {
      const j = JSON.parse(readFileSync(p, 'utf8'))
      const n = Array.isArray(j) ? j.length : (Array.isArray(j.queue) ? j.queue.length : 0)
      if (n > 0) gaps.push({ source: '方向堆着没挖', at: p, count: n, hard: false, what: `${n} 个方向排着` })
    } catch { /* 读不出来就不起念 */ }
  }

  // 源五：记录断更
  const diaryDir = join(root, 'persona-ai', 'growth', '日记')
  if (existsSync(diaryDir)) {
    let names = []
    try { names = readdirSync(diaryDir) } catch { names = [] }
    const today = now.toISOString().slice(0, 10)
    if (!names.some((n) => dayOf(n) === today)) {
      const latest = names.map(dayOf).filter(Boolean).sort().pop() || ''
      gaps.push({
        source: '记录断更', at: diaryDir, count: 1, hard: true,
        what: latest ? `今天还没记，上次是 ${latest}` : '一条日记都没有',
      })
    }
  }

  // 源六：记忆撞车
  const clashes = readClashes(ws)
  if (clashes.length) {
    gaps.push({
      source: '记忆撞车', at: ledgerPath(ws), count: clashes.length, hard: false,
      what: `${clashes.length} 条撞车报过还没判`,
    })
  } else {
    gaps.push({
      source: '记忆撞车', at: ledgerPath(ws), count: 0, hard: false, noFile: true,
      what: '撞车记录里一条都没报过——**这不是「没有撞车」，是「还没人报」**',
    })
  }

  // 称重：从账里取。取不到就是没称过，不拿模板顶。
  const led = WEIGH.all(ws)
  for (const g of gaps) {
    const w = led[g.source]
    if (w) { g.want = w.want; g.cost = w.cost }
  }
  return gaps
}

/* ═════════ 二、称重 ═════════ */

export function weigh(gap) {
  const w = String(gap.want || '').trim()
  const c = String(gap.cost || '').trim()
  if (!w && !c) {
    return {
      ok: false,
      notWeighed: true,
      why: `「${gap.source}」还没称过——**不是「没想清楚」，是这一条根本没称**`,
      ask: '称重要问两样：想要什么（做到了得到什么）；要付什么（时间、力气、代价）。',
      writeTo: '账里的 weighs',
    }
  }
  if (!w) return { ok: false, why: '只写了代价，没写想要——那是不敢' }
  if (!c) return { ok: false, why: '只写了想要，没写代价——那是愿望。不带价的念最容易上头' }
  return { ok: true, why: `想要：${w}；要付：${c}` }
}

export function setWeigh(ws, source, want, cost) {
  WEIGH.set(ws, source, want, cost)
  return ledgerPath(ws)
}

/* ═════════ 三、决断 ═════════ */

/**
 * 排先后的规则，**只有这一份**。
 *
 * 它是通用手段，不认识任何一种具体对象的形状：字段名由调用方给。
 * 三层，顺序不许倒：**硬的先走 → 同一层看权重 → 还平看提过几遍**。
 *
 * 权重为什么在这儿而不在别处：它改的是「同一层里谁先」。
 * 让它去顶硬约束，就成了拿口味改期限。
 *
 * @param items  任何一组东西
 * @param adjBook 调节账（可以是 null，那就退化成「硬 → 次数」）
 * @param opts.keyOf    取权重键，返回一个键或一组键（多个键相乘）
 * @param opts.hardOf   取「硬不硬」
 * @param opts.countOf  取「提过几遍」
 */
export function rankBy(items, adjBook, opts = {}) {
  const keyOf = opts.keyOf || ((x) => [x.source, x.what])
  const hardOf = opts.hardOf || ((x) => x.hard)
  const countOf = opts.countOf || ((x) => x.count)
  const wt = (x) => {
    try {
      const ks = [].concat(keyOf(x) || []).filter(Boolean)
      if (!ks.length) return 1
      return ks.reduce((p, k) => p * weightOf(adjBook, k), 1)
    } catch { return 1 }
  }
  return [...(items || [])].sort((a, b) =>
    (hardOf(b) ? 1 : 0) - (hardOf(a) ? 1 : 0)
    || wt(b) - wt(a)
    || (countOf(b) || 0) - (countOf(a) || 0))
}

/** 缺口那一种形状的特化——字段就是 source / what / hard / count。 */
export const rankByWeight = (weighed, adjBook) => rankBy(weighed, adjBook)

export function decide(gaps, adjBook) {
  const out = { doNow: null, queue: [], refuse: [] }
  const weighed = []
  for (const g of gaps) {
    if (g.unknown || g.noFile) continue
    const w = weigh(g)
    if (!w.ok && !w.notWeighed) { out.refuse.push({ ...g, why: w.why }); continue }
    weighed.push({ ...g, w })
  }
  if (!weighed.length) return out
  const ranked = rankByWeight(weighed, adjBook)
  out.doNow = ranked[0]
  out.queue = ranked.slice(1)
  return out
}

/* ═════════ 四、做 ═════════ */

export function doOne(ws, item, now = new Date()) {
  const today = now.toISOString().slice(0, 10)
  const key = `${item.source}｜${item.at || ''}`
  if (DONE.has(ws, key, today)) {
    return { ok: false, why: `这一件今天已经做过了（${key}）——同一件一天不做第二遍，做两遍是磨` }
  }
  DONE.mark(ws, key, today)
  return { ok: true, key, note: '记了一件做过；内容得自己写，程序不代写' }
}

/** 「不干」留痕。 */
export function refuse(ws, gap, reason, why) {
  if (!REFUSE_REASONS[reason]) {
    return { ok: false, why: `理由只能是三种：${Object.keys(REFUSE_REASONS).join(' / ')}——含糊的不算` }
  }
  REF.add(ws, gap.source, reason, why || '')
  return { ok: true, note: `${reason}：${REFUSE_REASONS[reason]}` }
}

/* ═════════ 五、收口 ═════════ */

export function closeOut(ws, item, verdict, why) {
  patch(ws, (st) => {
    st.closed = [...(st.closed || []), { at: new Date().toISOString(), source: item.source, verdict, why: why || '' }].slice(-100)
    return st
  })
  return { ok: true }
}

/* ═════════ 落点（全走一本账） ═════════ */

export function weighPath(ws) { return ledgerPath(ws) }
export function readWeighs(ws) { return WEIGH.all(ws) }
export function ledgerOf(ws) { return WEIGH.all(ws) }
export function thresholdPath(ws) { return ledgerPath(ws) }
export function readThresholds(ws) {
  return Object.entries(TH.all(ws)).map(([what, v]) => ({ what, at: v.at, now: v.now }))
}
export function bumpThreshold(ws, what, at = 3) { TH.bump(ws, what, at); return ledgerPath(ws) }
export function clashPath(ws) { return ledgerPath(ws) }
export function reportClash(ws, a, b, note) { CLASH.add(ws, a, b, note); return ledgerPath(ws) }
export function readClashes(ws) { return CLASH.all(ws).filter((x) => !x.judged) }
export function pendingPath(ws) { return ledgerPath(ws) }
export function writePending(ws, row) { PEND.add(ws, row); return ledgerPath(ws) }
export function readPending(ws) { return PEND.all(ws).filter((x) => !x.judged) }
export function blockedPath(ws) { return ledgerPath(ws) }
export function markBlocked(ws, gap, why, ask) { BLK.add(ws, gap.source, why, ask); return ledgerPath(ws) }
export function readBlocked(ws) { return BLK.all(ws) }
export function unblock(ws, source) { BLK.clear(ws, source); return true }

/* ═════════ 痕迹：一行一轮 ═════════ */

const TRACE = (ws) => join(String(ws || process.cwd()), '.persona-framework', 'autonomy.log.md')

export function trace(ws, text, now = new Date()) {
  const f = TRACE(ws)
  const d = dirname(f)
  try {
    if (!existsSync(d)) writeFileSync(d + '/.keep', '', { flag: 'a' })
    const head = existsSync(f)
      ? readFileSync(f, 'utf8')
      : '# 自主的痕迹\n\n> 每一轮自己跑一遍五步，落一行。这不是给人看的汇报，是它自己的账。\n\n'
    writeFileSync(f, head + `## ${now.toISOString()}\n${text}\n\n`, 'utf8')
  } catch { /* 写不进去就空着，不因为没留痕就停 */ }
  return f
}

/* ═════════ 跑一轮：**不在这儿** ═════════
 *
 * 流程只有一份，在 lib/tick.mjs：00 读环境 → 12a 起念 → 12b 称重 → 12c 决断 → 12d 做 → 99 落地。
 * 这个文件只留**零件**：findGaps / weigh / decide / doOne / refuse / 各落点的读写。
 *
 * 为什么删：上一版这里写了一份 runAutonomy，tick.mjs 里又写了一份 system 表，
 * **同一件事两份实现**——改了一个另一个不跟着动。那就是我自己一直在犯的病。
 */

export { ledgerSummary }
