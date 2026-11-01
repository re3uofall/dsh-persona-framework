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

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
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
const LEDGER = {
  台账到期: { want: '把欠着的那几条清掉，不用再记着', cost: '要一条条做，做不完还得留着' },
  问题攒着没问: { want: '把攒着的问题问出去，别烂在收件箱里', cost: '问出去可能被驳回，还可能显得没想清楚' },
  方向堆着没挖: { want: '把排着的方向挖一条，碗外面多一块', cost: '要花一段整块时间，挖空也可能空手回来' },
  记录断更: { want: '今天留下一条能回读的字', cost: '十分钟，而且可能写不出什么像样的' },
  假设到阈值: { want: '把这假设了结掉', cost: '要翻够次数的记录才判得了' },
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
    if (open > 0) gaps.push({ source: '台账到期', at: p, count: open, hard: true, what: `${open} 条没勾`, ...LEDGER['台账到期'] })
  }

  // 源二：假设到阈值 —— 找不到阈值台账就不起念，并记「这个源手上没据」。
  // **不是没查，是查了没有。**

  // 源三：问题攒着没问 —— 收件箱里没处理的。
  for (const rel of [['persona-ai', 'knowledge', '收件箱.md'], ['收件箱.md']]) {
    const p = join(wsRoot, ...rel)
    if (!existsSync(p)) continue
    let t = ''
    try { t = readFileSync(p, 'utf8') } catch { continue }
    const open = (t.match(/^\s*[-*]\s*(?!\[x\])/gm) || []).length
    if (open > 0) gaps.push({ source: '问题攒着没问', at: p, count: open, hard: false, what: `${open} 条没处理`, ...LEDGER['问题攒着没问'] })
    break
  }

  // 源四：方向堆着没挖 —— queue 里排着的探索方向。
  for (const name of ['explore-queue.json', 'queue.json']) {
    const p = join(wsRoot, '.persona-framework', name)
    if (!existsSync(p)) continue
    try {
      const j = JSON.parse(readFileSync(p, 'utf8'))
      const n = Array.isArray(j) ? j.length : (Array.isArray(j.queue) ? j.queue.length : 0)
      if (n > 0) gaps.push({ source: '方向堆着没挖', at: p, count: n, hard: false, what: `${n} 个方向排着`, ...LEDGER['方向堆着没挖'] })
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
        ...LEDGER['记录断更'],
      })
    }
  }

  // 源六：记忆撞车 —— 两条记忆指同一件事却说法不同。程序判不了，
  //       只报「这个源要人判」——**不冒充查过了**。
  gaps.push({
    source: '记忆撞车', at: '', count: 0, hard: false, unknown: true,
    what: '这一条程序判不了：两条记忆指同一件事却说法不同，得人读才认得出',
  })

  return gaps
}

/**
 * 二、称重。每条念必须带上「想要 + 代价」两样，缺一样就不准上场。
 * 缺口源只说出「缺什么」，想要和代价得由调用方补——补不上就不过。
 */
export function weigh(gap) {
  const w = String(gap.want || '').trim()
  const c = String(gap.cost || '').trim()
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
 * 跑一轮完整五步。**这是「自主」这个功能的程序**——
 * 不是提醒该做什么，是把五步真走一遍。
 */
export function runAutonomy(ws, now = new Date()) {
  const gaps = findGaps(ws, now)
  const d = decide(gaps, { now })
  const lines = []
  const did = []
  const cant = []

  lines.push(`· 起念：${gaps.length} 个缺口`)
  for (const g of gaps) {
    if (g.unknown) {
      lines.push(`  - ${g.source}：${g.what}`)
      cant.push(`${g.source}（程序判不了，要人读）`)
      continue
    }
    lines.push(`  - ${g.source}：${g.what}${g.hard ? '｜硬缺口' : '｜软缺口'}`)
  }

  const real = gaps.filter((g) => !g.unknown)
  if (!real.length) {
    lines.push('· 决断：**没有缺口，就不起念**——凭空派活不算自主')
    trace(ws, lines.join('\n'), now)
    return { did, cant, gaps, decision: null, lines }
  }

  if (d.doNow) {
    const w = d.doNow.w
    lines.push(`· 称重：${w.ok ? w.why : '不过——' + w.why}`)
    if (!w.ok) {
      const r = refuse(ws, d.doNow, '价太高', w.why, now)
      lines.push(`· 决断：不干｜${r.ok ? r.note : r.why}`)
      did.push('记了一次「不干」')
      cant.push('这一件价没算清，没做')
    } else {
      const one = doOne(ws, d.doNow, now)
      lines.push(`· 决断：直接做（${d.doNow.hard ? '硬缺口，不排' : '排在前面'}）`)
      lines.push(`· 做：${one.ok ? one.note : one.why}`)
      if (one.ok) did.push(`做了一件：${d.doNow.source}`)
      else cant.push(one.why)
      lines.push('· 收口：留了痕迹，等下一次翻记录判（当时的手感不算数）')
    }
  }
  if (d.queue.length) lines.push(`· 排进去：${d.queue.map((q) => q.source).join('、')}`)
  for (const r of d.refuse) lines.push(`· 过不了称重：${r.source}｜${r.why}`)

  trace(ws, lines.join('\n'), now)
  return { did, cant, gaps, decision: d, lines }
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
