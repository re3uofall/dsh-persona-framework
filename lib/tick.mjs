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
import { introspect, veto } from './metacog.mjs'
import { gate } from './gate.mjs'
import { egoStep2 } from './ego.mjs'
import { selfRecognize } from './selfref.mjs'
import { coordinate } from './coord.mjs'

/* ───────────────── world ───────────────── */

/**
 * world 就是这一轮的手上：账 + 三个读数（记忆、记录、时间）。
 * **system 只认这个，不认路径**。换文件位置，system 一行都不用改。
 */
export function makeWorld(ws, now = new Date(), opts = {}) {
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
    hint: String(opts.hint || ''),
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
      // **逐条读出来**，不是只数几条——归属判断要看那一条到底是什么。
      todos: (read(join(root, '台账.md')).match(/^\s*[-*]\s*\[ \]\s*(.+)$/gm) || [])
        .map((l) => l.replace(/^\s*[-*]\s*\[ \]\s*/, '').trim()),
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


/* ═════════ 档位：不是省不省，是拿多少碗 ═════════ */

/**
 * 自主性分四档。**每一档都真跑，只是跑多少不同。**
 *
 * 为什么要有档：一个 tick 每轮都跑，它烧的是 token，也是时间。
 * 不列清楚，人就只能「全开」或「全关」——那两头都是浪费。
 *
 * 数字是这一档的目标，不是保证：
 *   inject   —— 注入里最多放多少字（超了截断）
 *   systems  —— 跑哪几个 system（表里没有就不跑）
 *   recall   —— 捞记忆最多浮上来几条（0 = 不捞）
 *   scan     —— 记忆池最多扫几层
 *   reflect  —— 功能自反开不开
 */
export const LEVELS = {
  off: {
    label: '关',
    inject: 0, systems: [], recall: 0, scan: 0, reflect: false,
    token: '0', time: '0 ms',
    why: '一整个 tick 都不跑。只剩人格和框架本身。',
  },
  low: {
    label: '低',
    inject: 380, systems: ['00', '12a', '99'], recall: 0, scan: 0, reflect: false,
    token: '~150–300', time: '~5 ms',
    why: '只读环境、起念、落地。认得出手上有什么，不捞记忆、不称重、不做。',
  },
  mid: {
    label: '中',
    inject: 1500, systems: ['00', '01', '12a', '12b', '12c', '12d', '12e', '12h0', '12h', '99'], recall: 3, scan: 2, reflect: false,
    token: '~500–900', time: '~20 ms',
    why: '默认。十一步：起念→称重→决断→做→自我监控→自我识别→自我→协调→落地。捞 3 条记忆。',
  },
  high: {
    label: '高',
    inject: 2600, systems: ['00', '01', '12a', '12b', '12c', '12d', '12e', '12f', '12g', '12h0', '12h', '99'], recall: 5, scan: 3, reflect: true,
    token: '~1200–2200', time: '~40 ms',
    why: '六步全跑 + 捞 5 条 + 扫三层 + 功能自反（看得见每条 system 在干什么）。调试和较真时用。',
  },
}

/** 拿一档；给不认识的就退回 mid。 */
export function levelOf(name) {
  return LEVELS[String(name || '').trim()] || LEVELS.mid
}

/** 全部档位的对照，给人看。 */
export function renderLevels() {
  const rows = Object.entries(LEVELS).map(([k, v]) => {
    return `- **${v.label}**（${k}）｜${v.token} token｜${v.time}｜${v.systems.length} 个 system｜捞 ${v.recall} 条｜扫 ${v.scan} 层｜注入 ≤${v.inject} 字｜自反 ${v.reflect ? '开' : '关'}\n  ${v.why}`
  })
  return ['**自主性分档**（每档都真跑，只是跑多少不同）：', '', ...rows].join('\n')
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

/* 一点五、捞：按语境真去记忆池里捞，不是报个数 */
sys('01', '捞记忆', (w) => {
  const q = String(w.hint || '').trim()
  if (!q) {
    return {
      out: ['没有语境可捞——**没有 query，就不假装捞过**'],
      cant: ['这一轮没给语境，记忆不会自己浮上来'],
    }
  }

  // 真去翻：拆词、逐文件找、只留撞上两次以上的（撞一次的多半是巧合）
  const terms = q.split(/[\s,，。？?！!、；;：:]+/).map((x) => x.trim()).filter((x) => x.length >= 2).slice(0, 6)
  if (!terms.length) return { out: ['语境里没有可捞的词'], cant: [] }

  const root = join(w.ws, 'persona-ai', 'knowledge')
  const hits = []
  const walk = (d, depth) => {
    if (depth > 3) return
    let names = []
    try { names = readdirSync(d) } catch { return }
    for (const n of names) {
      const p = join(d, n)
      let isDir = false
      try { readdirSync(p); isDir = true } catch { isDir = false }
      if (isDir) { walk(p, depth + 1); continue }
      if (!n.endsWith('.md')) continue
      let body = ''
      try { body = readFileSync(p, 'utf8') } catch { continue }
      let score = 0
      for (const t of terms) score += (body.split(t).length - 1)
      if (score < 2) continue

      // **按行找最相关的那一段**，不是拿词第一次出现的位置——
      // 那永远落在文件头那句「从 ~/.dsh/sessions/ 导的」，等于没捞。
      let best = { line: '', hit: 0 }
      for (const line of body.split('\n')) {
        const t2 = line.trim()
        if (t2.length < 12 || t2.length > 400) continue
        let hit = 0
        for (const t of terms) if (t2.includes(t)) hit++
        if (hit > best.hit) best = { line: t2, hit }
      }
      if (!best.line) continue
      // 撞上的是「刚才那句话本身」不算浮现——那是回声，不是记忆。
      if (best.line.includes(q.slice(0, 20))) continue
      hits.push({ file: n, score, snip: best.line, lineHit: best.hit })
    }
  }
  walk(root, 0)
  hits.sort((a, b) => (b.lineHit || 0) - (a.lineHit || 0) || b.score - a.score)

  const top = hits.slice(0, w.level?.recall || 5)
  if (!top.length) {
    return { out: [`捞了「${terms.join('、')}」——**一条都没浮上来，这是空的，不是「没有记忆」**`], cant: [] }
  }
  return {
    out: [`捞「${terms.join('、')}」，浮上来 ${top.length} 条：`],
    did: top.map((h) => `${h.file}（一行撞 ${h.lineHit} 个词）｜${h.snip.slice(0, 90)}`),
  }
})

/* 二、起念：六个缺口源 */
sys('12a', '起念', (w) => {
  const f = w.facts
  const L = w.ledger
  const gaps = []

  // 对话里刚说的：**这一轮的现实就是人刚说的那句**。
  //
  // 上一版起念只翻账——台账、阈值、收件箱、日记、撞车。
  // 账一空缺口就是 0，后面「自我」整条链接到的永远是空数组。
  // **料进不来，功能就等于没跑。**
  if (String(w.hint || '').trim()) {
    gaps.push({ source: '对话里刚说的', hard: false, count: 1, what: String(w.hint).trim() })
  }

  // 台账：**一条一个念**，带原文。这样「这一条归谁」才判得动。
  for (const t of (f.todos || [])) {
    gaps.push({ source: '台账到期', hard: true, count: 1, what: t, item: t })
  }
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
  // **挂到 world 上**——后面的层（尤其 12h 自我）要接住这批劲。
  // 上一版只放在 events 里，12h 读到的永远是空数组。
  w.gaps = gaps
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

  // **决断要问三样，不是一样。**
  // 第一问是「归谁」——这一件该我做吗？
  // 上一版只问「做哪一件」，于是「顺手」就成了决断：手边能加就加。
  // 我人格里写着「工具人不是身体」，转过身把插件当成能管一切的身体。
  // 这一问就是拦那个的：**归属不过，不做，哪怕它排在第一名。**
  const OWNERS = [
    ['重启插件', /重启|reload|重载/],
    ['装卸插件', /装插件|卸插件|enable|disable/],
    ['改别人的文件', /改.*别人的|别人的文件/],
    ['替别人做主', /替.*决定|安排.*人生/],
  ]
  const own = (item) => {
    const hay = `${item.source || ''} ${item.what || ''} ${item.item || ''} ${item.name || ''}`
    for (const [what, re] of OWNERS) {
      if (re.test(hay)) return { ok: false, what }
    }
    return { ok: true }
  }

  const sorted = [...weighed].sort((a, b) => (b.hard ? 1 : 0) - (a.hard ? 1 : 0) || (b.count || 0) - (a.count || 0))
  const notMine = []
  const mine = []
  for (const x of sorted) {
    const o = own(x)
    if (o.ok) mine.push(x)
    else notMine.push({ ...x, ownedBy: o.what })
  }

  const out = []
  for (const x of notMine) out.push(`不归我：${x.source}（${x.ownedBy}——那是宿主／别人的事）`)
  if (!mine.length) {
    return {
      out: [...out, '没有一件归我——**归属不过，一件不做**'],
      cant: notMine.map((x) => `${x.source} 归${x.ownedBy}，不是我的活`),
      events: [{ type: 'notMine', items: notMine }],
    }
  }

  const top = mine[0]
  const dropped = mine.slice(1)
  out.push(`选「${top.what || top.source}」${dropped.length ? `｜放下 ${dropped.map((x) => x.what || x.source).join('、')}` : ''}`)
  return {
    out,
    events: [{ type: 'choose', top, dropped, notMine }],
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


/* ═════════ 正文那三种能力：12e / 12f / 12g ═════════ */

/* 六、自我监控：看着自己在做什么、做到哪一步 */
sys('12e', '自我监控', (w, ctx) => {
  const t0 = w._t0 || 0
  const ms = t0 ? Date.now() - t0 : 0
  const r = introspect(w.ws, { ms })
  const m = r.monitor
  return {
    out: [...m.did, ...(m.signals.length ? [`**信号超线**：${m.why}`] : [])],
    cant: m.cant,
    events: [{ type: 'monitor', verdict: m.verdict, ms }],
  }
})

/* 七、元认知：对自己知道什么、知道多少 */
sys('12f', '元认知', (w, ctx) => {
  // 拿这一轮决断的那一条去分档——**它是查到的、推的、还是猜的**
  const top = ctx.choose?.top
  const claims = top ? [top.what || top.source] : []
  const k = introspect(w.ws, { claims }).metacog
  return {
    out: k.out,
    cant: k.cant,
  }
})

/* 八、二阶：想成为什么样的人——**它管一阶** */
sys('12g', '二阶', (w, ctx) => {
  const top = ctx.choose?.top
  if (!top) return { out: ['这一轮没有要做的，二阶不用说话'] }
  const r = veto(w.ws, top)
  if (!r.ok) {
    return {
      out: [r.why],
      cant: r.cant,
      events: [{ type: 'veto', source: top.source, why: r.why }],
    }
  }
  return { out: [r.why] }
})



/* 八点五、自我识别：**在人的话里认出「这是在说我」** */
sys('12h0', '自我识别', (w) => {
  const r = selfRecognize(w.hint)
  return {
    did: r.did,
    out: r.out,
    cant: r.cant,
    // **认出来的句子挂到 world 上**——12h 自我要拿它去过筛
    events: [{ type: 'selfref', n: r.mine.length }],
    _mine: r.mine,
  }
})

/* 九、自我：**接住→现实检验→延迟→筛→放/截**（08 的功能，不是判据） */
sys('12h', '自我', (w, ctx) => {
  const r = egoStep2(w.ws, {
    gaps: w.gaps || [],
    done: w.done || {},
    // 认出「在说我」的那几句也当劲摆进去——**它们是要过筛的话**
    aboutMe: (w._mine || []).map((m) => ({ text: m.text, what: m.text })),
    scene: w.level?.label === '低' ? '日常' : '认真',
  })
  return {
    did: r.did,
    out: r.out,
    cant: r.cant,
    events: [{ type: 'ego', released: r.released.length, suppressed: r.suppressed.length, delayed: r.delayed.length, bargained: (r.bargained || []).length }],
  }
})


/* 十一、记：把这一轮的 events 落地。**只有这一层碰盘。** */
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
export function tick(ws, now = new Date(), opts = {}) {
  const world = makeWorld(ws, now, opts)
  world._t0 = Date.now()  // 自我监控要它
  // 档位：跑哪几个 system、捞几条、扫几层
  const lv = levelOf(opts.level)
  world.level = lv
  const want = lv.systems.length ? new Set(lv.systems) : null
  // 功能自反：**默认关**。打开就把「每个 system 跑了什么」也交出去——
  // 不是多干活，是多报一层。关着的时候只交结果，跟人的意识一样。
  const reflect = opts.reflect === true || lv.reflect === true
  const ctx = { allEvents: [] }
  const results = []

  for (const s of SYSTEMS) {
    // 档位不要的就不跑——**省的是这一步，不是结果**：没跑就是没跑，不假装。
    if (want && !want.has(s.id)) continue
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
    results.push({
      id: s.id,
      name: s.name,
      did: r.did || [],
      out: r.out || [],
      cant: r.cant || [],
      // 自反开着才填：这一条 system 交了几条、出了几个事件
      ran: reflect ? { events: (r.events || []).length, lines: (r.out || []).length + (r.did || []).length + (r.cant || []).length } : undefined,
    })
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


/**
 * 这一轮的语境从哪来：**从会话记录里读最后一条师父说的话**。
 *
 * 注入发生在用户消息之前，所以拿不到「这一句」——只能拿上一句。
 * 拿不到就返回空，**不假装有语境**。
 */
export function lastHint(ws) {
  const dir = join(String(ws || process.cwd()), 'persona-ai', 'knowledge', 'session')
  let files = []
  try { files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort() } catch { return '' }
  for (const f of files.slice(-2).reverse()) {
    let body = ''
    try { body = readFileSync(join(dir, f), 'utf8') } catch { continue }
    const lines = body.split('\n').filter((l) => l.startsWith('师父：'))
    if (!lines.length) continue
    const last = lines[lines.length - 1].replace(/^师父：/, '').trim()
    if (last.length >= 4) return last.slice(0, 200)
  }
  return ''
}

/**
 * 功能自反：打开时的仪表盘——**看它正在跑什么**。
 *
 * 不是把每个 system 的产出再抄一遍（那是重复），是报**跑没跑、交了几条、是不是静的**。
 * 默认关：这一层信息量很大，全灌进意识就淹了。
 */
export function renderFuncReflect(r) {
  if (!r.results.some((x) => x.ran)) return ''
  const lines = ['**功能自反（开着）**：这一轮跑了什么']
  for (const x of r.results) {
    const ran = x.ran || { events: 0, lines: 0 }
    const tag = x.cant.length ? '卡' : x.did.length ? '动' : '静'
    lines.push(`· ${x.id} ${x.name}｜${tag}｜事件 ${ran.events} 条｜交 ${ran.lines} 行`)
  }
  lines.push('', `一共 ${r.results.length} 个 system。**关掉这一层，注入里就只看得到结果。**`)
  return lines.join('\n')
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
  const r = tick(ws, new Date(), { hint: process.argv[3] || '', reflect: process.argv.includes('--reflect') })
  console.log(`一个 tick｜工作区 ${ws}`)
  console.log(renderTick(r))
  console.log(`\n  ${r.results.length} 个 system 跑完，账落 ${r.saveTo}`)
}
