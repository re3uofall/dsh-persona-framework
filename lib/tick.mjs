/**
 * 一个 tick：照游戏引擎那套来，不是照「一个功能一个函数」那套来。
 *
 * 学到三条（Game Loop / Systems Execution / 数据与逻辑分开）：
 *
 *   一、**顺序固定**。每轮按同一张表跑一遍，不是「谁需要谁调」。
 *   二、**每个 system 只做一件事**，就一件事。它不认识别的 system。
 *   三、**数据在 world，逻辑在 system**。system 只读写 world，**不自己开文件**。
 *
 * 所以这一层不建文件、不写盘、不记状态——它只给 system 递一个 world，
 * 收回来一串 events。真正落地是别的层的事。
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { load as loadLedger, save as saveLedger, ledgerPath } from './ledger.mjs'

/* ───────────────── world ───────────────── */

/**
 * world 就是这一轮的手上：账 + 三个读数（记忆、记录、时间）。
 * **system 只认这个，不认路径**。换文件位置，system 一行都不用改。
 */
export function makeWorld(ws, now = new Date()) {
  const root = String(ws || process.cwd())
  const knowledge = join(root, 'persona-ai', 'knowledge')
  const growth = join(root, 'persona-ai', 'growth')

  const read = (p) => { try { return readFileSync(p, 'utf8') } catch { return '' } }
  const ls = (d) => { try { return readdirSync(d) } catch { return [] } }

  // 记：记忆池里有几个文件、多少字
  let memFiles = 0
  let memChars = 0
  const walk = (d, depth) => {
    if (depth > 2) return
    for (const n of ls(d)) {
      const p = join(d, n)
      let isDir = false
      try { readdirSync(p); isDir = true } catch { isDir = false }
      if (isDir) { walk(p, depth + 1); continue }
      if (n.endsWith('.md')) { const t = read(p); memFiles++; memChars += t.length }
    }
  }
  walk(knowledge, 0)

  const diaryDir = join(growth, '日记')
  const diaries = ls(diaryDir).filter((n) => n.endsWith('.md')).sort()
  const today = now.toISOString().slice(0, 10)
  const days = diaries.map((n) => ((/(\d{4}-\d{2}-\d{2})/.exec(n) || [])[1] || '')).filter(Boolean)

  return {
    ws: root,
    now,
    today,
    ledger: loadLedger(root),
    read,
    ls,
    facts: {
      memFiles,
      memChars,
      memKB: Math.round(memChars / 1024),
      diaryCount: diaries.length,
      // 别动原数组：sort().pop() 会把最后一个真删掉，下面 hasDiaryToday 就永远 false
      lastDiary: [...days].sort().pop() || '',
      hasDiaryToday: days.some((d) => String(d) === String(today)),
      openTodo: (read(join(root, '台账.md')).match(/^\s*[-*]\s*\[ \]/gm) || []).length,
      inboxOpen: (read(join(knowledge, '收件箱.md')).match(/^\s*[-*]\s*(?!\[x\])/gm) || []).length,
      queueOpen: (() => {
        for (const name of ['explore-queue.json', 'queue.json']) {
          const p = join(root, '.persona-framework', name)
          if (!existsSync(p)) continue
          try {
            const j = JSON.parse(read(p) || '{}')
            const n = Array.isArray(j) ? j.length : (Array.isArray(j.queue) ? j.queue.length : 0)
            if (n > 0) return n
          } catch { /* 读不出来当没有 */ }
        }
        return 0
      })(),
      hasCharacters: existsSync(join(root, 'persona-ai', 'characters')),
      hasModules: existsSync(join(root, 'persona-ai', 'modules')),
    },
  }
}

/* ───────────────── system 表 ───────────────── */

/**
 * 一张表，**顺序就是执行顺序**，不许谁插队。
 *
 * 为什么是这个顺序（照游戏引擎的依赖排序）：
 *   先读 → 再判 → 再动 → 最后记。
 *   拿掉任何一环，后面的都在拿错的输入干活。
 *
 * 每个 system 签名一样：`(world) => { did?: [], out?: [], cant?: [], events?: [] }`
 * **它只读 world，只交 events。不写盘、不开文件。**
 */
export const SYSTEMS = []

function sys(id, name, run) {
  SYSTEMS.push({ id: String(id).padStart(2, '0'), name, run })
}

/* 一、读：把这一轮的真实读出来，不猜 */
sys('00', '读环境', (w) => {
  const f = w.facts
  return {
    out: [
      `记忆池 ${f.memFiles} 个文件（${f.memKB} KB）`,
      `日记 ${f.diaryCount} 篇，最近 ${f.lastDiary || '—'}，今天${f.hasDiaryToday ? '有' : '没有'}`,
      `台账 ${f.openTodo} 条没勾，收件箱 ${f.inboxOpen} 条没处理`,
    ],
  }
})

/* 二、起念：六个缺口源 */
sys('12a', '起念', (w) => {
  const f = w.facts
  const L = w.ledger
  const gaps = []

  if (f.openTodo > 0) gaps.push({ source: '台账到期', hard: true, count: f.openTodo, what: `${f.openTodo} 条没勾` })
  const due = Object.entries(L.thresholds || {}).filter(([, v]) => v.now >= v.at)
  for (const [what, v] of due) gaps.push({ source: '假设到阈值', hard: true, count: due.length, what: `「${what}」撞了 ${v.now} 次，到 ${v.at} 次` })
  if (f.inboxOpen > 0) gaps.push({ source: '问题攒着没问', hard: false, count: f.inboxOpen, what: `${f.inboxOpen} 条没处理` })
  if (f.queueOpen > 0) gaps.push({ source: '方向堆着没挖', hard: false, count: f.queueOpen, what: `${f.queueOpen} 个方向排着` })
  if (!f.hasDiaryToday) gaps.push({ source: '记录断更', hard: true, count: 1, what: f.lastDiary ? `今天还没记，上次 ${f.lastDiary}` : '一条日记都没有' })
  const clash = (L.clashes || []).filter((x) => !x.judged)
  if (clash.length) gaps.push({ source: '记忆撞车', hard: false, count: clash.length, what: `${clash.length} 条报过没判` })

  // 待判：做完没判的。**没人判，收口就没完成**——这条不报缺口，报的是欠着谁。
  const pend = (L.pending || []).filter((x) => !x.judged)
  const unjudged = pend.length

  // 称重：从账里取，取不到就是没称过
  for (const g of gaps) {
    const wgt = (L.weighs || {})[g.source]
    if (wgt) { g.want = wgt.want; g.cost = wgt.cost }
  }
  return {
    out: [`认出 ${gaps.length} 个缺口${unjudged ? `｜待判 ${unjudged} 条没人判` : ''}`],
    cant: unjudged ? [`${unjudged} 条做完没判——**收口没完成，得下一次翻记录的人判**`] : [],
    events: [{ type: 'gaps', gaps }, { type: 'pendingCount', n: unjudged }],
  }
})

/* 三、称重：两样缺一样就不准上场 */
sys('12b', '称重', (w, ctx) => {
  const gaps = ctx.gaps || []
  const weighed = gaps.map((g) => {
    if (!g.want && !g.cost) return { ...g, w: { ok: false, notWeighed: true } }
    if (!g.want) return { ...g, w: { ok: false, why: '只写了代价，没写想要' } }
    if (!g.cost) return { ...g, w: { ok: false, why: '只写了想要，没写代价' } }
    return { ...g, w: { ok: true } }
  })
  return { out: [`过称 ${weighed.filter((x) => x.w.ok).length}/${gaps.length}`], events: [{ type: 'weighed', weighed }] }
})

/* 四、决断：硬缺口先来，一次一件 */
sys('12c', '决断', (w, ctx) => {
  const weighed = ctx.weighed || []
  if (!weighed.length) return { out: ['没有缺口，不起念'] }
  const sorted = [...weighed].sort((a, b) => (b.hard ? 1 : 0) - (a.hard ? 1 : 0) || (b.count || 0) - (a.count || 0))
  const top = sorted[0]
  const dropped = sorted.slice(1)
  return {
    out: [`选「${top.source}」${dropped.length ? `｜放下 ${dropped.map((x) => x.source).join('、')}` : ''}`],
    events: [{ type: 'choose', top, dropped }],
  }
})

/* 五、动：能自己做的，当场做 */
sys('12d', '做', (w, ctx) => {
  const c = ctx.choose
  if (!c) return {}
  if (!c.top.w.ok) {
    if (c.top.w.notWeighed) {
      return { cant: [`「${c.top.source}」卡在称重：还没称过`], events: [{ type: 'blocked', source: c.top.source, why: '还没称过' }] }
    }
    // 称过了但不过：三种理由挑一个，**挑不出就不干，而且要落账**
    return {
      did: [`不干：${c.top.source}`],
      events: [{ type: 'refuse', source: c.top.source, reason: '价太高', why: c.top.w.why || '' }],
    }
  }
  const today = w.today
  const key = `${c.top.source}`
  if ((w.ledger.done || {})[key] === today) {
    return { cant: [`「${c.top.source}」今天已经做过`] }
  }
  // 收口：做完不算做成，**先记一条待判，等下一次翻记录的人判**。
  return {
    did: [`做了一件：${c.top.source}`],
    events: [
      { type: 'done', key, today },
      { type: 'pending', row: { source: c.top.source, what: c.top.what || '', want: c.top.want || '', cost: c.top.cost || '' } },
    ],
  }
})

/* 六、记：把这一轮的 events 落地。**只有这一层碰盘。** */
sys('99', '落地', (w, ctx) => {
  const L = w.ledger
  const ev = ctx.allEvents || []
  for (const e of ev) {
    if (e.type === 'done') L.done = { ...(L.done || {}), [e.key]: e.today }
    if (e.type === 'blocked') L.blocked = [...(L.blocked || []).filter((x) => x.source !== e.source), { at: w.now.toISOString(), source: e.source, why: e.why }]
    if (e.type === 'refuse') L.refused = [...(L.refused || []), { at: w.now.toISOString(), source: e.source, reason: e.reason, why: e.why }]
    if (e.type === 'judge') L.pending = (L.pending || []).map((x) => (x.at === e.at ? { ...x, judged: e.verdict, judgedAt: w.now.toISOString() } : x))
    if (e.type === 'unblock') L.blocked = (L.blocked || []).filter((x) => x.source !== e.source)
    if (e.type === 'pending') L.pending = [...(L.pending || []), { at: w.now.toISOString(), judged: null, ...e.row }]
  }
  L.runs = [...(L.runs || []), { at: w.now.toISOString(), n: ev.length }].slice(-50)
  return { out: [`落了 ${ev.length} 条事件`], events: [{ type: 'save', ledger: L }] }
})

/* ───────────────── tick ───────────────── */

/**
 * 跑一轮。照 Game Loop：**顺序固定，每轮都跑一遍**。
 *
 * 拿到 events 就往下传：前一个 system 交的，下一个拿去用。
 * 这就是「System 表」的意思——谁都不认识谁，只认 events。
 */
export function tick(ws, now = new Date()) {
  const world = makeWorld(ws, now)
  const ctx = { allEvents: [] }
  const results = []

  for (const s of SYSTEMS) {
    let r = {}
    try {
      r = s.run(world, ctx) || {}
    } catch (e) {
      r = { cant: [`${s.name} 抛了：${e.message}`] }
    }
    // 把 events 摊进 ctx，下一个 system 拿得到
    for (const e of r.events || []) {
      // 传下去的是**载荷**，不是整个事件壳：下一个 system 要的是 gaps，不是 {type,gaps}
      ctx[e.type] = e[e.type] !== undefined ? e[e.type] : e
      ctx.allEvents.push(e)
    }
    results.push({ id: s.id, name: s.name, did: r.did || [], out: r.out || [], cant: r.cant || [] })
  }

  // 最后一层交的 save 落到盘上（只有这里碰盘）
  const fin = ctx.save
  if (fin && fin.ledger) saveLedger(ws, fin.ledger)

  return { results, world, saveTo: ledgerPath(ws) }
}

/**
 * 判一条待判的。**这是「下一次翻记录的人」那一步**——
 * 不判，收口就永远没完成。
 */
export function judge(ws, at, verdict, why = '') {
  const L = loadLedger(ws)
  const row = (L.pending || []).find((x) => x.at === at && !x.judged)
  if (!row) return { ok: false, why: `账里没有这条待判：${at}` }
  L.pending = L.pending.map((x) => (x.at === at ? { ...x, judged: verdict, judgedWhy: why, judgedAt: new Date().toISOString() } : x))
  L.closed = [...(L.closed || []), { at: new Date().toISOString(), source: row.source, verdict, why }].slice(-100)
  saveLedger(ws, L)
  return { ok: true, row }
}

/** 人看的一行一轮。 */
export function renderTick(r) {
  const lines = []
  for (const x of r.results) {
    if (!x.did.length && !x.out.length && !x.cant.length) continue
    lines.push(`· **${x.name}**`)
    for (const o of x.out) lines.push(`  ${o}`)
    for (const d of [...x.did]) lines.push(`  ✓ ${d}`)
    for (const c of [...x.cant]) lines.push(`  ✗ ${c}`)
  }
  return lines.join('\n')
}

// —— node lib/tick.mjs [工作区] ——
if (process.argv[1] && process.argv[1].endsWith('tick.mjs')) {
  const ws = process.argv[2] || process.env.PERSONA_WS || join(process.cwd())
  const r = tick(ws)
  console.log(`一个 tick｜工作区 ${ws}`)
  console.log(renderTick(r))
  console.log(`\n  ${r.results.length} 个 system 跑完，账落 ${r.saveTo}`)
}
