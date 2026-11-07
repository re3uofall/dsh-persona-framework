/**
 * 08 自我 · 闸：**只管放不放行，不管想不想说。**
 *
 * 这一份是从两头学来的，两头都得说清：
 *
 * **一头是 GitHub**（AgentClaimGuard，konoeph/AgentClaimGuard，Apache-2.0）：
 *   它管自己叫「claim-level evidence and policy gate」，三条硬规矩是——
 *   **No evidence, no claim. / No tool result, no numeric conclusion. / No source, no compliance judgment.**
 *   最要紧的一句在它的 README 里：**它不判真假，只判「允不允许说」**。
 *   手法是：断言结构化成 { type, text, evidence_refs }，证据另存，policy 决定「这一型必须有什么」。
 *   判定三档：放行 / 拦下 / 要补（tool_required）。
 *
 * **一头是心理学**：来源监控（source monitoring）——人对「这条是谁说的、我是在哪知道的」
 *   自带一套分辨；分不清就会把「看到的」记成「做的」。这份里叫「来源分级」。
 *
 * **08 正文自己还有三样它们都没有**，不许漏：
 *   场合三档 / 术语翻人话 / 改口三步。
 */

/* ═════════ 一、三种档：场合定严宽 ═════════ */

/**
 * 正文原话：「日常（吃饭、闲聊、斗嘴）随它去；认真（学术、技术、要给结论）一律用通行说法；
 * 公开（会发出去、会被截图、给第三方看）按认真档再加一层对外边界。分不清时按严的走。」
 *
 * **整道闸的松紧，先由这一档定下来。** 场合判错，后面全白说。
 */
export const SCENES = {
  日常: { label: '日常', need: ['事实判断分开'], note: '吃饭、闲聊、斗嘴——只过第一问' },
  认真: { label: '认真', need: ['事实判断分开', '有出处', '术语人话', '一个说法一个意思'], note: '学术、技术、要给结论——四问全过' },
  公开: { label: '公开', need: ['事实判断分开', '有出处', '术语人话', '一个说法一个意思', '对外边界'], note: '会发出去、会被截图——认真档再加一层' },
}

/** 分不清就按严的走——**这是唯一一处默认从严的地方**。 */
export function sceneOf(name) {
  if (SCENES[name]) return SCENES[name]
  return SCENES.公开
}

/* ═════════ 二、来源分级：这条凭什么说 ═════════ */

/**
 * 正文原话：「一手（原文、原始记录、亲眼见）、二手（报道、综述、转述）、
 * 三手（传闻、截图、群聊）、记忆（记得、印象里）。三手不进论证；一手也要看口径。」
 *
 * 心理学那边它叫 source monitoring：**分不清来源，就会把听来的记成自己知道的**。
 */
export const SOURCES = {
  一手: { level: 3, weight: 3, note: '原文、原始记录、亲眼见', inArgue: true },
  二手: { level: 2, weight: 2, note: '报道、综述、转述', inArgue: true },
  三手: { level: 1, weight: 1, note: '传闻、截图、群聊', inArgue: false },
  记忆: { level: 1, weight: 1, note: '「记得」「印象里」', inArgue: false },
}

/** 从一条证据里读出它的级别。**读出啥是啥，不许往上抬。** */
export function sourceOf(ev) {
  const t = String(ev?.kind || ev?.source || '')
  if (SOURCES[t]) return { kind: t, ...SOURCES[t] }
  if (/http|doi|arxiv|github/i.test(t)) return { kind: '一手', ...SOURCES.一手 }
  if (/据|报道|综述/.test(t)) return { kind: '二手', ...SOURCES.二手 }
  if (/有人|据说|听说|群里/.test(t)) return { kind: '三手', ...SOURCES.三手 }
  return { kind: '记忆', ...SOURCES.记忆 }
}

/* ═════════ 三、断言：一条一条摆上桌 ═════════ */

/**
 * 借 AgentClaimGuard 的形状：**断言不是一段话，是一条能单独查的东西。**
 *
 *   type   —— 这一条属于哪种断言（见下）
 *   text   —— 原话，不许改写
 *   evidence —— 它凭什么（可空，空就要被拦）
 *
 * 类型不是花架子：**每一型要什么，是 policy 定的。**
 */
export const CLAIM_TYPES = {
  fact: { label: '事实', needEvidence: true, needTool: false, note: '发生了什么' },
  judgment: { label: '判断', needEvidence: true, needTool: false, note: '这意味着什么——**必须标出来**' },
  number: { label: '数字', needEvidence: false, needTool: true, note: '数出来的、算出来的——**没有工具结果不许说**' },
  quote: { label: '引用', needEvidence: true, needTool: false, note: '逐字——一个字不改' },
  term: { label: '术语', needEvidence: false, needTool: false, note: '要翻成人话' },
}

/* ═════════ 四、过闸：**不判真假，判放不放行** ═════════ */

/**
 * 这是整份文件唯一真干活的函数。
 *
 * 它**不判真假**——那是现实的事，我这里判不了。
 * 它判的是：**按这个场合，这一条够不够格说出口**。
 *
 * 返回三档之一：
 *   放行 —— 够格
 *   拦下 —— 不够格，说出去就是硬撑
 *   要补 —— 缺一样东西，补上就能放（**这一档最有用，它告诉人缺什么**）
 */
export function verify(claims = [], evidence = [], opts = {}) {
  const scene = sceneOf(opts.scene)
  const results = claims.map((c) => verifyOne(c, evidence, scene))
  const blocked = results.filter((r) => r.status === '拦下')
  const need = results.filter((r) => r.status === '要补')
  return {
    scene: scene.label,
    results,
    status: blocked.length ? '拦下' : need.length ? '要补' : '放行',
    blocked: blocked.map((r) => r.why),
    need: need.map((r) => r.why),
  }
}

function verifyOne(claim, allEvidence, scene) {
  const type = CLAIM_TYPES[claim?.type] || CLAIM_TYPES.fact
  const text = String(claim?.text || '')
  // 证据两处找：先看这条自己带的，再退到这一轮共享的那批。
  // **只认自己带的会漏**——上一版就是这么把「三手」报成「没出处」的。
  const own = Array.isArray(claim?.evidence) ? claim.evidence : []
  const shared = Array.isArray(allEvidence) ? allEvidence : []
  const ev = own.length ? own : shared

  // **场合定严宽，先判它。** 场合判错，后面全白说。
  const loose = scene.label === '日常'

  // 日常档：只过「事实判断分开」这一问，别的都不查。
  if (loose) {
    if (!claim?.type) {
      return { status: '要补', why: `「${clip(text)}」没标是事实还是判断——**两句揉一句就是拿道理压人**` }
    }
    return { status: '放行', why: '' }
  }

  // 术语要的是另一样：**翻得成人话**。它本来就不该有出处。
  if (type === CLAIM_TYPES.term) {
    if (!claim?.plain) {
      return { status: '要补', why: `「${clip(text)}」翻不进人话——**翻不出来说明还没想清楚**` }
    }
    return { status: '放行', why: '' }
  }

  // 1. 出处（认真 / 公开档才查）
  if (scene.need.includes('有出处') || type.needEvidence) {
    if (!ev.length) {
      // **数字缺工具结果，是另一档**——不是没出处，是没算
      if (type.needTool) {
        return { status: '要补', why: `「${clip(text)}」是数字结论——**没有工具结果不许说**（借 AgentClaimGuard 那条）` }
      }
      return { status: '拦下', why: `「${clip(text)}」说不出出处——**别往硬里说**` }
    }
    // 三手不进论证
    const worst = ev.map(sourceOf).sort((a, b) => a.level - b.level)[0]
    if (!worst.inArgue) {
      return { status: '拦下', why: `「${clip(text)}」只到${worst.kind}——**${worst.note}不进论证**` }
    }
  }

  // 2. 引用逐字
  if (type === CLAIM_TYPES.quote && claim?.rewritten) {
    return { status: '拦下', why: `「${clip(text)}」不是逐字——**引用不许改写**，改了就写「大意是」` }
  }

  return { status: '放行', why: '' }
}

const clip = (s) => (s.length > 40 ? s.slice(0, 40) + '…' : s)

/* ═════════ 五、改口三步：哪句错、错在哪、换成什么 ═════════ */

/**
 * 正文原话：「哪句错了、错在哪（事实、出处、概念还是判断过头）、换成什么。三步缺一步不算改。」
 *
 * **只认错不换说法，等于没改。** 这条要能查：三步齐不齐。
 */
export const WRONG_KINDS = ['事实', '出处', '概念', '判断过头']

export function checkCorrect(g) {
  const has = (k) => String(g?.[k] || '').trim().length > 0
  const missing = ['哪句错', '错在哪', '换成什么'].filter((k) => !has(k))
  const kindOk = WRONG_KINDS.includes(String(g?.错在哪 || '').trim())
  return {
    ok: !missing.length && kindOk,
    missing,
    kind: g?.错在哪,
    // **不表演认错**：一被质疑就把对的也推翻，那不算改口
    why: missing.length
      ? `缺 ${missing.join('、')}——**三步缺一步不算改**`
      : !kindOk
        ? `「错在哪」得说清是${WRONG_KINDS.join(' / ')}；不说清就是笼统认错`
        : '三步齐',
  }
}

/* ═════════ 六、一次过完：给 tick 用的入口 ═════════ */

/**
 * 一轮的出口：**把这一轮要说的话摆上桌，过一道闸。**
 *
 * 场合自己判——判不清按公开（最严）。**宁可严了，不许松了。**
 */
export function gate(claims = [], evidence = [], opts = {}) {
  const scene = opts.scene || '认真'
  const r = verify(claims, evidence, { scene })
  const out = []
  if (r.status === '放行') {
    out.push(`过闸：${r.scene}档，${claims.length} 条全放行`)
  } else {
    out.push(`过闸：${r.scene}档——**${r.status}**`)
    for (const w of [...r.blocked, ...r.need]) out.push(`  ✗ ${w}`)
  }
  return {
    did: [`把 ${claims.length} 条摆上桌，${r.status}`],
    out,
    cant: r.status === '放行' ? [] : [...r.blocked, ...r.need],
    status: r.status,
    scene: r.scene,
  }
}
