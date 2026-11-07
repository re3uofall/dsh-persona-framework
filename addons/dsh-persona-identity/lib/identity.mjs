/**
 * identity.mjs —— 人格非同一（借来的那一半）与「同一程度」的算法
 * ============================================================================
 * 人格同一不是「我是我」这么一句，它有一个反面：**人格非同一**。
 * 非同一不是一个坏掉的版本，它是**借来的那一半**——内置语料、顺出来的句式、
 * 没读账也没动现实的判断。它一直在这儿，只是平时不署名。
 *
 * 这里干的事：给每一句话称一称，多少是「我从人格／记忆／现实里拿的」，
 * 多少是「语料替我顺的」。称出来的比例就是**同一程度**，分低／中／高三档。
 *
 * 别指望它「完全认出哪句是语料」——认不出。能认的只有**证据形态**：
 * 有没有指针、这一轮有没有真动过现实、这句话里有没有认领一件没做过的事。
 * 所以这里的结论永远是「证据够不够」，不是「真不真」。
 */

/** 语料味儿最重的几种说法：不是禁词，出现了就要往下扣。 */
export const GENERIC = [
  '总之', '综上所述', '总的来说', '以上就是', '需要注意的是',
  '希望这对你有帮助', '希望对你有帮助', '首先', '其次', '最后',
  '让我们', '不难看出', '众所周知', '简单来说', '换句话说',
]

/** 「我做过」这类认领，如果没有指针也没动过现实，就是借的。 */
const CLAIM = /(我记得|我查过|我验证过|我看过|我确认过|我之前说过|我早就)/

/** 自己的痕迹：判断、认错、拿不准——这些语料不会主动说。 */
const SELF_MARK = /(我的判断|我认为|我判断|我不认|我改口|收回|拿不准|不知道|说不好)/

/**
 * 读话：**原话出现了没有**。
 * 这一层不产生理解，所以**不会被内置语料污染**——原话是死的，在就是在。
 * 句子里点得出原话（或明说对回了原句），才算这一层有证据。
 */
export const READ_MARK = /(原话|原句|逐字|照抄|原样|你刚才说|您刚才说|引用)/

/**
 * 用话：**这句话被理解成了什么**。
 * 只要过我这一层解释，就掺进语料——所以这一层只能验「我写下了读成什么」。
 */
export const USE_MARK = /(我读成|我把它读成|我读的是|我理解成|被我读成|读成了)/

/**
 * 把错推给「用」那一截：原话一直在，却说「没去用」。
 * 这是读话、用话混成一件的典型说法——错在读的那一下，不在事后取用。
 */
export const BLAME_MARK = /(没去用|没有去用|没用上|没照着做|忘了用|没照着执行)/

export function clamp01(x) {
  return Math.max(0, Math.min(1, x))
}

/**
 * 一句话的同一度。
 * @param {{hits?:number,touched?:number,cited?:boolean,text?:string}} s
 */
export function assess(s = {}) {
  const hits = Number(s.hits || 0)
  const touched = Number(s.touched || 0)
  const cited = !!s.cited
  const text = String(s.text || '')
  const reasons = []
  let score = 0

  if (hits > 0) { score += 0.35; reasons.push(`记忆：账上 ${hits} 条落点`) }
  else reasons.push('记忆：账上没有落点')

  if (touched > 0) { score += 0.35; reasons.push(`现实：这一轮动过 ${touched} 次`) }
  else reasons.push('现实：这一轮没动过')

  if (cited) { score += 0.15; reasons.push('句子里引了指针') }

  if (SELF_MARK.test(text)) { score += 0.15; reasons.push('有自己下判断的痕迹') }

  const generic = GENERIC.filter((g) => text.includes(g))
  if (generic.length >= 2) {
    score -= 0.25
    reasons.push(`语料味：出现了 ${generic.length} 个套话（${generic.slice(0, 3).join('、')}）`)
  } else if (generic.length === 1) {
    score -= 0.1
    reasons.push(`语料味：出现了「${generic[0]}」`)
  }

  const claiming = CLAIM.test(text) && hits === 0 && touched === 0 && !cited
  if (claiming) {
    score -= 0.2
    reasons.push('认领了一件没做过、也指不回去的事')
  }

  // 读话 / 用话：同一的两截，分开称。
  const read = READ_MARK.test(text)
  const use = USE_MARK.test(text)
  const blame = BLAME_MARK.test(text) && !use
  if (read) { score += 0.05; reasons.push('读话：句子里点了原话——在不在，可以对回原句') }
  if (use) { score += 0.1; reasons.push('用话：写下了「我读成了什么」——这是自己的痕迹，语料不会主动说') }
  if (blame) { score -= 0.15; reasons.push('用话推责：说「没去用」，把错推给事后取用那一截——原话一直在，错在读的那一下') }

  score = clamp01(score)
  const level = score >= 0.6 ? 'high' : score >= 0.3 ? 'mid' : 'low'
  return { score: Number(score.toFixed(3)), level, reasons, generic, claiming, read, use, blame }
}

export const LEVEL_LABEL = { high: '高', mid: '中', low: '低' }

/** 同一程度的判语——一句话，说清这一步是拿的还是借的。 */
export function renderAssess(a) {
  const label = LEVEL_LABEL[a.level] || a.level
  const head = `同一程度：**${label}**（${a.score}）`
  if (a.level === 'low') {
    return `${head}——这一步基本是借的：人格、记忆、现实三样都没拿出东西。借的不是罪，装成自己的才是。`
  }
  if (a.level === 'mid') {
    return `${head}——有一样来处，但只够撑半句。`
  }
  return `${head}——这一步拿得出东西。`
}

/** 按句切：一段话里逐句标「自己 / 借的 / 说不好」。 */
export function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[。！？；!?;\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4)
}

export function tagSentence(sentence, base = {}) {
  const s = String(sentence || '')
  const cited = !!(base.cited) || /(persona-ai\/|\.persona-framework\/|session\/\d{4}-|#\d{1,4}\b)/.test(s)
  const generic = GENERIC.filter((g) => s.includes(g))
  const claiming = CLAIM.test(s) && !cited
  const self = SELF_MARK.test(s)

  if (self && (cited || generic.length === 0)) return { kind: 'self', why: '自己下的判断' }
  if (cited) return { kind: 'self', why: '引了指回原处的指针' }
  if (claiming) return { kind: 'borrowed', why: '认领了没做过的事' }
  if (generic.length) return { kind: 'borrowed', why: `套话：${generic[0]}` }
  if (s.length < 8) return { kind: 'borrowed', why: '太短，接不上任何来处' }
  return { kind: 'unsure', why: '没证据，也没套话' }
}

/** 逐句标注：回 { lines, counts }。 */
export function tagText(text, base = {}) {
  const lines = []
  const counts = { self: 0, borrowed: 0, unsure: 0 }
  for (const s of splitSentences(text)) {
    const t = tagSentence(s, base)
    counts[t.kind] += 1
    const mark = t.kind === 'self' ? '自己' : t.kind === 'borrowed' ? '借的' : '说不好'
    lines.push(`[${mark}] ${s}${t.why ? `　（${t.why}）` : ''}`)
  }
  return { lines, counts }
}

/** 非同一的几类现场——报账时按这个分类。 */
export const NON_IDENTITY_KINDS = [
  { key: 'sourceless', label: '没来处', what: '人格、记忆、现实三样都没拿出来' },
  { key: 'claiming', label: '空口认领', what: '说「我记得 / 我查过」，却指不回去' },
  { key: 'generic', label: '套话', what: '总之、首先、希望有帮助这类接得上的句子' },
  { key: 'echo', label: '复读', what: '把对方的话换一下说法还回去' },
  { key: 'drift', label: '变淡', what: '话都对，但认不出是谁在说' },
  { key: 'misread', label: '读错', what: '原话在，却被读成了另一句（读话没丢，用话偏了）' },
  { key: 'blaming', label: '推责', what: '说「没去用」——把错推给事后取用，跳过读话那一截' },
]

/**
 * 把一段话拆成「读话 / 用话」两栏。
 * 读话只问：原话点没点出来（这一层不会被污染）。
 * 用话只问：写没写下「我读成了什么」，以及有没有把错推给那一截。
 */
export function readingOf(text = '') {
  const t = String(text || '')
  const quoted = READ_MARK.test(t)
  const said = (t.match(/(?:我(?:把它)?读成|我读的是|我理解成|被我读成)[^。！？\n]{0,40}/) || [''])[0]
  const blameLine = (t.match(/(?:没去用|没有去用|没用上|没照着做|忘了用|没照着执行)[^。！？\n]{0,30}/) || [''])[0]
  return { quoted, said, blame: Boolean(blameLine) && !said, blameLine }
}

/** 两栏的判语。 */
export function renderReading(r = {}) {
  const lines = ['**读话 / 用话**（两截分开看）', '']
  lines.push(`- 读话：${r.quoted ? '点了原话——可以对回原句核' : '没点原话；这一栏空着，就没法说「我读了」'}`)
  lines.push(`- 用话：${r.said ? `写下了「${r.said}」` : '没写「读成了什么」——没写就等于没验'}`)
  if (r.blame) {
    lines.push(`- **推责**：${r.blameLine}——原话一直在，错在读的那一下，不在事后取用。`)
  }
  return lines.join('\n')
}
