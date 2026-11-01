/**
 * 12 · 自主 —— 功能层的程序（不是调度器，不是触发器）。
 *
 * 正文给的是五步，这个文件就照着五步执行，一步不省、顺序不倒：
 *
 *   一、起念。**念只从缺口来。** 六个缺口源：台账到期、假设到阈值、
 *       问题攒着没问、方向堆着没挖、记录断更、记忆撞车。
 *       指不出缺口在哪，就是凭空派活——不许起念。
 *   二、称重。每条念带两样：想要什么、要付什么。
 *       **只写想要是愿望，只写代价是不敢**；两样都写出来才准上场。
 *   三、决断。平时按分排；到期、到阈值、断更过线，不排，直接做。
 *       决断里留一部分「不干」——真硬、价太高、不想付。说「不」也是自主，而且照样留痕。
 *   四、做。**一次一件，同一件一天不做第二遍。** 做完必须落成能查的字；
 *       没留下东西的「做了」等于没做。
 *   五、收口。算不算数由下一次翻记录的人判，不由当时的手感判。
 *
 * 跟 assert12 的分工：那个是**查一段话**像不像自主的；
 * 这个文件是**真跑一遍**这五步，并把痕迹落成能回读的字。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * 每种缺口自带的「想要 / 代价」。
 *
 * 缺口只说出「缺什么」，说出缺什么之后，想要和代价是可以按源算出来的——
 * 不算出来，每条都会被卡在「价没算清」上，五步一步都走不动。
 * 算出来之后仍然要过 weigh：两样缺一样，照样不准上场。
 */
/**
 * 称重台账：正文说「每条念带两样：想要什么、要付什么。两样都写出来才准上场」。
 *
 * **这两样不能由程序编。** 编出来的不是称重，是替它写。
 * 所以它们存在一个文件里，程序真去读：
 *   - 读到 → 用读到的
 *   - 读不到 → 报「这一条还没称过」，并说出该问什么
 *
 * 文件格式（.persona-framework/称重.md）：
 *   - 记录断更｜想要：今天留下一条能回读的字｜要付：十分钟
 */
export function weighPath(ws) {
  return join(String(ws || process.cwd()), '.persona-framework', '称重.md')
}

/** 真读称重台账，解析成 source → { want, cost }。 */
export function readWeighs(ws) {
  const f = weighPath(ws)
  if (!existsSync(f)) return {}
  const out = {}
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^-\s*(.+?)\s*｜\s*想要：(.+?)\s*｜\s*要付：(.+)$/)
    if (m) out[m[1].trim()] = { want: m[2].trim(), cost: m[3].trim() }
  }
  return out
}

/** 记一条称重。写进去之后，下一轮就真读得到。 */
export function writeWeigh(ws, source, want, cost, now = new Date()) {
  const f = weighPath(ws)
  const d = dirname(f)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  const head = existsSync(f)
    ? readFileSync(f, 'utf8')
    : '# 称重台账\n\n> 一行一条：缺口的名字 ｜ 想要什么 ｜ 要付什么。两样缺一样就不准上场。\n\n'
  const rows = head.split('\n').filter((l) => l.trim() && !l.startsWith('#'))
  const kept = rows.filter((l) => !l.startsWith(`- ${source}｜`))
  kept.push(`- ${source}｜想要：${want}｜要付：${cost}`)
  writeFileSync(f, head.split('\n').slice(0, 2).join('\n') + '\n\n' + kept.join('\n') + '\n', 'utf8')
  return f
}

/** 每条缺口的「想要/代价」从台账里取；取不到就是没称过。 */
export function ledgerOf(ws) {
  return readWeighs(ws)
}
export const REFUSE_REASONS = {
  真硬: '缺口是真的做不了——条件不具备，不是我不肯',
  价太高: '做得到，但要付的价大过这件事值——算过了才说',
  不想付: '付得起，我不肯付——这一条最要说清楚，别包装成前两种',
}

/**
 * 一、起念。
 *
 * **六个缺口源，一个都不能凭空造。** 每个源都要指得出「缺在哪」：
 * 指不出（没有名字、没有路径、没有条目），这个源就不起念。
 */
export function findGaps(ws, now = new Date()) {
  const wsRoot = String(ws || process.cwd())
  const growth = join(wsRoot, 'persona-ai', 'growth')
  const gaps = []
  const dayOf = (n) => ((/(\d{4}-\d{2}-\d{2})/.exec(n) || [])[1] || '')

  // 源一：台账到期。工作区里有台账就认，没有就不起。
  for (const name of ['台账.md', '待办.md', 'TODO.md']) {
    const p = join(wsRoot, name)
    if (!existsSync(p)) continue
    let t = ''
    try { t = readFileSync(p, 'utf8') } catch { continue }
    const open = (t.match(/^\s*[-*]\s*\[ \]/gm) || []).length
    if (open > 0) gaps.push({ source: '台账到期', at: p, count: open, hard: true, what: `${open} 条没勾` })
  }

  // 源二：假设到阈值 —— 真去读阈值台账。
  // 台账不在，这个源就报「没有台账」，不冒充查过。
  const ths = readThresholds(ws)
  const due = ths.filter((x) => x.now >= x.at)
  if (due.length) {
    for (const x of due) {
      gaps.push({
        source: '假设到阈值', at: thresholdPath(ws), count: due.length, hard: true,
        what: `「${x.what}」撞了 ${x.now} 次，到 ${x.at} 次了`,

      })
    }
  } else if (!ths.length) {
    gaps.push({
      source: '假设到阈值', at: thresholdPath(ws), count: 0, hard: false, noFile: true,
      what: '没有阈值台账——这个源还没长出来',
    })
  }

  // 源三：问题攒着没问 —— 收件箱里没处理的。
  for (const rel of [['persona-ai', 'knowledge', '收件箱.md'], ['收件箱.md']]) {
    const p = join(wsRoot, ...rel)
    if (!existsSync(p)) continue
    let t = ''
    try { t = readFileSync(p, 'utf8') } catch { continue }
    const open = (t.match(/^\s*[-*]\s*(?!\[x\])/gm) || []).length
    if (open > 0) gaps.push({ source: '问题攒着没问', at: p, count: open, hard: false, what: `${open} 条没处理` })
    break
  }

  // 源四：方向堆着没挖 —— queue 里排着的探索方向。
  for (const name of ['explore-queue.json', 'queue.json']) {
    const p = join(wsRoot, '.persona-framework', name)
    if (!existsSync(p)) continue
    try {
      const j = JSON.parse(readFileSync(p, 'utf8'))
      const n = Array.isArray(j) ? j.length : (Array.isArray(j.queue) ? j.queue.length : 0)
      if (n > 0) gaps.push({ source: '方向堆着没挖', at: p, count: n, hard: false, what: `${n} 个方向排着` })
    } catch { /* 读不出来就不起念 */ }
  }

  // 源五：记录断更 —— 今天的日记还没有。
  const diaryDir = join(growth, '日记')
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

  // 源六：记忆撞车 —— 程序认不出语义，但**报过没有、报了几条，查得出来**。
  const clashes = readClashes(ws)
  if (clashes.length) {
    gaps.push({
      source: '记忆撞车', at: clashPath(ws), count: clashes.length, hard: false,
      what: `${clashes.length} 条撞车报过还没判`,

    })
  } else {
    gaps.push({
      source: '记忆撞车', at: clashPath(ws), count: 0, hard: false, noFile: true,
      what: '撞车记录里一条都没报过——**这不是「没有撞车」，是「还没人报」**',
    })
  }

  // 称重：从台账里取想要/代价。**取不到就是没称过**，不是「没写」。
  const led = ledgerOf(ws)
  for (const g of gaps) {
    const w = led[g.source]
    if (w) { g.want = w.want; g.cost = w.cost }
  }
  return gaps
}

/**
 * 二、称重。每条念必须带上「想要 + 代价」两样，缺一样就不准上场。
 * 缺口源只说出「缺什么」，想要和代价得由调用方补——补不上就不过。
 */
export function weigh(gap) {
  const w = String(gap.want || '').trim()
  const c = String(gap.cost || '').trim()
  if (!w && !c) {
    return {
      ok: false,
      why: `「${gap.source}」还没称过——**不是「没想清楚」，是这一条根本没称**`,
      ask: '称重要问两样：想要什么（做到了得到什么）；要付什么（时间、力气、代价）。',
      writeTo: '.persona-framework/称重.md',
    }
  }
  if (!w && !c) return { ok: false, why: '想要和代价都没写——这不是念，是念头一闪' }
  if (!w) return { ok: false, why: '只写了代价，没写想要——那是不敢' }
  if (!c) return { ok: false, why: '只写了想要，没写代价——那是愿望。不带价的念最容易上头' }
  return { ok: true, why: `想要：${w}；要付：${c}` }
}

/**
 * 三、决断。三种出口：直接做、排进去、不干。
 * 硬缺口（到期、断更过线）不排，直接做；软缺口按条数排。
 */
export function decide(gaps, opts = {}) {
  const out = { doNow: null, queue: [], refuse: [] }
  const weighed = []
  for (const g of gaps) {
    if (g.unknown) continue // 判不了的源不进决断，只报告
    const w = weigh(g)
    if (!w.ok) { out.refuse.push({ ...g, why: w.why }); continue }
    weighed.push({ ...g, w })
  }
  if (!weighed.length) return out
  weighed.sort((a, b) => (b.hard ? 1 : 0) - (a.hard ? 1 : 0) || (b.count || 0) - (a.count || 0))
  out.doNow = weighed[0]
  out.queue = weighed.slice(1)
  return out
}


/* ───────── 翻译出来的落点：正文提到、但没有地方存的三样 ───────── */

/**
 * 存疑：正文说「收口由下一次翻记录的人判」。
 * 「下一次」要翻得到，就得有地方存——存疑不是一句话，是一条待判记录。
 */
export function pendingPath(ws) {
  return join(String(ws || process.cwd()), '.persona-framework', '待判.jsonl')
}
/** 写一条存疑。**写完它就在那儿，等下一次翻。** */
export function writePending(ws, row, now = new Date()) {
  const f = pendingPath(ws)
  const d = dirname(f)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  const line = JSON.stringify({ at: now.toISOString(), ...row }) + '\n'
  writeFileSync(f, (existsSync(f) ? readFileSync(f, 'utf8') : '') + line, 'utf8')
  return f
}
/** 读还没判的。下一次翻记录的人就翻这个。 */
export function readPending(ws) {
  const f = pendingPath(ws)
  if (!existsSync(f)) return []
  return readFileSync(f, 'utf8').split('\n').filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    .filter((r) => !r.judged)
}

/**
 * 阈值台账：正文说缺口源里有「假设到阈值」。
 * 一个假设要攒够几次才判得了——次数写在哪？得有个地方存。
 */
export function thresholdPath(ws) {
  return join(String(ws || process.cwd()), '.persona-framework', '阈值.md')
}
/** 读阈值台账：一行一条 `- 假设内容 ｜ 到 3 次 ｜ 已 2`。 */
export function readThresholds(ws) {
  const f = thresholdPath(ws)
  if (!existsSync(f)) return []
  const out = []
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^-\s*(.+?)｜到\s*(\d+)\s*次｜已\s*(\d+)/)
    if (m) out.push({ what: m[1].trim(), at: Number(m[2]), now: Number(m[3]) })
  }
  return out
}
/** 记一次：某个假设又撞上一次。撞够阈值就能起念了。 */
export function bumpThreshold(ws, what, at = 3) {
  const f = thresholdPath(ws)
  const d = dirname(f)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  const body = existsSync(f) ? readFileSync(f, 'utf8') : '# 阈值台账\n\n> 一行一个假设：撞够次数才判得了。\n\n'
  const lines = body.split('\n')
  let hit = false
  const out = lines.map((l) => {
    const m = l.match(/^-\s*(.+?)｜到\s*(\d+)\s*次｜已\s*(\d+)/)
    if (m && m[1].trim() === what) {
      hit = true
      return `- ${what}｜到 ${m[2]} 次｜已 ${Number(m[3]) + 1}`
    }
    return l
  })
  if (!hit) out.push(`- ${what}｜到 ${at} 次｜已 1`)
  writeFileSync(f, out.join('\n'), 'utf8')
  return f
}

/**
 * 撞车记录：正文说缺口源里有「记忆撞车」——两条记忆指同一件事却说法不同。
 * 程序认不出语义，但**能记下「有人说这两条撞了」**。记下来，才有人去判。
 */
export function clashPath(ws) {
  return join(String(ws || process.cwd()), '.persona-framework', '撞车.md')
}
export function reportClash(ws, a, b, note, now = new Date()) {
  const f = clashPath(ws)
  const d = dirname(f)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  const body = existsSync(f) ? readFileSync(f, 'utf8') : '# 撞车记录\n\n> 两条记忆指同一件事却说法不同。程序认不出语义，但能把「有人报过」记下来。\n\n'
  const line = `- [ ] ${now.toISOString().slice(0, 10)} ${a} ↔ ${b}${note ? '｜' + note : ''}\n`
  writeFileSync(f, body + line, 'utf8')
  return f
}
export function readClashes(ws) {
  const f = clashPath(ws)
  if (!existsSync(f)) return []
  return readFileSync(f, 'utf8').split('\n').filter((l) => /^-\s*\[ \]/.test(l))
}


/**
 * 卡住的地方：正文说「想要和代价两样都写出来才准上场」。
 *
 * 没称过的那一条，**不能只停在屏幕上**——下次跑得看得见它卡在这儿。
 * 这不是 exe 文件，是「像 exe 那样：上一轮的状态，下一轮接得上」。
 */
export function blockedPath(ws) {
  return join(String(ws || process.cwd()), '.persona-framework', '卡住.md')
}
/** 把一个卡住的缺口记下：为什么卡、该问什么。 */
export function markBlocked(ws, gap, why, ask, now = new Date()) {
  const f = blockedPath(ws)
  const d = dirname(f)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  const body = existsSync(f)
    ? readFileSync(f, 'utf8')
    : '# 卡住的地方\n\n> 走到这一步没过去，记在这儿。下一轮先看这里，别从零再来。\n\n'
  const lines = body.split('\n').filter((l) => !l.startsWith(`- ${gap.source}｜`))
  lines.push(`- ${gap.source}｜卡在：${why}｜该问：${ask}｜${now.toISOString().slice(0, 16)}`)
  writeFileSync(f, lines.join('\n') + '\n', 'utf8')
  return f
}
/** 读卡住的。下一轮跑的时候，先看这个，再谈新缺口。 */
export function readBlocked(ws) {
  const f = blockedPath(ws)
  if (!existsSync(f)) return []
  return readFileSync(f, 'utf8').split('\n').filter((l) => /^- .+｜卡在：/.test(l))
}
/** 一个缺口不再卡了（称过了 / 做掉了），从卡住里划掉。 */
export function unblock(ws, source) {
  const f = blockedPath(ws)
  if (!existsSync(f)) return false
  const lines = readFileSync(f, 'utf8').split('\n').filter((l) => !l.startsWith(`- ${source}｜`))
  writeFileSync(f, lines.join('\n'), 'utf8')
  return true
}

const STATE = (ws) => join(String(ws || process.cwd()), '.persona-framework', 'autonomy.json')
const TRACE = (ws) => join(String(ws || process.cwd()), '.persona-framework', 'autonomy.log.md')

function readState(ws) {
  const f = STATE(ws)
  const empty = { done: {}, refused: [], closed: [] }
  if (!existsSync(f)) return empty
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'))
    return {
      done: j.done || {},
      refused: Array.isArray(j.refused) ? j.refused : [],
      closed: Array.isArray(j.closed) ? j.closed : [],
    }
  } catch {
    return empty
  }
}
function writeState(ws, st) {
  const f = STATE(ws)
  const d = dirname(f)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  writeFileSync(f, JSON.stringify(st, null, 2), 'utf8')
  return f
}

/** 四、做。**一次一件，同一件一天不做第二遍。** */
export function doOne(ws, item, now = new Date()) {
  const today = now.toISOString().slice(0, 10)
  const st = readState(ws)
  const key = `${item.source}｜${item.at || ''}`
  if (st.done[key] === today) {
    return { ok: false, why: `这一件今天已经做过了（${key}）——同一件一天不做第二遍，做两遍是磨` }
  }
  st.done[key] = today
  writeState(ws, st)
  return { ok: true, key, note: '记了一件做过；内容得自己写，程序不代写' }
}

/** 五、收口。留痕，等下一次翻记录的人判。 */
export function closeOut(ws, item, verdict, why, now = new Date()) {
  const st = readState(ws)
  st.closed = [...(st.closed || []), { at: now.toISOString(), source: item.source, verdict, why: why || '' }].slice(-100)
  writeState(ws, st)
  return { ok: true }
}

/** 「不干」留痕。理由只认三种。 */
export function refuse(ws, gap, reason, why, now = new Date()) {
  if (!REFUSE_REASONS[reason]) {
    return { ok: false, why: `理由只能是三种：${Object.keys(REFUSE_REASONS).join(' / ')}——含糊的不算` }
  }
  const st = readState(ws)
  st.refused = [...(st.refused || []), { at: now.toISOString(), source: gap.source, reason, why: why || '' }].slice(-100)
  writeState(ws, st)
  return { ok: true, note: `${reason}：${REFUSE_REASONS[reason]}` }
}

/** 落一行痕迹。 */
export function trace(ws, text, now = new Date()) {
  const f = TRACE(ws)
  const d = dirname(f)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  const head = existsSync(f)
    ? readFileSync(f, 'utf8')
    : '# 自主的痕迹\n\n> 每一轮自己跑一遍五步，落一行。这不是给人看的汇报，是它自己的账。\n\n'
  writeFileSync(f, head + `## ${now.toISOString()}\n${text}\n\n`, 'utf8')
  return f
}

/**
 * 跑一轮完整五步。**这是「自主」这个功能的程序**。
 *
 * 一条硬规矩：**这里交出去的是过程，不是结论。**
 * 不写「你该先查」，写「我翻了这些、翻到这几条、比了比、选了这条、放下那两条」。
 * 位置不是一个说法，是走过的地方——没走过的地方不存在。
 */
export function runAutonomy(ws, now = new Date()) {
  const steps = []      // 过程：真走出来的每一步
  const did = []
  const cant = []

  const step = (name, didWhat, saw) => {
    steps.push({ name, didWhat, saw })
  }

  /* ── 一、翻：真去翻材料，报翻到了哪 ── */
  const root = String(ws || process.cwd())
  const pools = []
  const addPool = (label, p) => {
    if (!existsSync(p)) return
    let body = ''
    try { body = readFileSync(p, 'utf8') } catch { return }
    if (!body) return
    pools.push({ label, p, chars: body.length, body })
  }
  const growth = join(root, 'persona-ai', 'growth')
  const knowledge = join(root, 'persona-ai', 'knowledge')
  addPool('台账', join(root, '台账.md'))
  addPool('收件箱', join(knowledge, '收件箱.md'))
  addPool('成果', join(growth, '成果', '成果.jsonl'))
  const diaryDir = join(growth, '日记')
  if (existsSync(diaryDir)) {
    for (const f of (readdirSync(diaryDir).sort().slice(-2))) addPool('日记 ' + f, join(diaryDir, f))
  }
  const sessDir = join(knowledge, 'session')
  if (existsSync(sessDir)) {
    for (const f of (readdirSync(sessDir).filter((x) => x.endsWith('.md')).sort().slice(-2))) {
      addPool('会话 ' + f, join(sessDir, f))
    }
  }
  // 记忆池：粗扫一遍，只记数不记内容
  let memFiles = 0
  let memChars = 0
  const walkMem = (d, depth) => {
    if (depth > 2) return
    let names = []
    try { names = readdirSync(d) } catch { return }
    for (const n of names) {
      const p = join(d, n)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) { walkMem(p, depth + 1); continue }
      if (n.endsWith('.md')) { memFiles++; memChars += st.size }
    }
  }
  walkMem(knowledge, 0)

  step('翻记忆', `扫了记忆池 ${memFiles} 个文件（${Math.round(memChars / 1024)} KB）`, '')
  const blocked = readBlocked(ws)
  step('翻记录', `手上摊开 ${pools.length} 份材料：${pools.map((p) => p.label).join('、') || '（一份都没有）'}`,
    blocked.length ? `**上一轮卡在 ${blocked.length} 处，先看这里**：${blocked.map((l) => l.replace(/^- /, '').split('｜')[0]).join('、')}` : '')

  if (!pools.length) {
    steps.push({ name: '停', didWhat: '一份可翻的材料都没有', saw: '**标不能凭空立**——今天先不动' })
    trace(ws, steps.map((s) => `· ${s.name}：${s.didWhat}${s.saw ? '｜' + s.saw : ''}`).join('\n'), now)
    return { did, cant: ['没有材料可翻'], steps, gaps: [], decision: null, lines: steps.map((s) => `· ${s.name}：${s.didWhat}`) }
  }

  /* ── 二、找缺口：**调 findGaps，不在这儿再写一份** ──
   * 两份各写各的，就是「翻译」里最容易出的毛病：同一句话翻出两个版本，
   * 改了一个另一个不跟着动。六个源只许有一份实现。 */
  const gaps = findGaps(ws, now)

  step('起念', `认出 ${gaps.length} 个缺口（其中 ${gaps.filter((g) => !g.unknown && !g.noFile).length} 个能算）`,
    gaps.map((g) => `${g.source}：${g.what}${g.hard ? '｜硬' : g.noFile ? '｜没落点' : '｜软'}`).join('；') || '一个都没有')

  const real = gaps.filter((g) => !g.unknown && !g.noFile)
  if (!real.length) {
    step('停', '没有真缺口', '**凭空派活不算自主**')
    trace(ws, steps.map((s) => `· ${s.name}：${s.didWhat}${s.saw ? '｜' + s.saw : ''}`).join('\n'), now)
    return { did, cant, steps, gaps, decision: null, lines: steps.map((s) => `· ${s.name}：${s.didWhat}${s.saw ? '｜' + s.saw : ''}`) }
  }

  /* ── 三、想：真比，把比的过程写出来 ── */
  const scored = real.map((g) => {
    const w = weigh(g)
    const score = (g.hard ? 1000 : 0) + (Number(g.count) || 0)
    return { g, w, score }
  }).sort((a, b) => b.score - a.score)

  const rankLine = scored.map((x, i) => `${i + 1}) ${x.g.source} 判 ${x.score}${x.g.hard ? '（硬）' : '（软）'}`).join('　')
  step('想', `按「硬缺口优先 → 条数多优先」比了一遍：${rankLine}`,
    scored[0] ? `第一名是「${scored[0].g.source}」——因为${scored[0].g.hard ? '它是硬缺口，不做代价会涨' : '它条数最多'}` : '')

  /* ── 四、选：真选，并把放下的说清 ── */
  const top = scored[0]
  const dropped = scored.slice(1)
  if (!top.w.ok) {
    // 价没称过 ≠ 价太高。**不许拿「不干」把没称过盖过去**——
    // 「不干」是决断，没称过是还没到决断那一步。
    if (top.w.ask) {
      const bf = markBlocked(ws, top.g, '还没称过', top.w.ask, now)
      step('卡在称重', `「${top.g.source}」还没称过——**卡在这里，没进决断**`,
        `该问的是：${top.w.ask}　已记进 ${bf}——**下一轮先看这里**`)
      cant.push(`这一条没称过：${top.w.why}`)
    } else {
      const r = refuse(ws, top.g, '价太高', top.w.why, now)
      step('选', `选了「不干」——${r.ok ? r.note : r.why}`,
        dropped.length ? `放下：${dropped.map((x) => x.g.source).join('、')}` : '')
      did.push('记了一次「不干」')
    }
  } else {
    unblock(ws, top.g.source)  // 这一条称过了，不再卡着
    step('选', `选了「${top.g.source}」——想要：${top.g.want || '（没写）'}；要付：${top.g.cost || '（没写）'}`,
      dropped.length ? `放下：${dropped.map((x) => x.g.source + '（' + (x.g.hard ? '硬' : '软') + '）').join('、')}——**一次一件，硬的先来**` : '没有别的可放')
    const one = doOne(ws, top.g, now)
    step('做', one.ok ? one.note : one.why, one.ok ? '' : '这一件今天已经做过')
    if (one.ok) did.push(`做了一件：${top.g.source}`)
    else cant.push(one.why)
    const pend = writePending(ws, {
      what: top.g.source,
      what2: top.g.what,
      want: top.g.want,
      cost: top.g.cost,
      judged: null,
    }, now)
    step('存疑', `写进待判了：${top.g.source}——这一件算不算数，我看不出来`,
      `**下一次翻 ${pend} 的人判；当时的手感不算**`)
  }

  for (const g of gaps) {
    if (g.unknown) cant.push(`${g.source}：程序认不出，得人读`)
  }

  trace(ws, steps.map((s) => `· ${s.name}：${s.didWhat}${s.saw ? '｜' + s.saw : ''}`).join('\n'), now)
  const lines = steps.map((s) => `· **${s.name}**：${s.didWhat}${s.saw ? '\n  → ' + s.saw : ''}`)
  return { did, cant, steps, gaps, decision: { top: top?.g || null, dropped }, lines }
}

// —— node lib/autonomy.mjs [工作区] ——
if (process.argv[1] && process.argv[1].endsWith('autonomy.mjs')) {
  const ws = process.argv[2] || process.env.PERSONA_WS || join(HERE, '..', '..')
  const r = runAutonomy(ws)
  console.log(`自主（12）跑完五步｜工作区 ${ws}`)
  console.log(r.lines.map((l) => '  ' + l).join('\n'))
  if (r.did.length) console.log('  做了：' + r.did.join('、'))
  if (r.cant.length) console.log('  做不了：' + r.cant.join('；'))
}
