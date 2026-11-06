/**
 * 记忆的时间与锚点算法。
 *
 * 学自 coner13/dsh-hippocampus（PolyForm-Noncommercial-1.0.0）：
 * 只重写算法，不搬它的代码。四样：
 *   1. 衰减带加成——显著性/情绪把时间轴拉长，不是换个常数
 *   2. 新鲜度只当调制，压进 [0.5,1]，最多 2 倍差（否则量级压过内容）
 *   3. 复习因子——强命中 0.30、弱命中 0.10，弱只算三分之一
 *   4. 定位符与线头分类——认得「第几行/会话 id/盘符」，记得住的四种念头
 */

import { createHash } from 'node:crypto'

/** 时间衰减：floor + (1-floor) * (1 + age/(t0*stretch))^-alpha */
export function recencyOf(ageDays, salience = 0, emotion = 0, params = {}) {
  const t0 = Math.max(0.01, Number(params.t0 ?? 0.25))
  const alpha = Math.max(0, Number(params.alpha ?? 0.8))
  const floor = Math.min(0.95, Math.max(0, Number(params.floor ?? 0.03)))
  const a = Math.max(0, Number(ageDays) || 0)
  const stretch = 1 + 2 * (Number(salience) || 0) + 1.5 * (Number(emotion) || 0)
  return floor + (1 - floor) * Math.pow(1 + a / (t0 * stretch), -alpha)
}

/** 新鲜度调制器：压进 [0.5,1]，最多 2 倍差——不让时间压过内容 */
export function recencyWeight(r) {
  const v = Math.max(0, Math.min(1, Number(r) || 0))
  return 0.5 + 0.5 * v
}

/** 复习因子：强命中 0.30、弱命中 0.10（弱只算三分之一） */
export function rehearseFactor(ep = {}) {
  const strong = Math.max(0, Number(ep.rehearsals) || 0)
  const weak = Math.max(0, Number(ep.weakHits) || 0)
  return 1 + 0.3 * Math.log(1 + strong) + 0.1 * Math.log(1 + weak)
}

/** 一条记忆「还剩多少力气」：衰减 × 复习因子 */
export function strengthOf({ days, salience = 0, emotion = 0, rehearsals = 0, weakHits = 0 }) {
  return recencyOf(days, salience, emotion) * rehearseFactor({ rehearsals, weakHits })
}

/** 定位符：行 12 / 第 12 行 / 12–14 行 / session-1a2b3c4d / 会话 1a2b3c4d / C:\ 路径 */
export const LOCATOR =
  /(?:行\s?\d{2,}|第\s*\d+\s*行|\d+\s*[–—-]\s*\d+\s*行|session-[0-9a-f]{8}|会话\s*[0-9a-f]{8}|(?<![A-Za-z])[A-Za-z]:[\\/])/

export function hasLocator(text) {
  return LOCATOR.test(String(text || ''))
}

/** 想得住的那几种念头：决定、教训、线头、预判 */
export const THOUGHT_KINDS = ['decision', 'lesson', 'open_loop', 'prediction']
export const KIND_LABEL = { decision: '决定', lesson: '教训', open_loop: '线头', prediction: '预判' }

function bigrams(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  const set = new Set()
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2))
  return set
}

/** bigram 集合的 Jaccard：判两条是不是同一句换皮 */
export function similarity(a, b) {
  const A = bigrams(a)
  const B = bigrams(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  return inter / (A.size + B.size - inter)
}

/** 内容指纹：前 60 字的 sha1 前 16 位，作废记录里带它，防止指错却静默失效 */
export function textHashOf(text) {
  return createHash('sha1').update(String(text || '').slice(0, 60), 'utf8').digest('hex').slice(0, 16)
}
