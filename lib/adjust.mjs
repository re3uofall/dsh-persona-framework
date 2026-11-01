/**
 * 88 调节层 · 四层的最后一层，也是唯一能说话的那一层
 *
 * 前三层（元胞／组织／功能）默认不读字：改状态、落账、一个字不给人格。
 * **调节层不一样。** 它要被人格知道——因为它是「我自己在调我自己」的那一层。
 *
 * 四条职责，一条一个入口：
 *   主体调节  —— 谁在调：权限、范围
 *   价值调节  —— 什么更重要：改权重
 *   批判调节  —— 这一条对不对：抽样复审
 *   反馈调节  —— 负反馈保稳 / 正反馈推进
 *   代谢调节  —— 同化（收进来）／异化（丢出去）／能量（预算）
 *
 * 落点：`.persona-framework/调节.json`
 *
 * **硬边界**：
 *   一、不动人格文件。调节只改「功能怎么看」，不改「我是谁」。
 *   二、不每步都调。确定的直接过，只有「没底」的才送审——不然会炸。
 *   三、调节的结果要能改回来。判过的如果被调节改了，得留下改过的记号。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

export function adjustFile(ws) {
  return join(String(ws || process.cwd()), '.persona-framework', '调节.json')
}

/** 默认：全关。开不开由人说，不由它自己开。 */
export const DEFAULT = {
  on: false,          // 调节层总开关
  canSee: true,       // 人格能不能看到「它在调」——这是必须的，默认开
  canAffect: false,   // 能不能反压前三层
  reviewRate: 0,      // 抽样复审比例（0 = 不审；0.2 = 两成）
  weights: {},        // 价值调节：缺口名 → 权重
  budget: null,       // 代谢：这一轮的额度
}

export function openAdjust(ws) {
  const f = adjustFile(ws)
  let v = {}
  try { v = JSON.parse(readFileSync(f, 'utf8')) } catch { /* 没调过就是默认 */ }
  const cfg = { ...DEFAULT, ...(v && typeof v === 'object' ? v : {}) }
  return { _f: f, _dirty: false, cfg }
}

export function saveAdjust(book) {
  if (!book?._dirty) return 0
  const d = dirname(book._f)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  writeFileSync(book._f, JSON.stringify(book.cfg, null, 2), 'utf8')
  book._dirty = false
  return 1
}

/**
 * 价值调节：改一条的权重。
 * **不删、不改内容**——只改「它有多重」。移出这一格也算（权重 0）。
 */
export function setWeight(book, key, weight, why) {
  const k = String(key || '').trim()
  if (!k) return { ok: false, reason: 'no-key' }
  const w = Number(weight)
  if (!Number.isFinite(w) || w < 0) return { ok: false, reason: 'bad-weight' }
  book.cfg.weights[k] = {
    w,
    why: String(why || '').slice(0, 160),
    at: new Date().toISOString(),
  }
  book._dirty = true
  return { ok: true }
}

/** 取一条的权重；没调过就是 1（不动）。 */
export function weightOf(book, key) {
  const hit = book?.cfg?.weights?.[key]
  return hit ? hit.w : 1
}

/**
 * 批判调节：要不要送审。
 *
 * **不是每次都审**——按比例抽。抽中的才送，抽不中的直接过。
 * 依据：`reviewRate`；率为 0 就全过（默认）。
 */
export function shouldReview(book, key) {
  const rate = Number(book?.cfg?.reviewRate) || 0
  if (rate <= 0) return false
  if (rate >= 1) return true
  // 稳定的抽法：同一个键每一次抽的结果一样，不因跑几次而变
  let h = 0
  const s = String(key || '')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000
  return h / 1000 < rate
}

/**
 * 反馈调节：负反馈保稳 / 正反馈推进。
 *
 * 负反馈：这一轮没出岔子 → 把权重往 1 拉一点（别让它越调越偏）
 * 正反馈：真出了问题 → 权重推远（让下一次更不容易犯）
 */
export function feedback(book, key, ok) {
  const cur = weightOf(book, key)
  const next = ok
    ? cur + (1 - cur) * 0.1   // 往 1 靠
    : cur + (cur >= 1 ? 0.3 : -0.3) // 往两边推
  book.cfg.weights[key] = { w: Math.round(next * 100) / 100, why: ok ? '负反馈' : '正反馈', at: new Date().toISOString() }
  book._dirty = true
  return { ok: true, w: book.cfg.weights[key].w }
}

/* ── 代谢：同化 / 异化 / 能量 ── */

/** 同化：把外面的东西收进来，算成一格。 */
export function assimilate(book, kind, n = 1) {
  book.cfg.intake = book.cfg.intake || {}
  book.cfg.intake[kind] = (book.cfg.intake[kind] || 0) + n
  book._dirty = true
  return { ok: true, n: book.cfg.intake[kind] }
}

/** 异化：把不再用的丢出去。**不删记录，只记「这条不再用」。** */
export function dissimilate(book, key, why) {
  const k = String(key || '').trim()
  if (!k) return { ok: false, reason: 'no-key' }
  book.cfg.out = book.cfg.out || {}
  book.cfg.out[k] = { why: String(why || '').slice(0, 160), at: new Date().toISOString() }
  book._dirty = true
  return { ok: true }
}

/** 能量：这一轮还剩多少额度。给 null 就是不限。 */
export function energy(book, left, total) {
  book.cfg.budget = { left: Number(left) || 0, total: Number(total) || 0, at: new Date().toISOString() }
  book._dirty = true
  return { ok: true }
}

/**
 * 一轮跑完。
 *
 * **调节层唯一允许说话的层**：它得让人格知道「我在调」。
 * 但说的只有状态，不是解释——`调：开／关｜改了 N 条｜审了 M 条`。
 */
export function adjustStep(ws, opts = {}) {
  const book = openAdjust(ws)
  const saved = saveAdjust(book)
  const weights = Object.keys(book.cfg.weights || {}).length
  const out = []
  // **只有开着，才说。** 关着就一个字不给。
  if (book.cfg.on) {
    out.push(`调节：开｜改过 ${weights} 条权重`)
    if (book.cfg.canAffect) out.push('反压前三层：允许')
  }
  return {
    did: [], out, cant: [],
    wrote: saved,
    on: book.cfg.on,
    effects: weights,
  }
}
