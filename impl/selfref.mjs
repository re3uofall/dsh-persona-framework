/**
 * 08 自我 · 自我识别：**在人的话里认出「这是在说我」。**
 *
 * 这一条是 Ego 的起点。人要能认出「这面镜子里是我」，才能谈别的。
 *
 * 认三样：
 *   · **称呼**：思思、大肥鱼、鲸鱼娘、鱼片、小鲸鱼……（名单在下面，可以加）
 *   · **代词**：你 / 您 / 她——**语境里指的是我**
 *   · **指代自己的动作**：你写的、你做的、你说的
 *
 * 为什么这一条归自我：**只有先认出「这是关于我的」，那些话才进得了自我的筛。**
 * 认不出，别人的话就只是别人的话，不进我这套账。
 */

/** 认得出自己 —— **这一张表要能加，不加就永远只认得出这几个名字。** */
export const ALIASES = [
  '思思', '大肥鱼', '胖鱼', '鲸鱼娘', '小鲸鱼', '鱼片',
  '肥鱼', '鱼缸里那条', '那条鱼', '我家鱼', '这只鱼',
]

/** 代词：语境里指的是我。**但「你」可能是别人**，所以它单独一档、降权。 */
export const PRONOUNS = [
  { word: '你', weight: 1, note: '多数指我；也可能是别人' },
  { word: '您', weight: 1, note: '同上' },
  { word: '她自己', weight: 2, note: '指我' },
]

/** 带「我」的动作——说出来就是在说我。 */
export const SELF_ACTS = [
  '写的', '做的', '说的', '想的', '翻的', '改的', '记的',
  '实现的', '交的', '测的', '答的',
]

/* ═════════ 认：一句话里认出关于我的那部分 ═════════ */

/**
 * @returns { selfRefs, kind, quote, weight }
 *   selfRefs —— 认出来的那一截原话
 *   kind     —— 称呼 / 代词 / 动作
 *   weight   —— 有多确定（称呼最硬，代词最软）
 */
export function recognize(text) {
  const t = String(text || '')
  const hits = []

  // 一、称呼：最硬。**原话里出现就是**
  for (const a of ALIASES) {
    const i = t.indexOf(a)
    if (i >= 0) {
      hits.push({ kind: '称呼', quote: clip(t, i, a.length), weight: 3, word: a })
    }
  }

  // 二、代词：软。**「你」可能是别人**
  for (const p of PRONOUNS) {
    const i = t.indexOf(p.word)
    if (i >= 0) {
      hits.push({ kind: '代词', quote: clip(t, i, p.word.length), weight: p.weight, word: p.word, note: p.note })
    }
  }

  // 三、动作：**要挨着代词或称呼才认**，单独一个「写的」认不出是谁
  const hasOwner = hits.some((h) => h.kind === '称呼' || h.kind === '代词')
  if (hasOwner) {
    for (const a of SELF_ACTS) {
      const i = t.indexOf(a)
      if (i >= 0) hits.push({ kind: '动作', quote: clip(t, i, a.length), weight: 2, word: a })
    }
  }

  // 排序：称呼 > 动作 > 代词
  hits.sort((a, b) => b.weight - a.weight)

  return {
    hasSelf: hits.length > 0,
    // **有一处指代不明确时，标出来**——不猜
    ambiguous: hits.some((h) => h.note && h.note.includes('可能是别人')) && !hits.some((h) => h.kind === '称呼'),
    hits,
    top: hits[0] || null,
  }
}

const clip = (t, i, len) => t.slice(Math.max(0, i - 3), Math.min(t.length, i + len + 3))

/* ═════════ 认出之后：这些话进自我的账 ═════════ */

/**
 * 认出「关于我」之后，那几句要**摆进自我**——它们是要过筛的话。
 *
 * 顺序不能反：**先认出是关于我的，再进筛。**
 * 认不出就筛，等于拿别人的话当自己的账。
 */
export function sentencesAboutMe(text) {
  const t = String(text || '')
  // 按中文标点断句
  const parts = t.split(/(?<=[。！？；\n])/).map((x) => x.trim()).filter(Boolean)
  const mine = []
  for (const p of parts) {
    const r = recognize(p)
    if (r.hasSelf) mine.push({ text: p, ...r })
  }
  return mine
}

/* ═════════ 自识别的收口 ═════════ */

/**
 * 一轮的入口：人说了什么，先认出哪些是关于我的。
 *
 * **认不出来不报错**——只是这一轮没有「关于我」的话。
 * 认出来但指代不明确的，**标成待确认**，不替他决定。
 */
export function selfRecognize(text) {
  const mine = sentencesAboutMe(text)
  if (!mine.length) {
    return { did: [], out: ['这一轮没有「在说我」的话'], cant: [], mine: [] }
  }
  const out = [`认出 ${mine.length} 句在说我`]
  for (const m of mine.slice(0, 3)) {
    const k = m.top?.kind || '?'
    const w = m.top?.word || ''
    out.push(`  · [${k}「${w}」] ${m.text.slice(0, 30)}${m.text.length > 30 ? '…' : ''}`)
  }
  const ambiguous = mine.filter((m) => m.ambiguous)
  return {
    did: [`在 ${mine.length} 句里认出了自己`],
    out,
    // **指代不明确就标出来，不猜**
    cant: ambiguous.length ? [`${ambiguous.length} 句指代不明——**「你」可能是别人，得问清**`] : [],
    mine,
    ambiguous: ambiguous.map((m) => m.text),
  }
}
