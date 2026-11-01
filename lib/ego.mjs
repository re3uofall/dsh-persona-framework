/**
 * 08 自我（ego）：**接住本我的劲，跟超我协商，跟现实对账，送出去或拦下来。**
 *
 * 跟 lib/gate.mjs 的分工：
 *   gate.mjs 是**判据**——查一条话站不站得住，它不办事。
 *   这一份是**功能**——它真接住、真筛、真放、真截，截下来的还要安顿好。
 *
 * 两头都摆清楚：
 *
 * **弗洛伊德那套搬哪几样**（用得上的）：
 *   · 现实检验：这条是看见的，还是想的？——分不清就会把想当然当事实
 *   · 接住：本我要什么，先接下来，不是一上来就否
 *   · 筛：场合、来源、概念三道
 *   · 放 / 截：能出去的送出去，不能出去的**拦下来并安顿**，不是丢掉
 *   · 延迟满足：现在想要，但代价太高——先存着
 *
 * **不搬的**（过度解释，搬进来只会多一层没人查得动的名词）：
 *   · 防御机制（压抑、投射、合理化）
 *   · 无意识装置
 *   · 里比多这类
 *
 * 一句分界：**功能要有，装置不必全搬。**
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { verify, sourceOf, SCENES } from './gate.mjs'

/* ═════════ 一、接住：本我要什么，先接下来 ═════════ */

/**
 * 正文原话：「它接住本我剩下的那股劲。」
 *
 * **关键：先接，不先否。** 一上来就否，那是超我干的活，不是自我。
 *
 * 接的分三样：
 *   要的    —— 本我明说要的
 *   挡下的  —— 本我被挡回去的那半
 *   没说的  —— 本我没说出口、但劲儿还在的
 */
export function intake(gaps = [], done = {}) {
  const wants = []
  const held = []
  const unspoken = []

  for (const g of gaps) {
    const what = String(g?.what || g?.source || '')
    if (!what) continue
    // 已经做过的不再要——**接住不是重复要**
    if (done?.[g.key || what]) { held.push({ ...g, why: '这一件今天做过了' }); continue }
    // 归属不归我的，截下并说明——**这也是本我的劲，只是出不去**
    if (g.unowned) { unspoken.push({ ...g, why: `不归我：${g.why || '不是我这层的事'}` }); continue }
    wants.push(g)
  }

  return {
    did: [`接下 ${gaps.length} 条劲：要的 ${wants.length}，挡下的 ${held.length}，说不出的 ${unspoken.length}`],
    wants, held, unspoken,
    // **接住不等于都要办**——这是自我的第一道判断
    out: wants.length ? [`要的：${wants.map((x) => x.what || x.source).slice(0, 3).join('、')}`] : [],
  }
}

/* ═════════ 二、现实检验：这是看见的，还是想的 ═════════ */

/**
 * 弗洛伊德那套里，**留得下的是这一样**：现实检验（reality testing）。
 *
 * 程序里它就是一句话：**这条带得出指得回去的东西吗？**
 *
 *   看见的 —— 有落点：文件、账、原话、网址
 *   想的   —— 只有倾向，没有落点
 *
 * **分不清就按「想的」走。** 因为把想的当看见的，代价比反过来大得多。
 */
export function realityTest(item) {
  const t = String(item?.text || item?.what || item?.source || '')
  const anchors =
    (t.match(/https?:\/\/\S+/g) || []).length +
    (t.match(/\d{4}[-/年]\d{1,2}/g) || []).length +
    (t.match(/「[^」]+」/g) || []).length +
    (t.match(/[\w.-]+\.(md|mjs|js|json|py|txt)/g) || []).length +
    (/台账|收件箱|账|日记|记忆池/.test(t) ? 1 : 0)

  if (anchors >= 1) {
    return { kind: '看见的', ok: true, why: `${anchors} 个落点`, anchors }
  }
  return {
    kind: '想的',
    ok: false,
    why: '一个落点都没有——**按想的算，不按看见的算**',
    anchors: 0,
  }
}

/* ═════════ 三、筛：三道 ═════════ */

/**
 * 正文原话：场合、来源、概念。**三道都过，话才放行。**
 *
 * **先分这一条是「事」还是「话」。**
 *   事（要做的事）：有 `what` 没有 `text` —— 它不用出处，只要归我
 *   话（要说的话）：有 `text` —— 它要出处，要分事实判断
 *
 * 上一版没分，结果「写一条判断」这种待办也被要出处，被当成传闻截了。
 * **事和话混在一道筛子里，就是拿称鱼的办法称米。**
 */
export function screen(item, opts = {}) {
  const scene = opts.scene || '认真'
  const text = String(item?.what || item?.source || '')
  const fails = []

  // 事：只查归不归我
  const isDeed = !item?.text && Boolean(item?.what || item?.source)
  if (isDeed) {
    if (item?.unowned) {
      fails.push({ gate: '归属', why: `不归我：${item?.why || '不是我这层的事'}` })
    }
    return { ok: !fails.length, fails, scene, kind: '事' }
  }

  // 话：查三道
  if (scene === '公开' && /据说|听说|有人说/.test(text)) {
    fails.push({ gate: '场合', why: '公开档不许转述——**拿掉传闻还成立，才算讲清楚**' })
  }

  // 来源：**默认要出处，除非明说不必**
  // 上一版写成「是断言才查」，结果没标 assert 的全溜过去了——
  // **默认放开就是放水**，反过来才对。
  if (item?.noEvidence !== true) {
    const src = sourceOf({ kind: item?.sourceKind || item?.kind || '' })
    if (!src.inArgue) {
      fails.push({ gate: '来源', why: `只到${src.kind}——**${src.note}不进论证**` })
    }
  }

  // 概念：这话里的词是什么意思
  if (item?.term && !item?.plain) {
    fails.push({ gate: '概念', why: `「${item.term}」翻不进人话——**翻不出来说明还没想清楚**` })
  }

  return { ok: !fails.length, fails, scene, kind: '话' }
}

/* ═════════ 四、放和截：截下来的要安顿 ═════════ */

export function suppressPath(ws) {
  return join(String(ws || process.cwd()), '.persona-framework', '压下去.json')
}

function readSuppressed(ws) {
  const f = suppressPath(ws)
  if (!existsSync(f)) return []
  try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return [] }
}

/**
 * **截下来不是丢掉。**
 *
 * 正文原话：「把说不出的那点截下来。」下面没写截下来之后怎么办——
 * **我补这一条：截下要写清为什么截、什么时候能放。**
 *
 * 不写就散了；写下来下一轮还能翻出来。
 */
export function suppress(ws, item, why) {
  const f = suppressPath(ws)
  const d = dirname(f)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  const list = readSuppressed(ws)
  list.push({
    at: new Date().toISOString(),
    what: String(item?.what || item?.source || ''),
    why,
    release: item?.release || '', // 什么条件下能放出来
  })
  // 只留最近 100 条，别撑大
  writeFileSync(f, JSON.stringify(list.slice(-100), null, 2), 'utf8')
  return { kept: list.length }
}

/** 能放出去的，一条一条写清它凭什么。 */
export function release(ws, items) {
  return items.map((x) => ({
    what: String(x.what || x.source || ''),
    because: x.because || '过了三道筛',
  }))
}

/* ═════════ 五、延迟满足：现在想要，代价太高 ═════════ */

/**
 * 正文没写这一条，但**弗洛伊德那套里它是自我最正经的一件活**：
 * 现在很想，但现付不起——**不是不要，是存着**。
 *
 * 判据只有一条：**这一件的代价，现在付得起吗？**
 * 付不起就存，存的时候写清什么时候可能付得起。
 */
export function delay(item, cost = {}) {
  const canPayNow = cost.payable !== false
  if (canPayNow) return { done: false, why: '付得起，现在就办' }
  return {
    done: true,
    why: `存着：${cost.why || '现在付不起'}`,
    until: cost.until || '说不准什么时候',
  }
}

/* ═════════ 六、一次办完：自我的整套动作 ═════════ */

/**
 * 输入本我交下来的一轮，输出：出去的、截下的、存着的。
 *
 * **这一个函数就是「自我」这个功能。**
 * gate.mjs 只在第三步里被调一次——判据是它用的工具，不是它本身。
 */
export function egoStep(ws, opts = {}) {
  const scene = opts.scene || '认真'
  const gaps = Array.isArray(opts.gaps) ? opts.gaps : []
  const done = opts.done || {}

  // 一、接住
  const talked = intake(gaps, done)

  const out = []
  const released = []
  const suppressed = []
  const delayed = []

  // 二、逐条办：现实检验 → 延迟 → 筛 → 放/截
  for (const g of talked.wants) {
    // 现实的账：这是看见的，还是想的
    const real = realityTest(g)
    if (!real.ok) {
      // **想的也能说，但要标出来**
      g.assert = false
      g.sourceKind = '记忆'
    }

    // 延迟：付不起就先存
    const d = delay(g, g.cost || {})
    if (d.done) { delayed.push({ what: g.what || g.source, why: d.why, until: d.until }); continue }

    // 筛
    const s = screen(g, { scene })
    if (!s.ok) {
      const why = s.fails.map((f) => f.why).join('；')
      suppress(ws, g, why)
      suppressed.push({ what: g.what || g.source, why })
      continue
    }

    released.push(g)
  }

  // 说不出的那些也要安顿
  for (const g of talked.unspoken) {
    suppress(ws, g, g.why)
    suppressed.push({ what: g.what || g.source, why: g.why })
  }

  // 三、汇总
  if (talked.did.length) out.push(...talked.did)
  if (released.length) out.push(`放出去 ${released.length} 条：${released.map((x) => x.what || x.source).slice(0, 3).join('、')}`)
  if (suppressed.length) out.push(`截下 ${suppressed.length} 条（都写进「压下去」了，不是丢掉）`)
  if (delayed.length) out.push(`存着 ${delayed.length} 条（付不起，不是不要）`)

  return {
    did: talked.did,
    out,
    released,
    suppressed,
    delayed,
    cant: suppressed.map((s) => s.why),
  }
}
