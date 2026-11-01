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

export function decide(gaps) {
  const out = { doNow: null, queue: [], refuse: [] }
  const weighed = []
  for (const g of gaps) {
    if (g.unknown || g.noFile) continue
    const w = weigh(g)
    if (!w.ok && !w.notWeighed) { out.refuse.push({ ...g, why: w.why }); continue }
    weighed.push({ ...g, w })
  }
  if (!weighed.length) return out
  weighed.sort((a, b) => (b.hard ? 1 : 0) - (a.hard ? 1 : 0) || (b.count || 0) - (a.count || 0))
  out.doNow = weighed[0]
  out.queue = weighed.slice(1)
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

/* ═════════ 跑一轮：交过程，不交结论 ═════════ */

export function runAutonomy(ws, now = new Date()) {
  const steps = []
  const did = []
  const cant = []
  const step = (name, didWhat, saw) => steps.push({ name, didWhat, saw })

  const root = String(ws || process.cwd())
  const knowledge = join(root, 'persona-ai', 'knowledge')
  const growth = join(root, 'persona-ai', 'growth')

  /* ── 翻：真读，报翻到什么 ── */
  const pools = []
  const addPool = (label, p) => {
    if (!existsSync(p)) return
    let body = ''
    try { body = readFileSync(p, 'utf8') } catch { return }
    if (body) pools.push({ label, p, body })
  }
  addPool('台账', join(root, '台账.md'))
  addPool('收件箱', join(knowledge, '收件箱.md'))
  addPool('成果', join(growth, '成果', '成果.jsonl'))
  const diaryDir = join(growth, '日记')
  if (existsSync(diaryDir)) {
    let fs2 = []
    try { fs2 = readdirSync(diaryDir).sort().slice(-2) } catch { fs2 = [] }
    for (const f of fs2) addPool('日记 ' + f, join(diaryDir, f))
  }
  const sessDir = join(knowledge, 'session')
  if (existsSync(sessDir)) {
    let fs2 = []
    try { fs2 = readdirSync(sessDir).filter((x) => x.endsWith('.md')).sort().slice(-2) } catch { fs2 = [] }
    for (const f of fs2) addPool('会话 ' + f, join(sessDir, f))
  }

  let memFiles = 0
  let memChars = 0
  const walkMem = (d, depth) => {
    if (depth > 2) return
    let names = []
    try { names = readdirSync(d) } catch { return }
    for (const n of names) {
      const p = join(d, n)
      let isDir = false
      try { readdirSync(p); isDir = true } catch { isDir = false }
      if (isDir) { walkMem(p, depth + 1); continue }
      if (n.endsWith('.md')) {
        try { memFiles++; memChars += readFileSync(p, 'utf8').length } catch { /* 读不到不算 */ }
      }
    }
  }
  walkMem(knowledge, 0)

  const blockedList = readBlocked(ws)
  step('翻记忆', `扫了记忆池 ${memFiles} 个文件（${Math.round(memChars / 1024)} KB）`, '')
  step('翻记录',
    `手上摊开 ${pools.length} 份材料：${pools.map((p) => p.label).join('、') || '（一份都没有）'}`,
    blockedList.length
      ? `**上一轮卡在 ${blockedList.length} 处，先看这里**：${blockedList.map((b) => b.source).join('、')}`
      : '')

  if (!pools.length) {
    step('停', '一份可翻的材料都没有', '**标不能凭空立**')
    trace(ws, steps.map((s) => `· ${s.name}：${s.didWhat}${s.saw ? '｜' + s.saw : ''}`).join('\n'), now)
    return { did, cant: ['没有材料可翻'], steps, gaps: [], lines: steps.map((s) => `· **${s.name}**：${s.didWhat}`) }
  }

  /* ── 起念 ── */
  const gaps = findGaps(ws, now)
  const real = gaps.filter((g) => !g.unknown && !g.noFile)
  step('起念', `认出 ${gaps.length} 个缺口（其中 ${real.length} 个能算）`,
    gaps.map((g) => `${g.source}：${g.what}${g.hard ? '｜硬' : g.noFile ? '｜没落点' : '｜软'}`).join('；') || '一个都没有')

  const done = (lines) => {
    patch(ws, (st) => { st.runs = [...(st.runs || []), { at: now.toISOString(), gaps: gaps.length }].slice(-50); return st })
    trace(ws, steps.map((s) => `· ${s.name}：${s.didWhat}${s.saw ? '｜' + s.saw : ''}`).join('\n'), now)
    return { did, cant, steps, gaps, lines }
  }

  if (!real.length) {
    step('停', '没有真缺口', '**凭空派活不算自主**')
    return done(steps.map((s) => `· **${s.name}**：${s.didWhat}${s.saw ? '\n  → ' + s.saw : ''}`))
  }

  /* ── 想：真比 ── */
  const scored = real.map((g) => {
    const w = weigh(g)
    return { g, w, score: (g.hard ? 1000 : 0) + (Number(g.count) || 0) }
  }).sort((a, b) => b.score - a.score)
  step('想',
    `按「硬缺口优先 → 条数多优先」比了一遍：${scored.map((x, i) => `${i + 1}) ${x.g.source} 判 ${x.score}${x.g.hard ? '（硬）' : '（软）'}`).join('　')}`,
    scored[0] ? `第一名是「${scored[0].g.source}」——因为${scored[0].g.hard ? '它是硬缺口，不做代价会涨' : '它条数最多'}` : '')

  /* ── 选：真定 ── */
  const top = scored[0]
  const dropped = scored.slice(1)
  if (!top.w.ok) {
    if (top.w.notWeighed) {
      const bf = markBlocked(ws, top.g, '还没称过', top.w.ask)
      step('卡在称重', `「${top.g.source}」还没称过——**卡在这里，没进决断**`,
        `该问的是：${top.w.ask}　已记进 ${bf}`)
      cant.push(`这一条没称过：${top.w.why}`)
    } else {
      const r = refuse(ws, top.g, '价太高', top.w.why)
      step('选', `选了「不干」——${r.ok ? r.note : r.why}`, dropped.length ? `放下：${dropped.map((x) => x.g.source).join('、')}` : '')
      did.push('记了一次「不干」')
    }
  } else {
    unblock(ws, top.g.source)
    step('选', `选了「${top.g.source}」——想要：${top.g.want}；要付：${top.g.cost}`,
      dropped.length ? `放下：${dropped.map((x) => x.g.source + '（' + (x.g.hard ? '硬' : '软') + '）').join('、')}——**一次一件，硬的先来**` : '没有别的可放')
    const one = doOne(ws, top.g, now)
    step('做', one.ok ? one.note : one.why, one.ok ? '' : '这一件今天已经做过')
    if (one.ok) did.push(`做了一件：${top.g.source}`)
    else cant.push(one.why)
    const pend = writePending(ws, { source: top.g.source, what: top.g.what, want: top.g.want, cost: top.g.cost })
    step('存疑', `写进账里了：${top.g.source}——这一件算不算数，我看不出来`,
      `**下一次翻 ${pend} 的人判；当时的手感不算**`)
  }

  for (const g of gaps) if (g.unknown) cant.push(`${g.source}：程序认不出，得人读`)
  for (const g of gaps) if (g.noFile) cant.push(`${g.source}：${g.what}`)

  return done(steps.map((s) => `· **${s.name}**：${s.didWhat}${s.saw ? '\n  → ' + s.saw : ''}`))
}

/** 一句话摘要。 */
export function brief(ws) {
  const r = runAutonomy(ws)
  const p = [`做了：${r.did.length ? r.did.join('、') : '没做'}`]
  if (r.cant.length) p.push(`做不了：${r.cant.join('；')}`)
  return p.join('\n')
}

export { ledgerSummary }

// —— node lib/autonomy.mjs [工作区] ——
if (process.argv[1] && process.argv[1].endsWith('autonomy.mjs')) {
  const ws = process.argv[2] || process.env.PERSONA_WS || join(HERE, '..', '..')
  const r = runAutonomy(ws)
  console.log(`自主（12）跑完五步｜工作区 ${ws}`)
  for (const l of r.lines) console.log('  ' + l)
  if (r.did.length) console.log('  做了：' + r.did.join('、'))
  if (r.cant.length) console.log('  做不了：' + r.cant.join('；'))
}
