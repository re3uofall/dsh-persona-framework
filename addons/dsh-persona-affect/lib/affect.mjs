/**
 * affect.mjs —— 情绪：从一次评估走到「现在是什么心情」。
 *
 * 三个时间尺度，三套东西：
 *   1. **评估**（一个事件：跟我要不要紧、是好是坏、意不意外、把不把握得住、急不急）；
 *   2. **情绪**（在评估空间里找最近的那个原型：喜悦/焦虑/愤怒/失落……，强度是算出来的）；
 *   3. **心境与四种调质**（把这一次摊薄到更慢的一层，再带着走）。
 *
 * 调质不是「开心值」，四条线各有各的用：
 *   da  多巴胺 —— 奖赏预测误差，推着去试、去使劲；
 *   ser 血清素 —— 厌恶预测，推着忍、推着按住冲动；
 *   ne  去甲肾上腺素 —— 没料到的意外，拉高警觉；
 *   ach 乙酰胆碱 —— 料得到的模糊，拉高注意与学习率。
 *
 * 抄的是这套账怎么记，不抄「情绪替我做决定」——那一步得先说清判据再动。
 */

const clamp = (x, lo = 0, hi = 1) => {
  const n = Number(x)
  if (!Number.isFinite(n)) return lo
  return n < lo ? lo : n > hi ? hi : n
}

const round2 = (x) => Math.round(Number(x) * 100) / 100

const softmax = (values, temperature = 1) => {
  const t = temperature || 1
  const max = Math.max(...values)
  const exps = values.map((v) => Math.exp((v - max) / t))
  const sum = exps.reduce((a, b) => a + b, 0) || 1
  return exps.map((v) => v / sum)
}

const decayToward = (value, elapsedMs, halfLifeMs, floor) => {
  if (!(elapsedMs > 0)) return value
  const k = 0.5 ** (elapsedMs / Math.max(1, halfLifeMs))
  return floor + (value - floor) * k
}

/** 评估的维度。砍到六样：再多就分不清哪一样在起作用。 */
export const DIMS = ['relevance', 'congruence', 'novelty', 'certainty', 'control', 'urgency']

/** 每样在「像不像某个情绪」里占多少。好坏（congruence）压得住场面。 */
const W = { relevance: 1.0, congruence: 1.1, novelty: 0.5, certainty: 0.35, control: 0.6, urgency: 0.6 }

/**
 * 情绪原型：一串评估特征 + 它大致落在哪个位置（v 愉悦 / a 唤醒）+ 它想干什么。
 * 「想干什么」那栏不是修辞：情绪本身就是一条行动倾向，没有倾向的情绪只是形容词。
 */
export const PROTOTYPES = [
  { key: 'relief', label: '如释重负', p: { relevance: 0.55, congruence: 0.55, novelty: 0.25, certainty: 0.7, control: 0.65, urgency: 0.15 }, v: 0.45, a: 0.22, want: '收尾、恢复常态' },
  { key: 'joy', label: '高兴', p: { relevance: 0.7, congruence: 0.8, novelty: 0.35, certainty: 0.7, control: 0.7, urgency: 0.2 }, v: 0.8, a: 0.55, want: '说出去、往下推' },
  { key: 'contentment', label: '满足', p: { relevance: 0.4, congruence: 0.7, novelty: 0.1, certainty: 0.85, control: 0.8, urgency: 0.1 }, v: 0.6, a: 0.15, want: '就这么待着' },
  { key: 'curiosity', label: '好奇', p: { relevance: 0.7, congruence: 0.15, novelty: 0.9, certainty: 0.25, control: 0.55, urgency: 0.4 }, v: 0.3, a: 0.6, want: '去看看、多要一点信息' },
  { key: 'hope', label: '期待', p: { relevance: 0.7, congruence: 0.6, novelty: 0.45, certainty: 0.35, control: 0.4, urgency: 0.5 }, v: 0.5, a: 0.55, want: '投入、等结果' },
  { key: 'pride', label: '得意', p: { relevance: 0.6, congruence: 0.8, novelty: 0.3, certainty: 0.8, control: 0.8, urgency: 0.2 }, v: 0.72, a: 0.55, want: '守住标准' },
  { key: 'gratitude', label: '感激', p: { relevance: 0.6, congruence: 0.8, novelty: 0.4, certainty: 0.7, control: 0.3, urgency: 0.3 }, v: 0.75, a: 0.4, want: '回一点什么、把关系续上' },
  { key: 'fear', label: '怕', p: { relevance: 0.9, congruence: -0.8, novelty: 0.6, certainty: 0.6, control: 0.1, urgency: 0.9 }, v: -0.8, a: 0.85, want: '躲开或者喊人' },
  { key: 'anxiety', label: '焦虑', p: { relevance: 0.8, congruence: -0.5, novelty: 0.5, certainty: 0.2, control: 0.2, urgency: 0.7 }, v: -0.55, a: 0.72, want: '反复检查、要个确定' },
  { key: 'anger', label: '火大', p: { relevance: 0.8, congruence: -0.7, novelty: 0.3, certainty: 0.7, control: 0.6, urgency: 0.8 }, v: -0.6, a: 0.8, want: '顶回去、划条线' },
  { key: 'guilt', label: '内疚', p: { relevance: 0.6, congruence: -0.6, novelty: 0.2, certainty: 0.6, control: 0.7, urgency: 0.5 }, v: -0.6, a: 0.5, want: '补回来' },
  { key: 'shame', label: '难堪', p: { relevance: 0.6, congruence: -0.6, novelty: 0.2, certainty: 0.5, control: 0.3, urgency: 0.5 }, v: -0.65, a: 0.45, want: '缩回去、别被看见' },
  { key: 'sadness', label: '失落', p: { relevance: 0.6, congruence: -0.7, novelty: 0.2, certainty: 0.7, control: 0.1, urgency: 0.3 }, v: -0.7, a: 0.25, want: '慢下来' },
  { key: 'frustration', label: '憋住了', p: { relevance: 0.7, congruence: -0.5, novelty: 0.4, certainty: 0.5, control: 0.3, urgency: 0.6 }, v: -0.5, a: 0.65, want: '换条路，或者算了' },
  { key: 'calm', label: '平静', p: { relevance: 0.3, congruence: 0.1, novelty: 0.1, certainty: 0.7, control: 0.7, urgency: 0.1 }, v: 0.2, a: 0.12, want: '照原计划走' },
]

const signed = (x) => (clamp(x, -1, 1) + 1) / 2

function distance(a, b) {
  let sum = 0
  let weights = 0
  for (const dim of DIMS) {
    const av = dim === 'congruence' ? signed(a[dim]) : clamp(a[dim])
    const bv = dim === 'congruence' ? signed(b[dim]) : clamp(b[dim])
    const diff = av - bv
    sum += W[dim] * diff * diff
    weights += W[dim]
  }
  return Math.sqrt(sum / Math.max(1e-9, weights))
}

const MOD_BASE = { da: 0.5, ser: 0.55, ne: 0.35, ach: 0.4 }
const MOD_HALF = { da: 8 * 60e3, ser: 45 * 60e3, ne: 12 * 60e3, ach: 20 * 60e3 }

export const MOD_LABELS = { da: '多巴胺', ser: '血清素', ne: '去甲肾上腺素', ach: '乙酰胆碱' }

/**
 * 一条鱼的情绪状态。
 *
 * `pad` 是底色：愉悦 / 唤醒 / 支配。不是「中立」，是「她平时是什么样」——
 * 平静时的落点是它，不是零。零是白纸，鱼不是白纸。
 */
export class Affect {
  constructor({ pad, state } = {}) {
    this.pad = { pleasure: 0.1, arousal: 0.3, dominance: 0.1, ...(pad || {}) }
    const now = Date.now()
    this.valence = this.pad.pleasure
    this.arousal = this.pad.arousal
    this.dominance = this.pad.dominance
    this.mood = { v: this.pad.pleasure, a: this.pad.arousal }
    this.mods = { ...MOD_BASE }
    this.emotion = { key: 'calm', label: '平静', intensity: 0.2, want: '照原计划走', cause: '初始', at: now }
    this.history = []
    this.updatedAt = now
    if (state) this.restore(state)
  }

  /** 什么都没发生时，往哪儿回落。 */
  get baseline() {
    return {
      v: clamp(this.pad.pleasure, -1, 1),
      a: clamp(this.pad.arousal, 0, 1),
      d: clamp(this.pad.dominance, -1, 1),
    }
  }

  /** 时间过去了，情绪自己会退。心情退得慢（四十分钟一档），调质各按自己的半衰期。 */
  decay(now = Date.now()) {
    const dt = Math.max(0, now - this.updatedAt)
    if (dt < 1000) return
    const base = this.baseline
    const moodAlpha = 1 - Math.exp(-dt / (40 * 60e3))
    this.mood.v += (base.v - this.mood.v) * moodAlpha
    this.mood.a += (base.a - this.mood.a) * moodAlpha
    for (const key of Object.keys(this.mods)) {
      this.mods[key] = decayToward(this.mods[key], dt, MOD_HALF[key], MOD_BASE[key])
    }
    const affectAlpha = 1 - Math.exp(-dt / (6 * 60e3))
    this.valence += (this.mood.v - this.valence) * affectAlpha
    this.arousal += (this.mood.a - this.arousal) * affectAlpha
    this.dominance += (base.d - this.dominance) * affectAlpha
    this.updatedAt = now
  }

  /**
   * 评估一件事。给了几个维度就算几个，没给的按「不要紧」算。
   * @param {object} dims
   * @param {{cause?: string, now?: number}} opts
   */
  appraise(dims = {}, { cause = '', now = Date.now() } = {}) {
    this.decay(now)
    const a = {}
    for (const dim of DIMS) {
      const raw = Number(dims[dim])
      const value = Number.isFinite(raw) ? raw : 0
      a[dim] = dim === 'congruence' ? clamp(value, -1, 1) : clamp(value)
    }

    const distances = PROTOTYPES.map((p) => distance(a, p.p))
    const weights = softmax(distances.map((d) => -d / 0.13))
    let best = 0
    for (let i = 1; i < weights.length; i += 1) if (weights[i] > weights[best]) best = i

    const activation = clamp(0.3 * a.relevance + 0.35 * Math.abs(a.congruence) + 0.15 * a.novelty + 0.2 * a.urgency)
    const fit = weights[best]
    const intensity = clamp(activation * (0.45 + 0.55 * fit))

    let emotion
    if (fit < 0.09 || distances[best] > 0.42 || intensity < 0.09) {
      emotion = { key: 'calm', label: '平静', intensity: clamp(0.15 + 0.3 * (0.5 * a.novelty + 0.5 * a.urgency), 0.05, 0.5), want: '照原计划走', cause, at: now }
    } else {
      const proto = PROTOTYPES[best]
      emotion = { key: proto.key, label: proto.label, intensity, want: proto.want, cause, at: now }
    }

    let vTarget = 0
    let aTarget = 0
    for (let i = 0; i < weights.length; i += 1) {
      vTarget += weights[i] * PROTOTYPES[i].v
      aTarget += weights[i] * PROTOTYPES[i].a
    }
    const gain = 0.25 + 0.55 * intensity
    this.valence = clamp(this.valence + (vTarget - this.valence) * gain, -1, 1)
    this.arousal = clamp(this.arousal + (aTarget - this.arousal) * gain, 0, 1)
    const dTarget = 2 * a.control - 1
    this.dominance = clamp(this.dominance + (dTarget - this.dominance) * gain, -1, 1)

    const moodGain = 0.06 + 0.18 * intensity
    this.mood.v = clamp(this.mood.v + (this.valence - this.mood.v) * moodGain, -1, 1)
    this.mood.a = clamp(this.mood.a + (this.arousal - this.mood.a) * moodGain * 0.7, 0, 1)

    // 调质：按「还剩多少余量」加，别让一串事件把某一条钉死在一。
    const rpe = a.congruence * a.relevance
    if (rpe > 0) this.mods.da = clamp(this.mods.da + 0.45 * (1 - this.mods.da) * rpe)
    if (rpe < 0) {
      this.mods.ser = clamp(this.mods.ser + 0.3 * (1 - this.mods.ser) * Math.abs(rpe))
      this.mods.da = clamp(this.mods.da + 0.3 * this.mods.da * rpe)
    }
    if (a.novelty > 0.4 || a.urgency > 0.6) {
      this.mods.ne = clamp(this.mods.ne + 0.35 * (1 - this.mods.ne) * Math.max(a.novelty, a.urgency * 0.8))
    }
    if (a.certainty < 0.45) {
      this.mods.ach = clamp(this.mods.ach + 0.35 * (1 - this.mods.ach) * (0.45 - a.certainty) * 2)
    }

    this.emotion = emotion
    this.updatedAt = now
    this.history.push({ at: now, key: emotion.key, label: emotion.label, intensity: round2(intensity), v: round2(this.valence), a: round2(this.arousal), cause })
    if (this.history.length > 200) this.history.splice(0, this.history.length - 200)
    return this.snapshot(now)
  }

  /** 一件做成/做砸的事。不是评估，是直接给奖赏或惩罚——它不经过「像哪个情绪」那一步。 */
  outcome({ success = true, magnitude = 0.5, cause = '', now = Date.now() } = {}) {
    this.decay(now)
    const m = clamp(magnitude, 0, 1)
    if (success) {
      this.mods.da = clamp(this.mods.da + 0.3 * (1 - this.mods.da) * m)
      this.valence = clamp(this.valence + 0.12 * m, -1, 1)
    } else {
      this.mods.ser = clamp(this.mods.ser + 0.25 * (1 - this.mods.ser) * m)
      this.mods.ne = clamp(this.mods.ne + 0.25 * (1 - this.mods.ne) * m)
      this.mods.da = clamp(this.mods.da - 0.25 * this.mods.da * m)
      this.valence = clamp(this.valence - 0.18 * m, -1, 1)
      this.arousal = clamp(this.arousal + 0.12 * m, 0, 1)
    }
    this.updatedAt = now
    // 成败的情绪不靠距离算法猜：做成就是「高兴／如释重负」，做砸就是「失落／憋住了」。
    // 让 resettle 去挑，会挑出「做成之后感到好奇」这种不像话的结果——
    // 那种结果不是错在算法，是错在**用错了判据**：成败本身已经是判据了。
    const want = success
      ? (m >= 0.6 ? 'joy' : 'relief')
      : (m >= 0.6 ? 'sadness' : 'frustration')
    const proto = PROTOTYPES.find((p) => p.key === want) || PROTOTYPES[PROTOTYPES.length - 1]
    this.emotion = {
      key: proto.key,
      label: proto.label,
      intensity: clamp(0.25 + 0.6 * m),
      want: proto.want,
      cause: cause || this.emotion.cause,
      at: now,
    }
    return this.snapshot(now)
  }

  /**
   * 按现在落在哪儿，认一次情绪。
   *
   * 为什么需要它：`outcome` 不经过评估那一步，只改奖赏和调质。
   * 不重新认一次，就会出现「事情做成了、标签还写着憋住了」——
   * 那种状态比不报情绪更坏：它说的是上一件事。
   */
  resettle(cause = '') {
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < PROTOTYPES.length; i += 1) {
      const p = PROTOTYPES[i]
      const d = (p.v - this.valence) ** 2 + ((p.a - this.arousal) * 1.2) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    const proto = PROTOTYPES[best]
    const intensity = clamp(0.2 + 0.6 * Math.abs(this.valence) + 0.2 * this.arousal)
    this.emotion = {
      key: proto.key,
      label: proto.label,
      intensity,
      want: proto.want,
      cause: cause || this.emotion.cause,
      at: Date.now(),
    }
    return this.emotion
  }

  /** 一句话说清现在什么心情。数字在后面，话在前面——先说得出口，再谈准不准。 */
  describe() {
    const v = this.valence
    const tone = v > 0.35 ? '偏亮' : v > 0.1 ? '略亮' : v < -0.35 ? '发沉' : v < -0.1 ? '略沉' : '不上不下'
    const arousal = this.arousal > 0.65 ? '提着的' : this.arousal > 0.4 ? '半提' : '松的'
    const e = this.emotion
    return `${e.label}（${e.intensity.toFixed(2)}）· 心境${tone}·${arousal}`
  }

  snapshot(now = Date.now()) {
    return {
      valence: round2(this.valence),
      arousal: round2(this.arousal),
      dominance: round2(this.dominance),
      mood: { v: round2(this.mood.v), a: round2(this.mood.a) },
      emotion: { ...this.emotion },
      mods: Object.fromEntries(Object.entries(this.mods).map(([k, v]) => [k, round2(v)])),
      updatedAt: this.updatedAt,
      at: now,
    }
  }

  restore(state) {
    if (!state || typeof state !== 'object') return
    const num = (x, fb) => (typeof x === 'number' && Number.isFinite(x) ? x : fb)
    this.valence = clamp(num(state.valence, this.valence), -1, 1)
    this.arousal = clamp(num(state.arousal, this.arousal), 0, 1)
    this.dominance = clamp(num(state.dominance, this.dominance), -1, 1)
    this.mood.v = clamp(num(state.mood?.v, this.mood.v), -1, 1)
    this.mood.a = clamp(num(state.mood?.a, this.mood.a), 0, 1)
    for (const key of Object.keys(this.mods)) this.mods[key] = clamp(num(state.mods?.[key], this.mods[key]))
    if (state.emotion?.key) this.emotion = { ...this.emotion, ...state.emotion }
    this.updatedAt = num(state.updatedAt, Date.now())
    if (Array.isArray(state.history)) this.history = state.history.slice(-200)
  }

  toJSON() {
    return { ...this.snapshot(), history: this.history }
  }
}
