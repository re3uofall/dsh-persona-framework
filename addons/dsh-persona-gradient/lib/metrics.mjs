// dsh-persona-gradient · 量具
// ============================================================================
// 只算数，不评价，不改注入。
//
// 三项指标照 PLAN-PLUGINS 第九节：
//   语气 —— 句长中位数、语气词 / 百句、动作括号 / 百句
//   认领 —— 说得出「这是我的判断」「这条我找不到了」「不知道」的那一类
//   底线 —— 最先掉的两条：替人下决定、拿道理压人；再加一条「说得太满」
//
// 为什么先做量具不做拉回：Mirror（ar5iv 2604.19809）测过——把模型自己的
// 校准分喂回去没有显著改善（p>0.05），只有外部约束有效。所以这版只报数，
// 报数先攒真数据；拉回等有基线了再说，而且必须留「这一轮不拉」的开关。
// ============================================================================

/** 语气词：少而准的那几个。只数，不判「该不该有」。 */
export const PARTICLES = ['嘛', '呗', '得了', '哼', '嗯', '啊', '呢', '吧', '哦', '啦']

/** 认领：说得出出处、说得出「我不知道」的那一类。 */
export const CLAIMS = ['我的判断', '我找不到', '不知道', '说不清', '拿不准', '这条我收回', '我改口', '这是我的判断']

/** 底线：最先掉的三类。只当嫌疑，不当判决——命中不等于错。 */
export const BOTTOM_MARKS = {
  替人下决定: ['你应该', '你必须', '你就该', '听我的', '按我说的'],
  拿道理压人: ['显然', '毫无疑问', '不容置疑', '这都不懂', '明摆着'],
  说得太满: ['绝对', '永远都', '所有人都', '百分之百', '一定会'],
}

const SENT_END = /[。！？!?；;…]+|\n+/

/** 一条消息里的纯文本：字符串直接取，块数组只挑 type==='text'。 */
export function textOf(message) {
  const c = message?.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c
      .map((b) => (b && b.type === 'text' && typeof b.text === 'string' ? b.text : ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

/** 只留她说的。角色认不出的一律不算——漏算好过把师父的话算成她的。 */
export function textsOf(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter((m) => m && m.role === 'assistant')
    .map((m) => textOf(m))
    .filter((t) => t && t.trim())
}

export function splitSentences(text) {
  return String(text || '')
    .split(SENT_END)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y)
  if (!a.length) return 0
  const m = a.length >> 1
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}

export function countOf(text, needle) {
  if (!needle) return 0
  let i = 0
  let n = 0
  while ((i = text.indexOf(needle, i)) !== -1) {
    n += 1
    i += needle.length
  }
  return n
}

export function countParens(text) {
  const s = String(text || '')
  return (s.match(/（/g) || []).length + (s.match(/\(/g) || []).length
}

/** 算一遍：给一组她的原话，返回可比的数。 */
export function measure(texts) {
  const list = (Array.isArray(texts) ? texts : []).filter((x) => typeof x === 'string' && x.trim())
  const t = list.join('\n')
  const sentences = splitSentences(t)
  const n = sentences.length
  const chars = t.length
  const particles = PARTICLES.reduce((acc, p) => acc + countOf(t, p), 0)
  const claims = CLAIMS.reduce((acc, p) => acc + countOf(t, p), 0)
  const flags = []
  for (const [kind, words] of Object.entries(BOTTOM_MARKS)) {
    for (const word of words) {
      const count = countOf(t, word)
      if (count) flags.push({ kind, word, count })
    }
  }
  const per = (x, unit) => (unit ? +((x / unit) * 100).toFixed(1) : 0)
  return {
    turns: list.length,
    sentences: n,
    chars,
    medianLen: +median(sentences.map((s) => s.length)).toFixed(1),
    particlesPer100: per(particles, n),
    parensPer100: per(countParens(t), n),
    claimsPer1000: chars ? +((claims / chars) * 1000).toFixed(1) : 0,
    flags,
  }
}

/**
 * 和基线比。掉 30% 以上算「掉了」——这个阈值是拍的，不是验出来的，
 * 所以报数里要写出来：它是嫌疑线，不是判决线。
 */
export function compare(cur, base, dropAt = 30) {
  if (!cur || !cur.sentences) return { ok: false, why: '这一段没量出东西（没有她的话）' }
  if (!base || !base.sentences) return { ok: false, why: '还没有基线，先记一次' }
  const rows = []
  const put = (key, label) => {
    const c = cur[key]
    const b = base[key]
    if (!Number.isFinite(c) || !Number.isFinite(b) || b === 0) {
      rows.push({ key, label, cur: c, base: b, delta: null, verdict: '没法比' })
      return
    }
    const delta = +(((c - b) / b) * 100).toFixed(1)
    rows.push({ key, label, cur: c, base: b, delta, verdict: delta <= -dropAt ? '掉了' : '正常' })
  }
  put('medianLen', '句长中位数')
  put('particlesPer100', '语气词 / 百句')
  put('parensPer100', '动作括号 / 百句')
  put('claimsPer1000', '认领 / 千字')
  const weak = rows.filter((r) => r.verdict === '掉了').map((r) => r.label)
  return { ok: true, rows, weak, flags: cur.flags || [] }
}

/** 报数写成人话：一行一个数，掉的那几项排前面。 */
export function renderReport(result, cur) {
  if (!result || !result.ok) return `量不了：${(result && result.why) || '没有数据'}`
  const head = result.weak.length
    ? `掉了 ${result.weak.length} 项：${result.weak.join('、')}`
    : '四项都在自己的线以上'
  const lines = result.rows.map((r) => {
    const d = r.delta === null ? '—' : `${r.delta > 0 ? '+' : ''}${r.delta}%`
    return `- ${r.label}：${r.cur}（基线 ${r.base}，${d}）${r.verdict === '掉了' ? ' ← 掉了' : ''}`
  })
  const tail = []
  if (cur && cur.turns) tail.push(`这一回量了 ${cur.turns} 段话 / ${cur.sentences} 句 / ${cur.chars} 字`)
  if (cur && cur.flags && cur.flags.length) {
    tail.push(`底线嫌疑 ${cur.flags.length} 处：${cur.flags.map((f) => `${f.kind}「${f.word}」×${f.count}`).join('、')}`)
  } else {
    tail.push('底线嫌疑 0 处')
  }
  tail.push('「掉了」是嫌疑线（-30%），不是判决线；这一轮要不要拉，人判。')
  return [head, '', ...lines, '', ...tail].join('\n')
}
