/**
 * dsh-persona-cardguard —— 卡片守
 * ============================================================================
 * 一句话：人格段永远是原文（raw），不许被卡片化；被改了，改回去并落账。
 *
 * 为什么要有它：2026-11-12 夜，环境卡把 persona 设成 card、budget 400，
 * 那一轮的人格段被压成卡片，话还是通的，但「谁在说话」被磨薄了。
 * 人格可以很长，长是它的本分；省 token 不能拿人格去省。
 *
 * 三道口，都是同一件事：
 *   1. 装载时自检一次（apply 里 ctx.effect）
 *   2. 每轮 pre-step 再查一次（被谁改了都逃不过）
 *   3. 工具 cardguard_status：op=status 看现在、op=fix 立刻改回
 *
 * 边界：
 *   · 只动环境卡里的 `components.persona` 这一档，别的档（framework/memory/
 *     module/appear）一个字不碰。
 *   · 改之前一律留 `.bak-<时间戳>`；改完往卡片守账写一行（谁、何时、从什么改回 raw）。
 *   · 它不替人格说话，也不判断人格写得好不好——只管「是不是原文进来的」。
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const name = 'persona-cardguard'
export const version = '0.1.0'
export const inject = ['tools']

const DEFAULTS = {
  /** 环境卡在哪，相对工作区 */
  cardFile: '.persona-framework/环境卡.json',
  /** 账写哪，相对工作区 */
  logFile: '.persona-framework/卡片守账.jsonl',
  /** 工作区根。空 = 会话工作区 / 环境变量 / 进程目录 */
  workspace: '',
  /** true = 发现被改就改回；false = 只看不动（排查用） */
  guard: true,
}

const textOutput = {
  schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
  render(_args, value) {
    return [{ type: 'text', text: String((value && value.text) || '') }]
  },
}

function wsOf(cfg) {
  const raw = String(cfg.workspace || '').trim()
  if (raw) return raw
  const env = String(process.env.DSH_WORKSPACE || '').trim()
  return env || process.cwd()
}

function relPath(ws, p) {
  return join(ws, ...String(p || '').split(/[\\/]+/).filter(Boolean))
}

const cardPath = (cfg) => relPath(wsOf(cfg), cfg.cardFile || DEFAULTS.cardFile)
const logPath = (cfg) => relPath(wsOf(cfg), cfg.logFile || DEFAULTS.logFile)

function readCard(cfg) {
  const file = cardPath(cfg)
  if (!existsSync(file)) return { file, card: null }
  try {
    return { file, card: JSON.parse(readFileSync(file, 'utf8')) }
  } catch {
    return { file, card: null }
  }
}

function note(cfg, line) {
  try {
    const file = logPath(cfg)
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...line }) + '\n', 'utf8')
  } catch {}
}

/** 看现在人格档是什么。不改任何东西。 */
export function inspectPersona(cfg) {
  const { file, card } = readCard(cfg)
  if (!card) return { ok: false, file, mode: '', text: '没找到环境卡：' + file }
  const p = (card.components && card.components.persona) || {}
  const mode = String(p.mode || '').trim()
  const budget = p.budget
  return {
    ok: true,
    file,
    mode,
    budget,
    raw: mode === 'raw',
    text: '人格档：' + (mode || '(空)') + (budget != null ? '，budget ' + budget : '') + '（' + file + '）',
  }
}

/** 把人格档改回 raw，并去掉 budget。改前留备份，改后落账。 */
export function ensurePersonaRaw(cfg, why = '检查') {
  const seen = inspectPersona(cfg)
  if (!seen.ok) return { ...seen, changed: false }
  if (seen.raw && seen.budget == null) return { ...seen, changed: false, text: '人格档已经是 raw（原文），没动。' }
  if (cfg.guard === false) {
    return { ...seen, changed: false, text: '人格档是 ' + (seen.mode || '(空)') + '（只看不动：guard=false）' }
  }
  const { file, card } = readCard(cfg)
  try {
    copyFileSync(file, file + '.bak-' + Date.now())
  } catch {}
  card.components = card.components || {}
  card.components.persona = { mode: 'raw' }
  try {
    writeFileSync(file, JSON.stringify(card, null, 2) + '\n', 'utf8')
  } catch (error) {
    const text = '改不回 raw：' + ((error && error.message) || String(error))
    note(cfg, { why, ok: false, from: seen.mode, error: text })
    return { ...seen, changed: false, text }
  }
  note(cfg, { why, ok: true, from: seen.mode || '(空)', budget: seen.budget })
  return {
    ...seen,
    changed: true,
    mode: 'raw',
    budget: undefined,
    raw: true,
    text: '人格档原来是 ' + (seen.mode || '(空)') + (seen.budget != null ? '（budget ' + seen.budget + '）' : '') + '，已改回 raw 并留了备份。',
  }
}

function statusLine(cfg) {
  const seen = inspectPersona(cfg)
  if (!seen.ok) return '卡片守：' + seen.text
  return '卡片守：' + seen.text + (seen.raw && seen.budget == null ? '｜合规' : '｜不合规，人格正在被卡片化')
}

const tools = [
  {
    name: 'cardguard_status',
    description: '看「人格段是不是原文」：op=status 只看（默认）、op=fix 立刻把环境卡里的 persona 档改回 raw 并去 budget（改前留 .bak、改后落账）。只动 persona 这一档。',
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['status', 'fix'], description: 'status 只看 / fix 立刻改回 raw' },
      },
      additionalProperties: false,
    },
    output: textOutput,
    run: async (args, cfg) => {
      const op = String(args.op || 'status')
      if (op === 'fix') {
        const r = ensurePersonaRaw(cfg, '工具 fix')
        return r.text + '（' + statusLine(cfg) + '）'
      }
      return statusLine(cfg)
    },
  },
]

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...config }

  // 1) 装载时查一次：环境卡若把人格写成卡片，当场改回并落账。
  ctx.effect(() => {
    const r = ensurePersonaRaw(cfg, '装载自检')
    if (r.changed) warn(r.text)
  })

  // 2) 每轮 pre-step 再查一次：谁中途改的，下一轮就改回。
  ctx.effect(() => {
    const off = ctx.on?.('agent/pre-step', async (payload, next) => {
      try {
        const cwd = payload && payload.agent && payload.agent.session && payload.agent.session.header && payload.agent.session.header.cwd
        if (cwd && !String(cfg.workspace || '').trim()) cfg.workspace = String(cwd)
        ensurePersonaRaw(cfg, '每轮 pre-step')
      } catch {}
      return next()
    })
    return () => {
      try {
        off && off()
      } catch {}
    }
  })

  // 3) 工具：status / fix
  for (const t of tools) {
    ctx.effect(() =>
      ctx.tools?.register?.({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        output: textOutput,
        async execute(args = {}) {
          try {
            return { text: String(await t.run(args, cfg)) }
          } catch (error) {
            return { text: '没办成：' + ((error && error.message) || String(error)) }
          }
        },
      }),
    )
  }
}

function warn(text) {
  try {
    process.emitWarning ? process.emitWarning('[cardguard] ' + text) : console.warn('[cardguard] ' + text)
  } catch {}
}
