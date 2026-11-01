/**
 * 09 超我 · 功能实现
 *
 * 判据原文（模块 09 第四节，六条）——
 *
 *   1. 这是目标还是想要？判据、第一步、放弃条件，三样齐吗？
 *   2. 目标是哪个来源？捡来的过手了吗？换来的写着价吗？长出来的，有没有往想要的方向挪？
 *   3. 换个尺度还成立吗？
 *   4. 这条理想达成的瞬间，还能改口吗？不能，就该进禁区。
 *   5. 有没有拿标去量别人？
 *   6. 没人看的时候也这么做吗？
 *
 * 翻成动作（哪一条是「判」、哪一条是「写」）：
 *
 *   | 原句 | 翻成什么 | 是读判写 |
 *   | --- | --- | --- |
 *   | 三样齐 | `claimGoal()` 查 judge/firstStep/giveUp，齐了才记账 | 判 → **写** |
 *   | 来源与价 | 捡来的必须过手（`handled`），换来的必须写 `price` | 判 → **写** |
 *   | 换尺度 | `SCALES` 五档，同一件事逐档重问 | 判 → **写**（记在标的账上） |
 *   | 能不能改口 | 不能就 `lockZone()` 进禁区，**进去就不许删** | **写** |
 *   | 拿标量人 | `measureOthers()` 记一笔，**并把那个标的降级** | **写** |
 *   | 没人看也做 | **做不了**——没有观察者信息，不给结论 | `cant` |
 *
 * 两头都不管的那部分（指南第三步的判据）：
 *   学科（self-discrepancy：actual / ideal / ought 的差距）只管「差距有多大」，
 *   不管「这个标是谁给的」；工程（Ulysses contract：把未来的自己绑住）只管「怎么锁」，
 *   不管「锁什么才值得」。**所以来源、量人、没人看这三条，是从正文来的，不是从两头搬的。**
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

/* ═════════ 一、账：三本，落在一个文件里 ═════════ */

const BOOK_NAMES = ['标的', '禁区', '量人', '退过']

export function goalFile(ws) {
  return join(String(ws || process.cwd()), '.persona-framework', '超我.json')
}

export function openGoalBook(ws) {
  const f = goalFile(ws)
  let v = {}
  try { v = JSON.parse(readFileSync(f, 'utf8')) } catch { /* 没这本就用空 */ }
  const book = { _f: f, _dirty: false }
  for (const n of BOOK_NAMES) book[n] = v[n] && typeof v[n] === 'object' ? v[n] : {}
  if (!Array.isArray(book.量人.list)) book.量人 = { list: [] }
  if (!Array.isArray(book.退过.list)) book.退过 = { list: Array.isArray(book.退过.list) ? book.退过.list.slice(-200) : [] }
  return book
}

export function saveGoalBook(book) {
  if (!book?._dirty) return 0
  const f = book._f
  const d = dirname(f)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  const out = {}
  for (const n of BOOK_NAMES) {
    if (n === '量人') out[n] = { list: (book.量人.list || []).slice(-200) }
    else if (n === '退过') out[n] = { list: (book.退过.list || []).slice(-200) }
    else {
      const keys = Object.keys(book[n])
      out[n] = keys.length > 200
        ? Object.fromEntries(keys.slice(-200).map((k) => [k, book[n][k]]))
        : book[n]
    }
  }
  writeFileSync(f, JSON.stringify(out, null, 2), 'utf8')
  book._dirty = false
  return 1
}

/* ═════════ 二、尺度：五档，不是四档 ═════════ */

/**
 * 「一顿饭 / 一天 / 一季 / 一年 / 一辈子」——原文的五档，一字不改。
 *
 * 为什么要逐档问：**同一件事换一个尺度，答案就换。**
 * 饿会把任何事说成志向；忙会盖住方向；一季容易变成完成感的瘾；一年才是检验的尺度；
 * 一辈子不是目标，是理想。
 */
export const SCALES = ['一顿饭', '一天', '一季', '一年', '一辈子']

/** 一辈子那一档是理想，不是目标。区分只在一处：够不够得着。 */
export const IDEAL_SCALE = '一辈子'

export function scaleTest(g) {
  const want = Array.isArray(g?.scales) && g.scales.length ? g.scales : SCALES
  const holds = []
  const drops = []
  for (const s of want) {
    // 每一档问同一句：这件事在这个尺度上还成立吗
    // 「成立」的判据：说得出这一步在这个尺度里做什么
    const ok = Boolean(g?.byScale && g.byScale[s])
    if (ok) holds.push(s)
    else drops.push(s)
  }
  return {
    holds,
    drops,
    // 只在最短那一档成立 = 那可能是饿，不是标
    shortOnly: holds.length > 0 && drops.includes('一年'),
    note: holds.length === want.length
      ? `五档都成立：${holds.join('/')}`
      : holds.length
        ? `成立：${holds.join('/')}；不成立：${drops.join('/')}`
        : '一档都不成立——这不是标，是一时兴起',
  }
}

/* ═════════ 三、标的三样：齐了才记账 ═════════ */

/** 三种来源，原文四样：欠下的 / 捡来的 / 换来的 / 长出来的。 */
export const SOURCES = ['欠下的', '捡来的', '换来的', '长出来的']

export function checkGoal(g) {
  const missing = []
  if (!g?.judge) missing.push('判据（怎么算做完，别人也查得了）')
  if (!g?.firstStep) missing.push('第一步（今天就能踩下去）')
  if (!g?.giveUp) missing.push('放弃条件（什么情况下不干了）')
  return { ok: !missing.length, missing }
}

/**
 * 第 1、2 条判完，齐了才写账。
 *
 * **缺一条就不记，但要说缺哪条**——缺放弃条件的目标会变成神像：
 * 供着，不敢碰，也不敢扔。
 */
/**
 * 退回也是一次动作——**它也得留痕**。
 *
 * 上一版退回只返回一串 cant：账上什么都没有，下一轮看不出「昨天退过这条、缺什么」，
 * 于是同样的想要明天再来一遍。留一笔，它才算进过这道闸。
 */
function refuse(book, what, why) {
  book.退过.list.push({
    what: String(what || '').slice(0, 120),
    why: why.join('；').slice(0, 300),
    at: new Date().toISOString(),
  })
  book.退过.list = book.退过.list.slice(-200)
  book._dirty = true
  return { ok: false, cant: why, recorded: true }
}

export function claimGoal(book, g) {
  const key = String(g?.what || '').trim()
  if (!key) return { ok: false, cant: ['没说要记什么标'] }  // 空话不记，免得账里全是空

  // **先查禁区：锁进去的不许再动。**
  // 上一版只写不查——锁成立了也锁不住任何东西。
  if (book.禁区[key]) {
    return refuse(book, key, [`「${key}」在禁区里（${book.禁区[key].lockedAt?.slice(0, 10)} 锁的）——**达成的瞬间不能再改口，这条不收、也不许改口**`])
  }

  const check = checkGoal(g)
  if (!check.ok) {
    return { ...refuse(book, key, [`这条还只是想要：缺 ${check.missing.join('、')}`]), missing: check.missing }
  }

  // 第 2 条：来源。捡来的必须过手，换来的必须写价
  const src = String(g.source || '').trim()
  const srcOk = SOURCES.includes(src)
  const passed = g.handled === true || src !== '捡来的'
  const priced = Boolean(g.price) || src !== '换来的'
  if (!srcOk) return refuse(book, key, [`来源说不清（${src || '空'}）——捡来、换来、长出、欠下，四样里挑一个`])
  if (!passed) return refuse(book, key, ['捡来的没过手——**别人塞过来的，不当自己的标**'])
  if (!priced) return refuse(book, key, ['换来的没写价——**拿什么换的，得写着**'])

  const scale = scaleTest(g)
  // **一档都不成立就不收。** 上一版照样记账，账上还写着「这不是标」——**自相矛盾**。
  // 只在一档成立的（shortOnly）照收，但要标出来：那可能是饿，不是标。
  if (!scale.holds.length) {
    return refuse(book, key, [`一个尺度上都说不清要做什么——**这不是标，是一时兴起**`])
  }

  book.标的[key] = {
    source: src,
    price: g.price || '',
    judge: g.judge,
    firstStep: g.firstStep,
    giveUp: g.giveUp,
    scales: scale.holds,
    scaleNote: scale.note,
    // 长出来的最容易骗人：它最像自己的，所以要记它有没有往「想要」那边挪
    drifted: src === '长出来的' ? g.drifted === true : false,
    at: new Date().toISOString(),
  }
  book._dirty = true
  return { ok: true, did: [`记下标的「${key}」：来源 ${src}｜尺度 ${scale.note}`], goal: book.标的[key] }
}

/* ═════════ 四、禁区：达成的瞬间不能改口 ═════════ */

/**
 * 判据只有一句：**达成的瞬间，还能不能改口？不能，就进禁区。**
 *
 * 这是全文里最该落盘的一条，因为它一旦成立就**不许再删**——
 * Ulysses contract 的全部意思就是这个：把未来的自己绑住。
 * 所以 `unlockZone()` 不是「解锁」，是「记一笔谁想解」，**账不改**。
 */
export function lockZone(book, ideal) {
  const key = String(ideal?.what || '').trim()
  if (!key) return { ok: false, cant: ['没说要把哪条关进去'] }
  if (book.禁区[key]) return { ok: true, already: true, did: [`「${key}」早就在禁区里`] }

  // 能改口的，不进禁区——那是理想，不是禁区
  if (ideal.canSay !== false) {
    return { ok: false, cant: [`「达成的瞬间还能改口」——那它是理想（近或远），不是禁区`] }
  }

  book.禁区[key] = {
    why: ideal.why || '达成的瞬间就再也不能改口',
    lockedAt: new Date().toISOString(),
    tries: [],
  }
  book._dirty = true
  return { ok: true, did: [`把「${key}」关进禁区——**从此不许改口**`] }
}

export function isLocked(book, what) {
  return Boolean(book?.禁区?.[String(what || '').trim()])
}

/** 想解禁的，记下来，**但不解锁**。 */
export function tryUnlock(book, what, why) {
  const key = String(what || '').trim()
  const z = book.禁区[key]
  if (!z) return { ok: false, cant: [`「${key}」不在禁区里`] }
  z.tries = z.tries || []
  z.tries.push({ why: why || '没说为什么', at: new Date().toISOString() })
  book._dirty = true
  return {
    ok: true,
    did: [`记下想解禁「${key}」的念头（第 ${z.tries.length} 次）——**记下不等于解禁**`],
    note: '禁区不解，只记谁想解、为什么',
  }
}

/* ═════════ 五、拿标量人：一量就降级 ═════════ */

/**
 * 第 5 条：**标一拿出去量人，就成了棍子。**
 *
 * 所以这里不是「记一笔就算了」，是**把这个标的效力降一级**：
 * 被拿去做尺子的标，从此只能用来看自己，不能再用来说别人。
 */
export function measureOthers(book, what, who) {
  const key = String(what || '').trim()
  const target = String(who || '').trim()
  if (!key || !target) return { ok: false, cant: ['得说清拿哪条标、量了谁'] }

  const g = book.标的[key]

  // **已经降过级的，不许再拿去说别人。**
  // 上一版只置 demoted、从不查它——降级降了个寂寞。
  if (g?.demoted) {
    return {
      ok: false,
      refused: true,
      cant: [`「${key}」已经降过级（量过 ${g.usedAsRuler} 次）——**它只能用来看自己，不能再说别人**`],
    }
  }

  if (g) {
    g.usedAsRuler = (g.usedAsRuler || 0) + 1
    g.demoted = true
  }
  book.量人.list.push({ goal: key, who: target, at: new Date().toISOString() })
  book._dirty = true
  return {
    ok: true,
    did: [`拿「${key}」量了「${target}」——记一笔，**这条标降级：从此只用于自己**`],
    demoted: Boolean(g),
  }
}

/* ═════════ 六、一步走完：tick 里叫它 ═════════ */

/**
 * 一轮里超我做的三件事：
 *
 *   一、把这一轮收到的目标过一遍（三样齐不齐、来源过没过手）
 *   二、能进禁区的关进去
 *   三、报一遍现在有几条标的、几条禁区、被量过几次人
 *
 * **不写「没人看还做吗」**——没有观察者信息，判不了，明说。
 */
export function superegoStep(ws, opts = {}) {
  const book = openGoalBook(ws)
  const goals = Array.isArray(opts.goals) ? opts.goals : []
  const ideals = Array.isArray(opts.ideals) ? opts.ideals : []

  const out = []
  const claimed = []
  const refused = []
  const locked = []

  for (const g of goals) {
    const r = claimGoal(book, g)
    if (r.ok) {
      claimed.push(g.what)
      out.push(...(r.did || []))
    } else {
      refused.push({ what: g?.what, why: (r.cant || []).join('；') })
    }
  }

  for (const ideal of ideals) {
    const r = lockZone(book, ideal)
    if (r.ok) { locked.push(ideal.what); if (r.did) out.push(...r.did) }
    else refused.push({ what: ideal?.what, why: (r.cant || []).join('；') })
  }

  // 汇总也要说得出数——**数不出来的等于没记**
  const nGoal = Object.keys(book.标的).length
  const nZone = Object.keys(book.禁区).length
  const nRuler = (book.量人.list || []).length
  if (nGoal || nZone) out.push(`标 ${nGoal} 条｜禁区 ${nZone} 条｜拿标量人 ${nRuler} 次`)

  const wrote = saveGoalBook(book)

  return {
    out,
    claimed,
    locked,
    refused,
    wrote,
    stats: { 标的: nGoal, 禁区: nZone, 量人: nRuler },
    // 第 6 条做不了，写清楚
    cant: [
      '「没人看的时候也这么做吗」——没有观察者信息，判不了。不假装判过。',
    ],
  }
}
