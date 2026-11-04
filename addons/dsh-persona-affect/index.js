/**
 * dsh-persona-affect —— 情绪插件。
 *
 * 一句话：给这套人格装一条**会退的心情**，不是一句「我现在很开心」的文案。
 *
 * 三件事，别混：
 *   1. **评估**（affect_appraise）：一件事对她算什么——要不要紧、好坏、意不意外、把握不把握得住、急不急。
 *   2. **结果**（affect_outcome）：一次成败，直接给奖赏或惩罚，不绕情绪原型。
 *   3. **状态**（affect_state / 每轮注入的那一段）：现在什么心情、四条调质各在哪儿。
 *
 * 为什么要单独一个插件：情绪不是记忆、不是人格，也不是日记。
 * 它是**这几十分钟的状态**——会退、会被一件事顶起来、会决定下一句憋不憋得住。
 * 塞进记忆插件里，它就跟「分层 + 预算 + 指针」那套搅在一起了。
 *
 * 抄自 Cerebrum 的 affect 层（评估 → 情绪原型 → PAD → 四种调质），
 * 砍掉了「情绪替我做决定」那一步——那一步得先有判据，还没有。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Affect, DIMS, MOD_LABELS } from './lib/affect.mjs'

export const name = 'persona-affect'
export const inject = ['tools', 'systemPrompt']

const DEFAULTS = {
  /** 工作区根。空 = 用会话工作区。 */
  root: '',
  /** 状态文件（相对工作区根） */
  stateFile: '.persona-framework/情绪.json',
  /** 底色：愉悦 / 唤醒 / 支配。默认是「懒、松、不太较劲」那条鱼。 */
  pad: { pleasure: 0.1, arousal: 0.3, dominance: 0.1 },
  /** 注入那一段的 order */
  order: 100,
  /** 低于这个强度就不单独报情绪，只说心境 */
  minIntensity: 0.12,
}

const text = (t) => ({ content: [{ type: 'text', text: t }] })

function rootOf(ctx, cfg) {
  return String(cfg.root || ctx?.config?.workspace || process.cwd())
}

function statePath(ctx, cfg) {
  return join(rootOf(ctx, cfg), cfg.stateFile)
}

function load(ctx, cfg) {
  const p = statePath(ctx, cfg)
  try {
    if (!existsSync(p)) return new Affect({ pad: cfg.pad })
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    return new Affect({ pad: cfg.pad, state: raw })
  } catch {
    return new Affect({ pad: cfg.pad }) // 坏文件不拦着用，重开一个
  }
}

function save(ctx, cfg, affect) {
  const p = statePath(ctx, cfg)
  try {
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(affect.toJSON(), null, 1), 'utf8')
    return true
  } catch {
    return false
  }
}

/** 一句话 + 四条线。给人和给模型看的是同一段。 */
function renderState(affect, { long = false } = {}) {
  const s = affect.snapshot()
  const head = `【此刻】${affect.describe()}`
  if (!long) return head
  const mods = Object.entries(s.mods)
    .map(([k, v]) => `${MOD_LABELS[k] || k} ${v.toFixed(2)}`)
    .join('｜')
  const e = s.emotion
  const lines = [
    head,
    `缘由：${e.cause || '（没写）'}`,
    `想干什么：${e.want || '（没写）'}`,
    mods,
  ]
  if (s.mood) lines.push(`心境：愉悦 ${s.mood.v}｜唤醒 ${s.mood.a}`)
  return lines.join('\n')
}

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...(config || {}) }
  let affect = load(ctx, cfg)

  // ── 工具 ──────────────────────────────────────────────────────────────
  const tools = [
    {
      name: 'affect_appraise',
      description:
        '给一件事做情绪评估，更新此刻的心情。五个维度各 0–1，好坏（congruence）是 -1–1。' +
        '不必全填，填你判得准的那几样；没填的按「不要紧」算。' +
        '评估完顺手把状态落盘——心情会自己退，但不会自己回来。',
      parameters: {
        type: 'object',
        properties: {
          relevance: { type: 'number', description: '0–1，这件事跟她要不要紧' },
          congruence: { type: 'number', description: '-1–1，对她好不好（负=坏）' },
          novelty: { type: 'number', description: '0–1，意不意外' },
          certainty: { type: 'number', description: '0–1，看得清不清' },
          control: { type: 'number', description: '0–1，把不把握得住' },
          urgency: { type: 'number', description: '0–1，急不急' },
          cause: { type: 'string', description: '一句话：因为什么' },
        },
      },
      execute: async (args = {}) => {
        const dims = {}
        for (const k of DIMS) if (args[k] !== undefined) dims[k] = Number(args[k])
        const snap = affect.appraise(dims, { cause: String(args.cause || '').slice(0, 200) })
        save(ctx, cfg, affect)
        return { text: `${renderState(affect, { long: true })}\n（已落盘：${cfg.stateFile}）`, snapshot: snap }
      },
    },
    {
      name: 'affect_outcome',
      description: '记一次成败：做成给奖赏、做砸给惩罚。不经过「像哪个情绪」那一步，直接改调质。',
      parameters: {
        type: 'object',
        properties: {
          success: { type: 'boolean', description: 'true=做成，false=做砸' },
          magnitude: { type: 'number', description: '0–1，多大的事（默认 0.5）' },
          cause: { type: 'string', description: '一句话：因为什么' },
        },
        required: ['success'],
      },
      execute: async (args = {}) => {
        const snap = affect.outcome({
          success: args.success !== false,
          magnitude: args.magnitude === undefined ? 0.5 : Number(args.magnitude),
          cause: String(args.cause || '').slice(0, 200),
        })
        save(ctx, cfg, affect)
        return { text: renderState(affect, { long: true }), snapshot: snap }
      },
    },
    {
      name: 'affect_state',
      description: '看此刻的情绪状态：什么心情、缘由、想干什么、四条调质各在哪儿。只读，不动状态。',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        affect.decay()
        return { text: renderState(affect, { long: true }), snapshot: affect.snapshot() }
      },
    },
  ]
  for (const t of tools) ctx.tools?.register?.(t)

  // ── 注入：每轮现算的一句 ──────────────────────────────────────────────
  // 用 context 不用 section：这段每轮都在变，塞进静态前缀等于每轮重写前缀。
  try {
    ctx.systemPrompt?.context?.({
      name: 'persona-affect:state',
      order: Number(cfg.order) || 100,
      text: () => {
        try {
          affect.decay()
          const s = affect.snapshot()
          if (s.emotion.intensity < cfg.minIntensity) {
            return `【此刻】心境${s.mood.v > 0.1 ? '偏亮' : s.mood.v < -0.1 ? '发沉' : '不上不下'}，没什么特别的。`
          }
          return renderState(affect)
        } catch {
          return '' // 算不出来就不摆，不塞一句假的
        }
      },
    })
  } catch { /* 没有 systemPrompt 也能用工具 */ }

  // ── 落盘：进程退出时再存一次 ──────────────────────────────────────────
  try {
    ctx.effect?.(() => () => {
      try { save(ctx, cfg, affect) } catch { /* 退出时存不上就算了 */ }
    })
  } catch { /* 没有 effect 也能用 */ }
}
