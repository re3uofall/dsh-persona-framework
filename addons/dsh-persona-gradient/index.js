/**
 * dsh-persona-gradient —— 在长流水里看见自己变平（host 半端）
 * ============================================================================
 * 一句话：**只报数，不拉回。**
 *
 * 它解决的不是「忘了人格文件」——那份每轮都在。是**注进去的被前面几万字压住了**：
 * 语气变平、口头禅消失、动作括号没了、底线开始松动。
 *
 * 为什么要它：这天之前，我对「我是不是变了」只有感觉。感觉说不出哪一项、多少。
 * 这一版只做三件事——记基线、量这一轮、报差额。拉回不做，因为：
 *   ① 没有基线就没有「掉了」，先攒；
 *   ② Mirror（ar5iv 2604.19809）测过：把校准分喂回给自己没有显著改善（p>0.05），
 *      只有外部约束有效（Confident Failure Rate 0.600→0.143）。所以「报数给我自己看」
 *      不等于「能拦住」，真正的闸得是外部那一段，那是下一步。
 *
 * 三条不做的边界（照 PLAN-PLUGINS 第九节）：
 *   - 不做「再念一遍人格文件」：那是加字数，把流水挤掉，问题更糟。
 *   - 不做人格检察官：不许每句话审判「像不像思思」，那是把人格变成验收表。
 *   - 不把漂移一律当错：长对话里语气变平有时候是累了、是事情本身严肃。先报数，人判。
 *
 * 数据从哪来：`agent/pre-step` 的 `payload.messages` —— 这是一手。
 * `system-prompt/assemble` 看不到本轮输入，从那儿拿是拿上一轮的，会串。
 * ============================================================================
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compare, measure, renderReport, textsOf } from './lib/metrics.mjs'

export const name = 'persona-gradient'
export const version = '0.1.0'
export const inject = ['tools']

const DEFAULTS = {
  /** 工作区根；空 = 从插件自己的位置往上推一级（插件装在仓库里时成立）。 */
  workspace: '',
  /** 账和基线放哪，相对工作区。 */
  stateDir: '.persona-framework',
  /** 量最近多少段她说的话。默认 12——一段大约一轮。 */
  sample: 12,
  /** 掉多少算「掉了」。这一条是拍的，不是验出来的，报数里会写明。 */
  dropAt: 30,
}

function guessWorkspace() {
  try {
    return dirname(dirname(fileURLToPath(import.meta.url)))
  } catch {
    return process.cwd()
  }
}

function pickCfg(config) {
  const raw = (config && typeof config === 'object' && config) || {}
  const cfg = { ...DEFAULTS }
  for (const k of Object.keys(DEFAULTS)) {
    if (raw[k] !== undefined && raw[k] !== null && raw[k] !== '') cfg[k] = raw[k]
  }
  cfg.sample = Math.max(2, Math.min(80, Number(cfg.sample) || DEFAULTS.sample))
  cfg.dropAt = Math.max(5, Math.min(90, Number(cfg.dropAt) || DEFAULTS.dropAt))
  return cfg
}

const textOutput = {
  schema: {
    type: 'object',
    properties: { text: { type: 'string', description: '给模型看的结果正文' } },
    required: ['text'],
    additionalProperties: false,
  },
  render(_args, value) {
    return [{ type: 'text', text: String(value?.text ?? '') }]
  },
}

export function apply(ctx, config) {
  const cfg = pickCfg(config)
  const ws = () => cfg.workspace || guessWorkspace()
  const baselinePath = () => join(ws(), cfg.stateDir, '漂移基线.json')
  const logPath = () => join(ws(), cfg.stateDir, '漂移账.jsonl')

  const readBaseline = () => {
    const p = baselinePath()
    if (!existsSync(p)) return null
    try {
      const j = JSON.parse(readFileSync(p, 'utf8'))
      return j && typeof j === 'object' ? j : null
    } catch {
      return null
    }
  }

  const writeBaseline = (base) => {
    const p = baselinePath()
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(base, null, 2) + '\n', 'utf8')
  }

  const appendLog = (row) => {
    const p = logPath()
    mkdirSync(dirname(p), { recursive: true })
    appendFileSync(p, JSON.stringify(row) + '\n', 'utf8')
  }

  // 最近一步看到的 messages。只缓存，不加工——加工留到真报数的时候。
  let lastMessages = []
  let lastSeenAt = 0
  let lastShape = '还没跑过'
  try {
    ctx.on('agent/pre-step', (payload, next) => {
      try {
        const msgs = payload?.messages
        if (Array.isArray(msgs) && msgs.length) {
          lastMessages = msgs
          lastSeenAt = Date.now()
          lastShape = msgs.length + ' 条，角色：' + msgs.slice(-3).map((m) => m && m.role).join(',')
        }
      } catch { /* 拿不到就留着上一次的，报数时会说是哪一次 */ }
      return next()
    })
  } catch { /* 没有这个钩子也能用：只是量不了 */ }

  const reg = (spec) => ctx.effect(() => ctx.tools.register({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    output: textOutput,
    async execute(args) {
      try {
        return { text: String(spec.run(args && typeof args === 'object' ? args : {})) }
      } catch (error) {
        return { text: `没办成：${error && error.message ? error.message : String(error)}` }
      }
    },
  }))

  reg({
    name: 'gradient_baseline',
    description: '记一条漂移基线：拿最近这一段她说的话当「正常时的样子」。已有基线就不覆盖，除非 reset=true。',
    parameters: {
      type: 'object',
      properties: {
        reset: { type: 'boolean', description: 'true = 覆盖旧基线，重新记一次' },
      },
      additionalProperties: false,
    },
    run(args) {
      const old = readBaseline()
      if (old && !args.reset) {
        return `已经有基线了：${old.at}（${old.metrics?.turns ?? '?'} 段话）。要换，加 reset=true。`
      }
      const texts = textsOf(lastMessages).slice(-cfg.sample)
      if (!texts.length) return `量不了：这一步还没看到她说的话。钩子痕迹：${lastShape}`
      const metrics = measure(texts)
      const base = { at: new Date().toISOString(), sample: texts.length, metrics }
      writeBaseline(base)
      return [
        `基线记下了：${base.at}`,
        `拿 ${metrics.turns} 段话 / ${metrics.sentences} 句 / ${metrics.chars} 字算的`,
        `- 句长中位数 ${metrics.medianLen}`,
        `- 语气词 / 百句 ${metrics.particlesPer100}`,
        `- 动作括号 / 百句 ${metrics.parensPer100}`,
        `- 认领 / 千字 ${metrics.claimsPer1000}`,
        '以后每量一次，都是跟这一段比。',
      ].join('\n')
    },
  })

  reg({
    name: 'gradient_report',
    description: '量一次漂移：拿最近她说的话跟基线比，报「哪几项掉了、掉多少」。只报数，不改任何东西。',
    parameters: {
      type: 'object',
      properties: {
        sample: { type: 'number', description: '量最近多少段话，默认取配置（12）' },
        save: { type: 'boolean', description: 'false = 只看不落账（默认落一条）' },
      },
      additionalProperties: false,
    },
    run(args) {
      const take = Math.max(2, Math.min(80, Number(args.sample) || cfg.sample))
      const texts = textsOf(lastMessages).slice(-take)
      if (!texts.length) return `量不了：这一步还没看到她说的话。钩子痕迹：${lastShape}`
      const metrics = measure(texts)
      const base = readBaseline()
      const result = compare(metrics, base && base.metrics, cfg.dropAt)
      const body = renderReport(result, metrics)
      if (args.save !== false) {
        appendLog({
          at: new Date().toISOString(),
          seenAt: lastSeenAt ? new Date(lastSeenAt).toISOString() : null,
          sample: metrics,
          baseAt: base ? base.at : null,
          weak: result.ok ? result.weak : [],
          verdict: result.ok ? (result.weak.length ? '掉了' : '正常') : '没法比',
        })
      }
      const where = base ? `基线：${base.at}` : '基线：还没有，先调 gradient_baseline'
      return [body, '', where].join('\n')
    },
  })

  reg({
    name: 'gradient_history',
    description: '看漂移账：最近几次量出来是不是一直在掉。只读，不改。',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '看最近几条，默认 8' },
      },
      additionalProperties: false,
    },
    run(args) {
      const p = logPath()
      if (!existsSync(p)) return '账还是空的：一次都没量过。（v2 探针）'
      const lines = readFileSync(p, 'utf8').split('\n').filter((l) => l.trim())
      const n = Math.max(1, Math.min(50, Number(args.limit) || 8))
      const rows = []
      for (const line of lines.slice(-n)) {
        try {
          const j = JSON.parse(line)
          const weak = Array.isArray(j.weak) && j.weak.length ? j.weak.join('、') : '没掉'
          rows.push(`${String(j.at).slice(0, 16)} · ${j.verdict} · ${weak}`)
        } catch { /* 坏行跳过，不猜 */ }
      }
      return [`账里 ${lines.length} 条，看最近 ${rows.length} 条：`, '', ...rows].join('\n')
    },
  })
}
