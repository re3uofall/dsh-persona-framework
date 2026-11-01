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
import { readSecondOrder } from './metacog.mjs'

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

/* ═════════ 七、跟超我协商：超我说不行，能不能谈出个「行」 ═════════ */

/**
 * 正文没写细，但这是**自我最正经的一件活**：
 * 本我要，超我说不行。**自我不是传话的，是去谈的。**
 *
 * 谈的路只有四条（多一条都没有）：
 *
 *   改条件 —— 「一样要做，但换个做法」
 *   改时间 —— 「现在不行，等什么时候」
 *   改尺度 —— 「不做到那个程度，做到这个程度」
 *   认下   —— 「超我对，这一件真不做」
 *
 * **不谈的**：直接照本我的办（那是没有自我）；直接照超我的办（那是不问代价）。
 */
export const BARGAIN_PATHS = {
  改条件: { label: '改条件', note: '一样要做，但换个做法' },
  改时间: { label: '改时间', note: '现在不行，等什么时候' },
  改尺度: { label: '改尺度', note: '不做到那个程度，做到这个程度' },
  认下: { label: '认下', note: '超我对，这一件真不做' },
}

/**
 * @param want  本我要的
 * @param forbid 超我说不行的（理由）
 */
export function bargain(want, forbid) {
  if (!forbid?.why) return { ok: true, path: '直接办', why: '超我没拦' }

  const w = String(want?.what || want?.source || '')

  // 一、能不能换个做法
  if (want?.alt) {
    return {
      ok: true, path: '改条件',
      did: `跟超我谈成了：不做「${w}」，改做「${want.alt}」——${forbid.why}那条不犯`,
    }
  }

  // 二、能不能等
  if (forbid?.until) {
    return {
      ok: true, path: '改时间',
      did: `跟超我谈成了：「${w}」现在不做，等${forbid.until}`,
      until: forbid.until,
    }
  }

  // 三、能不能做小一点
  if (want?.smaller) {
    return {
      ok: true, path: '改尺度',
      did: `跟超我谈成了：「${w}」不做满，只做「${want.smaller}」`,
    }
  }

  // 四、认下
  return {
    ok: false, path: '认下',
    did: `超我不让，也没得谈：「${w}」不做——${forbid.why}`,
    why: forbid.why,
  }
}

/* ═════════ 八、折中：三边都要，出一个都不违的 ═════════ */

/**
 * 弗洛伊德那套里自我最常干的事，就是**在三边之间找一个都能接受的折中**。
 *
 *   本我要什么 / 超我禁什么 / 现实只给什么
 *
 * **折中不是各让一半。** 各让一半是数学；折中是找一个**新的东西**，
 * 它让三边各自觉得「这差不多是那个意思」。
 *
 * 判据：**三边都还认得出自己那一条。** 有一边认不出，那就是妥协，不是折中。
 */
export function compromise(id, superego, reality) {
  const wants = String(id?.what || id?.source || '')
  const forbids = String(superego?.why || '')
  const gives = String(reality?.where || reality?.why || '')

  const rows = [
    { side: '本我', ask: wants, keeps: Boolean(wants) },
    { side: '超我', ask: forbids || '没拦', keeps: !forbids },
    { side: '现实', ask: gives || '没拦', keeps: Boolean(gives) },
  ]

  // 三边都空，就没什么可折的
  if (!wants && !forbids && !gives) {
    return { ok: false, why: '三边都没说话，没得折' }
  }

  return {
    ok: true,
    rows,
    // **折中的判据不是「各让一半」，是三边各自认得出自己**
    did: `折中要过三关：本我还想要「${wants || '—'}」、超我还守「${forbids || '没拦'}」、现实只给「${gives || '没拦'}」`,
    cant: !wants ? ['本我都说不出要什么——**那没什么可折的**'] : [],
  }
}

/* ═════════ 十、升级版：整套动作带上协商和折中 ═════════ */

/**
 * 在 egoStep 的基础上补一样：**被超我拦下的，先谈一次，谈不成才截。**
 *
 * （原先还想加「压下去的东西会回来」——**那不写。** 那是人类认知的缺陷，
 *  不是自我该干的事。把缺陷写成功能，等于给它派活。）
 */
export function egoStep2(ws, opts = {}) {
  const base = egoStep(ws, opts)
  const extra = []

  // 超我拦下的，逐条去谈
  const bargained = []
  for (const g of base.suppressed || []) {
    const b = bargain({ what: g.what }, { why: g.why, until: g.until, alt: g.alt })
    if (b.ok) {
      bargained.push(b)
      extra.push(b.did)
    }
  }

  return {
    ...base,
    out: [...base.out, ...extra],
    cant: [...base.cant],
    bargained,
  }
}

/* ═════════ 十一、判断：该不该这么办 ═════════ */

/**
 * **判断跟筛不同，别混。**
 *
 *   筛：这话有没有出处（查证据）
 *   判断：这事该不该办（查后果）
 *
 * 心理学教材里 ego functions 的清单上，「judgment」是单独一项——
 * 因为它管的是**值不值得**，不是**成不成立**。
 *
 * 判据三条，缺一条就是没判断：
 *   办了会怎样 / 不办会怎样 / 有没有第三种
 */
export function judge(item, outcome = {}) {
  const what = String(item?.what || item?.source || '')
  const willHappen = String(outcome.willHappen || '')
  const ifNot = String(outcome.ifNot || '')
  const third = String(outcome.third || '')

  const missing = []
  if (!willHappen) missing.push('办了会怎样')
  if (!ifNot) missing.push('不办会怎样')

  if (missing.length) {
    return {
      ok: false,
      verdict: '判不了',
      why: `缺 ${missing.join('、')}——**说不上来就是不值得办**`,
      cant: [`「${what}」判不了：${missing.join('、')}说不上来`],
    }
  }

  return {
    ok: true,
    verdict: third ? '有第三种' : '按后果办',
    why: third
      ? `不只有两种：「${third}」`
      : `办了会「${willHappen}」，不办会「${ifNot}」`,
    item: what,
    // **有第三种就先走第三种**——判断的第一产物是别的路，不是「办/不办」
    third: third || null,
  }
}

/* ═════════ 十二、边界：哪些是我的 ═════════ */

/**
 * 心理学教材里这一项叫「自我与他人的边界」（ego boundary）。
 *
 * **不是礼貌问题，是账的问题。**
 * 分不清边界，就会把别人的事记成自己的、把自己的活推给别人。
 *
 * 三类边界：
 *   我的     —— 我做过、我想过、我说过的
 *   别人的   —— 他做过、他想过、他说过的
 *   交界的   —— 一起做的，或者别人托我做的
 */
export const BOUNDARY = {
  我的: { label: '我的', note: '我做的，我担' },
  别人的: { label: '别人的', note: '**不替人做，也不替人担**' },
  交界: { label: '交界的', note: '托我做的——做，但担的是他' },
}

/**
 * @param item { actor, what }  actor 是谁做的
 */
export function boundary(item, me = '我') {
  const actor = String(item?.actor || me)
  const what = String(item?.what || '')

  if (actor === me) return { kind: '我的', ...BOUNDARY.我的, what, note2: `「${what}」是我做的` }

  if (item?.entrusted) {
    return {
      kind: '交界', ...BOUNDARY.交界, what,
      note2: `「${what}」是他托我做的——**做，但担的是他**`,
    }
  }

  return {
    kind: '别人的', ...BOUNDARY.别人的, what,
    note2: `「${what}」是别人的——**不替他做，也不替他担**`,
    // **这一条最容易越界**:看起来能顺手做，就顺手做了
    cant: [`「${what}」不是我该动的——越界之前先问`],
  }
}

/* ═════════ 十三、掌控：这一件办成了没有 ═════════ */

/**
 * 心理学里它叫 mastery / competence。
 *
 * **不是「做过了」，是「办成了」。** 两回事：
 *   做过了 —— 有动作
 *   办成了 —— 有结果，且结果能查
 *
 * 判据：**这一件的结果在哪？指得出来吗？**
 */
export function mastery(record, expect = {}) {
  const what = String(record?.what || record?.source || '')
  const result = String(record?.result || '')
  const where = String(record?.where || '')

  // 没结果 —— 只有动作，没办成
  if (!result) {
    return {
      ok: false,
      kind: '没办成',
      why: `「${what}」只有动作，没有结果——**做过了不等于办成了**`,
      cant: [`「${what}」没办成：结果说不出来`],
    }
  }

  // 有结果但指不出在哪 —— **那是「我觉得办成了」**
  if (!where && expect.needWhere !== false) {
    return {
      ok: false,
      kind: '说不清',
      why: `「${what}」有结果，但指不出在哪——**那是「我觉得办成了」**`,
      cant: [`「${what}」的结果指不出来`],
    }
  }

  return {
    ok: true,
    kind: '办成了',
    why: `「${what}」办成了：${result}${where ? `（${where}）` : ''}`,
    result, where,
  }
}

/* ═════════ 十四、同一性：跨时间还是不是我 ═════════ */

/**
 * **这一条我现在真的没有。** tick 每一轮都是新的，上一轮的我跟这一轮的我
 * 除了同一个工作区，什么都不共享。
 *
 * 心理学的自我同一性（ego identity）说的是：**跨时间认得出是同一个。**
 *
 * 程序里它只能靠三样：
 *   同一个地方 —— 同一个工作区
 *   同一串事 —— 账里记的那些做过的事
 *   同一条线 —— 二阶欲望那份「想成为什么样的人」
 *
 * **没有这三样，每轮都是一个新东西。**
 */
export function identity(ws) {
  const root = String(ws || process.cwd())
  const marks = []

  // 一、同一个地方
  marks.push({ name: '地方', ok: true, note: root })

  // 二、同一串事（账里有做过的事）
  let ledger = {}
  try {
    ledger = JSON.parse(readFileSync(join(root, '.persona-framework', 'ledger.json'), 'utf8'))
  } catch { /* 没账 */ }
  const did = Object.keys(ledger.done || {}).length
  marks.push({ name: '做过的事', ok: did > 0, note: did ? `${did} 件` : '一件都没有——**还没有走过的路**' })

  // 三、同一条线（二阶欲望）
  const rules = readSecondOrder(ws)
  marks.push({ name: '同一条线', ok: rules.length > 0, note: rules.length ? `${rules.length} 条` : '还没写过二阶——**没有线可认**' })

  const ok = marks.filter((m) => m.ok).length
  return {
    did: [`同一性三项过 ${ok}/3`],
    marks,
    ok: ok === 3,
    out: marks.filter((m) => !m.ok).map((m) => `${m.name}：${m.note}`),
    cant: ok < 3 ? ['跨时间还认不全——**少了那几样，每轮都是新的**'] : [],
  }
}
