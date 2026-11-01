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

import { organize, summarize as summarizeOrg } from './tissue.mjs'
import { openCellBook, saveCellBook, overrideFor } from './metacell.mjs'
import { openAdjust, saveAdjust, weightOf, assimilate, dissimilate, energy, shouldReview, feedback, adjustStep } from './adjust.mjs'
import { classifyAll, classify, mustClassify } from './metacell.mjs'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { load as loadLedger, save as saveLedger, ledgerPath } from './ledger.mjs'
import { introspect, veto } from './metacog.mjs'
import { gate } from './gate.mjs'
import { egoStep2 } from './ego.mjs'
import { superegoStep } from './superego.mjs'
import { negativeStep } from './negative.mjs'
import { openForget, orderByForget } from './forget.mjs'
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
    // **`systems: []` 会被 `[].length` 读成「不过滤」而全跑**——写个显式标记，
    // 让「关」真的是关，不是被默认值顶开。
    still: true,
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
    inject: 1500, systems: ['00', '01', '12a', '12b', '12c', '12d', '12e', '12h0', '12h', '12i', '12j', '99'], recall: 3, scan: 2, reflect: false,
    token: '~500–900', time: '~20 ms',
    why: '默认。十二步：起念→称重→决断→做→自我监控→自我识别→自我→超我→落地。捞 3 条记忆。',
  },
  high: {
    label: '高',
    inject: 2600, systems: ['00', '01', '12a', '12b', '12c', '12d', '12e', '12f', '12g', '12h0', '12h', '12i', '12j', '99'], recall: 5, scan: 3, reflect: true,
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

  // **忘过的排后面。** 不是删掉——删是抹；忘是它还在，只是不主动浮上来。
  const fb = openForget(w.ws)
  const top = orderByForget(fb, hits).slice(0, w.level?.recall || 5)
  if (!top.length) {
    return { out: [`捞了「${terms.join('、')}」——**一条都没浮上来，这是空的，不是「没有记忆」**`], cant: [] }
  }
  return {
    out: [`捞「${terms.join('、')}」，浮上来 ${top.length} 条：`],
    did: top.map((h) => `${h.file}（一行撞 ${h.lineHit} 个词）｜${h.snip.slice(0, 90)}`),
  }
})

/* 二、起念：四个缺口源
 *
 * **「该」从哪来，每一个都得说得出：**
 *   对话里刚说的 —— 人刚开口，那就是这一轮的现实
 *   台账到期     —— 自己记下的、到日子了
 *   假设到阈值   —— 自己定过「撞够几次就动手」
 *   问题／方向   —— 已经躺在收件箱和队列里的
 *   记忆撞车     —— 两条记录互相打架，得判
 *
 * **说不出来源的，不许算缺口。** 写死一条「该写日记」，那是替它定规矩。
 */
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
    const said = String(w.hint).trim()
    // **带上 text**：这是「话」，不是「事」。
    // 不带的话，筛子会把它当待办，只查归属、不查来源——人说的话就这么绕过了三道闸。
    gaps.push({ source: '对话里刚说的', hard: false, count: 1, what: said, text: said })
  }

  // 台账：**一条一个念**，带原文。这样「这一条归谁」才判得动。
  for (const t of (f.todos || [])) {
    gaps.push({ source: '台账到期', hard: true, count: 1, what: t, item: t })
  }
  const due = Object.entries(L.thresholds || {}).filter(([, v]) => v.now >= v.at)
  for (const [what, v] of due) gaps.push({ source: '假设到阈值', hard: true, count: due.length, what: `「${what}」撞了 ${v.now} 次，到 ${v.at} 次` })
  if (f.inboxOpen > 0) gaps.push({ source: '问题攒着没问', hard: false, count: f.inboxOpen, what: `${f.inboxOpen} 条没处理` })
  if (f.queueOpen > 0) gaps.push({ source: '方向堆着没挖', hard: false, count: f.queueOpen, what: `${f.queueOpen} 个方向排着` })
  // **「今天没日记」这条删了。**
  //
  // 人格文件写着：「日记不用每天写，也不用凑数。空着比凑数强。」
  // 代码却把它算成硬缺口——**那是替它定了一条它自己说不用的规矩。**
  //
  // 这一条删掉，不是「不管日记」，是**「该不该写」不由这层定**。
  // 想写的时候人会写；不想写，不算欠账。
  const clash = (L.clashes || []).filter((x) => !x.judged)
  if (clash.length) gaps.push({ source: '记忆撞车', hard: false, count: clash.length, what: `${clash.length} 条报过没判` })

  // 待判：做完没判的。**没人判，收口就没完成**——这条不报缺口，报的是欠着谁。
  const pend = (L.pending || []).filter((x) => !x.judged)
  const unjudged = pend.length

  // ── 过元胞：**没由头的挡在门外** ──
  //
  // 元胞按来源判，不按语感判。它只做一件事：给每条归个类。
  // 归出来的结论**不给人格看**，只给下面的层用。
  const cellBook = openCellBook(w.ws || '.')
  const cells = classifyAll(gaps.map((g) => ({
    said: g.source === '对话里刚说的' ? g.what : undefined,
    todo: g.source === '台账到期' ? g.what : undefined,
    clash: g.source === '记忆撞车' ? g.what : undefined,
    want: g.want,
    cost: g.cost,
    _raw: g,
  })), cellBook)
  saveCellBook(cellBook)
  // 留下来的续上原来的料；挡下的只计数，不往下传
  const kept = cells.kept.map((c) => ({ ...c._raw, _cell: c._cell }))
  const dropped = cells.dropped.map((c) => c._raw)

  // 称重：从账里取，取不到就是没称过
  for (const g of kept) {
    const wgt = (L.weighs || {})[g.source]
    if (wgt) { g.want = wgt.want; g.cost = wgt.cost }
  }
  // ── 组织：**看出一件事被说了几遍** ──
  //
  // 元胞分完，会有同一件被说两遍的。不并回去，功能层就办两遍。
  // **并了不删**：`gaps` 还是原样，另外挂一份分组，给下面用。
  const org = organize(kept)
  w.groups = org.groups
  // **挂到 world 上**——后面的层（尤其 12h 自我）要接住这批劲。
  // 上一版只放在 events 里，12h 读到的永远是空数组。
  w.gaps = kept
  w.gapsDropped = dropped

  return {
    out: [`认出 ${kept.length} 个缺口${dropped.length ? `｜挡下 ${dropped.length} 条没由头的` : ''}${org.groups.length ? `｜其中 ${org.groups.length} 件是重复说的` : ''}${unjudged ? `｜待判 ${unjudged} 条没人判` : ''}`],
    cant: unjudged ? [`${unjudged} 条做完没判——**收口没完成，得下一次翻记录的人判**`] : [],
    events: [{ type: 'gaps', gaps: kept }, { type: 'dropped', dropped }, { type: 'pendingCount', n: unjudged }],
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
/**
 * 排先后。**单独一个函数，是为了它可测**——埋在 `12c` 里就只能靠"看起来变了"。
 *
 * 三层，顺序不许倒：
 *   一、硬的先走（到期、撞阈值）；权重**压不过硬**
 *   二、同一层看权重（调节层改的就是它）
 *   三、还平就看提过几遍
 *
 * 权重压不过硬，是有意的：硬的是「过线了」，权重是「我更想先做它」。
 * 让权重压过硬的，等于用偏好改期限。
 */
export function rankGaps(weighed, adjBook) {
  const wt = (x) => {
    try {
      return weightOf(adjBook, x.source) * weightOf(adjBook, x.what || '')
    } catch { return 1 }
  }
  return [...(weighed || [])].sort((a, b) =>
    (b.hard ? 1 : 0) - (a.hard ? 1 : 0)
    || wt(b) - wt(a)
    || (b.count || 0) - (a.count || 0))
}

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

  const sorted = rankGaps(weighed, openAdjust(w.ws || '.'))
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
    // **判过的挂到 world 上**——12j 拿它去跟旧账对。不给字，只给下一个 system。
    _judged: r.judged || [],
  }
})

/* 十、超我：**标的三样齐不齐、能不能改口、有没有拿标量人**（09 的功能）
 *
 * 料从两个地方来：
 *   一、缺口里明说是「标」的（带 goal 字段）——那是要记的
 *   二、台账里的每一条——那是「欠着的」，逐条问三样齐不齐
 *
 * **绝大多数会被退回去。** 退回不是坏，是它的正事：
 * 缺放弃条件的「目标」留着就会变成神像——供着，不敢碰，也不敢扔。
 */
sys('12i', '超我', (w, ctx) => {
  // 标：缺口里带 goal 的 + 台账条目（台账条目通常缺三样，会被退回并说缺哪条）
  const goals = []
  for (const g of (w.gaps || [])) {
    if (g.goal) goals.push({ what: g.what, ...g.goal })
  }
  // **台账在 facts 里，不在 ledger 里。** 上一版读错地方，收进来永远是空的。
  for (const t of (w.facts?.todos || [])) {
    goals.push({ what: typeof t === 'string' ? t : t?.what, source: '欠下的' })
  }

  // 禁区：缺口里带 ideal 且明说「达成就不能改口」的
  const ideals = []
  for (const g of (w.gaps || [])) {
    if (g.ideal) ideals.push({ what: g.what, ...g.ideal })
  }

  const r = superegoStep(w.ws, { goals, ideals })

  // **退回的要说出来**：退回不说缺哪条，等于没退
  const out = [...r.out]
  if (r.refused.length) {
    const head = r.refused.slice(0, 2).map((x) => `「${x.what}」${x.why}`).join('；')
    out.push(`退回 ${r.refused.length} 条：${head}${r.refused.length > 2 ? '…' : ''}`)
  }

  return {
    did: [],
    out,
    cant: r.cant,
    events: [{ type: 'superego', 标的: r.stats.标的, 禁区: r.stats.禁区, 量人: r.stats.量人, 退回: r.refused.length }],
    _superego: r,
  }
})


/* 十一、负面：**把「对不上」记下来**（22 残余 / R21 违和感）
 *
 * 它记不了「我变了」——那要靠感觉，程序没有。
 * 能记的只有一条：**这一条和之前那条对不上。**
 *
 * 只自动判「不融贯」（同键不同结论）和「非同一」（同标换了来源）。
 * 其余三类要人判，**不替它编**。
 *
 * **跑完不吭声**：对上的记进 对不上.json，一个字都不往外交。
 */
sys('12j', '负面', (w, ctx) => {
  const r = negativeStep(w.ws, {
    judged: w._judged || [],
    goals: (w._superego?.claimed || []).map((x) => ({ what: x, source: '' })),
  })
  return {
    did: [],
    out: [],
    cant: [],
    events: [{ type: 'negative', found: r.found, recorded: r.recorded, total: r.total }],
  }
})

/* 十二、记：把这一轮的 events 落地。**只有这一层碰盘。** */
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
  const want = lv.still ? new Set() : (lv.systems.length ? new Set(lv.systems) : null)
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

  // ── 调节：**它不挂在任何一步上，挂在这一轮的出口** ──
  //
  // 元胞、组织、功能三层各由自己的步骤跑；调节层不是一步，是一圈回看。
  // 挂在 12a／12e／99 上，换个档位、换条流程就漏了；挂在这儿，
  // 跑几个 system 都是同一圈——**它管的是「这一轮」，不是「哪一步」**。
  // **关档连调节都不跑**——「关」就是关，不留一条缝。
  const adjust = { sampled: [], said: [], wrote: false }
  try {
    if (lv.still) throw new Error('off')
    const ab = openAdjust(ws)
    const ev = ctx.allEvents

    // 同化 / 异化：这一轮收进来多少、挡出去多少
    const gaps = ev.find((e) => e.type === 'gaps')
    const dropped = ev.find((e) => e.type === 'dropped')
    if (gaps && Array.isArray(gaps.gaps) && gaps.gaps.length) {
      assimilate(ab, '缺口', gaps.gaps.length)
    }
    if (dropped && Array.isArray(dropped.dropped)) {
      for (const d of dropped.dropped.slice(0, 20)) {
        dissimilate(ab, `${d.source || ''}/${d.what || d.item || ''}`.slice(0, 60), '没由头')
      }
    }

    // 抽样复审：**不替人判，只挑出来**
    if (gaps && Array.isArray(gaps.gaps)) {
      for (const g of gaps.gaps) {
        const k = g.what || g.source || ''
        if (k && shouldReview(ab, k)) adjust.sampled.push(k)
      }
    }

    // 反馈：卡住或不干就推远，没有就往 1 拉
    const ok = !ev.some((e) => e.type === 'blocked' || e.type === 'refuse')
    feedback(ab, ok ? '这一轮' : '出岔子', ok)

    // 能量：这一轮用了多少
    const total = Number((ab.cfg.budget && ab.cfg.budget.total) || 0) || 100
    energy(ab, Math.max(0, total - ev.length), total)

    saveAdjust(ab)
    adjust.said = adjustStep(ws).out
    adjust.wrote = true
  } catch { /* 调不动就不调，不编 */ }

  // 调节层说的那句，作为一条结果交出去——**它跟哪一步跑的无关**
  if (adjust.said.length || adjust.sampled.length) {
    results.push({
      id: '88',
      name: '调节',
      did: [],
      out: [...adjust.said, ...(adjust.sampled.length ? [`抽到 ${adjust.sampled.length} 条该复审：${adjust.sampled.slice(0, 3).join('、')}`] : [])],
      cant: [],
    })
  }

  return { results, world, adjust, saveTo: ledgerPath(ws) }
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
