/**
 * lib/learn.mjs —— 从人说的话里挑出「关于她自己」的那几句
 * ============================================================================
 * 这是插件「自己会学」的那一半：不靠模型想起来，靠模式。
 *
 * 但只认**明确的长期要求**：「以后你……」「别……」「记住……」「叫我……」。
 * 一句抱怨、一次吐槽、一个临时任务，都不算 —— 宁可漏，不可把噪声长进人格里。
 *
 * 精挑的那一半留给模型：它判断得出「这句是在改她」，会自己调 persona_learn。
 * 两条路都往同一本证据账上记，所以两条都作数。
 * ============================================================================
 */

/** 句子切分：中英文句末都算。不用 lookbehind，老一点的 Node 也跑得动。 */
const SENTENCE_SPLIT = /[。！？!?\n\r]+/

/**
 * 规则从窄到宽。同一句命中多条时取第一条 —— 称呼最先，因为它最不会错。
 */
const RULES = [
  { kind: '称呼', re: /叫我|喊我|称呼我/ },
  { kind: '纠正', re: /记住|以后你|你以后|以后别|今后你|从今往后|下次你|你别|别再|不要再|不许你|你得|你要|你应该|你必须/ },
  { kind: '偏好', re: /我喜欢|我不喜欢|我讨厌|我更喜欢|我受不了|我最爱/ },
]

/** 明显不是「改她」的句子。「以后再说」这种最常见，先挡掉。 */
const NOISE = [
  /^(?:以后|今后)(?:再说|的事|有机会|有空)/,
  /^(?:别|不要)紧/,          // 「别紧张」是安慰，不是要求
  /^(?:记住|别忘了)(?:带|拿|买|吃|睡|回)/,  // 「记住吃饭」是关心她，不是改她
]

const MIN_LEN = 4
const MAX_LEN = 120
const MAX_PER_MESSAGE = 3
const SCAN_CHARS = 4000

/** 从一条 UserMessage 里取纯文本。 */
export function extractText(message) {
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

/**
 * 挑候选。
 * @param {string} text 使用者这一轮说的话
 * @returns {Array<{kind: string, text: string, quote: string}>}
 */
export function extractCandidates(text) {
  const raw = typeof text === 'string' ? text : ''
  if (raw.trim().length < MIN_LEN) return []

  const out = []
  const seen = new Set()
  for (const piece of raw.slice(0, SCAN_CHARS).split(SENTENCE_SPLIT)) {
    const sentence = piece.trim().replace(/^[-*>\s]+/, '')
    if (sentence.length < MIN_LEN || sentence.length > MAX_LEN) continue
    if (NOISE.some((re) => re.test(sentence))) continue

    const rule = RULES.find((r) => r.re.test(sentence))
    if (!rule) continue
    // 除了称呼，都要求这句话确实是冲着「你」说的，否则「我喜欢吃鱼」也会被收进来
    if (rule.kind !== '称呼' && !sentence.includes('你')) continue

    const key = sentence.replace(/[\s\u3000]+/g, '')
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ kind: rule.kind, text: sentence, quote: sentence })
    if (out.length >= MAX_PER_MESSAGE) break
  }
  return out
}
