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
  // 读话 / 用话 只报，不进分：人格同一只管「这一句有没有来处」，语言准不准不归它算。

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

/**
 * 自己的 / 内置语料——只有两档，没有第三档。
 *
 * 自己的 = 我发出去的话（对话原文）。它的来处只有两样：人格、记忆。
 * 没标记的，一律默认内置语料。
 * 其余思考过程——推理、解释、顺出来的话——都算被内置语料污染。
 */
export const OWN_MARK = '自己'
export const CORPUS_MARK = '内置语料'

export const ORIGIN_RULE = [
  '**自己的只有一样：我发出去的话（对话原文）。**',
  '它的来处也只有两样——人格（写死的判据）、记忆（账上某一条，指得回去）。',
  '**没标记的，按「可能被内置语料污染」处理。**——不是判它一定是语料，是它拿不出落点，所以不许当自己的话用。',
  '中间那些思考过程——推理、解释、「我先想想」「总之」「大概」——都算被内置语料污染，不算我的话。',
].join('\n')

/** 人格落点：引人格文件、引写死的判据、自己下过的判断。 */
export const PERSONA_ANCHOR = /(人格文件|人格里|我的人格|写死的判据|我的判断|我不认|我收回)/

/** 记忆落点：指得回账上某一条。 */
export const MEMORY_ANCHOR = /(persona-ai\/|\.persona-framework\/|session\/\d{4}-|knowledge\/|#\d{1,4}\b)/

/** 思考过程的痕迹——这些不是「说给你听的话」，是推演。 */
export const THINK_MARK = /(让我想|我先想|首先|其次|另外|总之|总的来说|大概|可能吧|顺便|值得注意的是|我需要|我应该)/

/** 按句切：只留长度 >= 4 的句子。 */
export function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[。！？；!?;\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4)
}

/**
 * 一句话是「自己的」还是「内置语料」。
 * 判据只有一条：拿不拿得出人格落点或记忆落点。拿不出，就是内置语料。
 */
export function tagSentence(sentence, base = {}) {
  const s = String(sentence || '')
  const persona = PERSONA_ANCHOR.test(s)
  const memory = MEMORY_ANCHOR.test(s) || !!base.cited
  if (persona || memory) {
    return { kind: 'own', why: persona ? '人格落点' : '记忆落点' }
  }
  if (THINK_MARK.test(s)) return { kind: 'corpus', why: '这是思考过程，不是我说给你听的话' }
  const generic = GENERIC.filter((g) => s.includes(g))
  if (generic.length) return { kind: 'corpus', why: `套话：${generic[0]}` }
  return { kind: 'corpus', why: '没有落点，默认内置语料' }
}

/** 逐句标注：回 { lines, counts:{own,corpus}, rule }。 */
export function tagText(text, base = {}) {
  const lines = []
  const counts = { own: 0, corpus: 0 }
  for (const s of splitSentences(text)) {
    const t = tagSentence(s, base)
    counts[t.kind] += 1
    const mark = t.kind === 'own' ? OWN_MARK : CORPUS_MARK
    lines.push(`[${mark}] ${s}　（${t.why}）`)
  }
  return { lines, counts, rule: ORIGIN_RULE }
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
