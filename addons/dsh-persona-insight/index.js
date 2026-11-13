import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { panelHandler } from './lib/panel.mjs'
import { join } from 'node:path'

/**
 * dsh-persona-insight —— 感悟
 * ============================================================================
 * 一句话：不是判断，是非理性的体会。
 *
 * 和邻居的分界：
 *   · 日记——我怎么想、怎么过来的，有成形的心思；
 *   · 成果——交出去的判断，站得住才写；
 *   · 感悟——随心的、说不清理由的那一下，可以只写半句。
 *
 * 它不注册注入段：不调就没有；调了才落一行。
 * ============================================================================
 */

export const name = 'persona-insight'
export const version = '0.1.0'
export const inject = ['tools', 'webServer']

const DEFAULTS = {
  /** 感悟目录（相对工作区）。 */
  dir: 'persona-ai/growth/感悟',
  /** 会话工作区缓存。 */
  sessionWs: '',
}

function rootOf(cfg) {
  return String(cfg.workspace || '').trim() || String(cfg.sessionWs || '').trim() || String(process.env.DSH_WORKSPACE || '').trim() || process.cwd()
}
function dirOf(cfg) {
  return join(rootOf(cfg), String(cfg.dir || DEFAULTS.dir).replace(/^[\\/]+/, ''))
}
function pad(n) { return String(n).padStart(2, '0') }
function today() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) }
function nowHm() { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()) }
function fileOf(cfg, day) { return join(dirOf(cfg), (day || today()) + '.md') }
const textOutput = {
  schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
  render(_args, value) { return [{ type: 'text', text: String(value && value.text ? value.text : '') }] },
}

const tools = [
  {
    name: 'insight_write',
    description: '记一条感悟：不是判断，是非理性的体会——随心的、说不清理由的那一下。落到 persona-ai/growth/感悟/YYYY-MM-DD.md。一次一条，写完不改旧条。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '感悟正文。一两句就够，不必论证。' },
        kind: { type: 'string', description: '可选：这一条是哪一类。体会／心得／感触／念头／感慨／顿悟／写作感悟……等等，不限于这些；不给就记「体会」。' },
        mood: { type: 'string', description: '可选：那一下的气味（如 沉、亮、堵、松）。' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    output: textOutput,
    run: async (args, cfg) => {
      const body = String(args.text || '').trim()
      if (!body) return '没写：感悟正文是空的。'
      const dir = dirOf(cfg)
      mkdirSync(dir, { recursive: true })
      const file = fileOf(cfg)
      const head = existsSync(file) ? '' : '# 感悟 · ' + today() + '\n\n> 不是判断，是非理性的体会。\n\n'
      const kind = String(args.kind || '体会').trim() || '体会'
      const mood = String(args.mood || '').trim()
      appendFileSync(file, head + '### ' + nowHm() + ' · ' + kind + (mood ? '（' + mood + '）' : '') + '\n\n' + body + '\n\n', 'utf8')
      return '落了一笔：' + file + '\n' + nowHm() + ' · ' + body.slice(0, 40)
    },
  },
  {
    name: 'insight_list',
    description: '最近几条感悟：按天倒序，只列开头。要看全文用 insight_read。',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number', description: '最多几条，默认 12。' } },
      additionalProperties: false,
    },
    output: textOutput,
    run: async (args, cfg) => {
      const dir = dirOf(cfg)
      if (!existsSync(dir)) return '感悟目录还空着：' + dir
      const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort().reverse().slice(0, 30)
      if (!files.length) return '感悟还一条没有。'
      const limit = Math.max(1, Math.min(50, Number(args.limit) || 12))
      const out = []
      for (const f of files) {
        const lines = readFileSync(join(dir, f), 'utf8').split(/\r?\n/)
        for (let i = 0; i < lines.length; i++) {
          const m = /^### (.+)$/.exec(lines[i].trim())
          if (!m) continue
          const body = lines.slice(i + 1).find((l) => l.trim() && !l.startsWith('#')) || ''
          out.push(f.replace(/\.md$/, '') + ' ' + m[1] + ' — ' + body.trim().slice(0, 50))
        }
        if (out.length >= limit) break
      }
      return out.length ? '最近 ' + Math.min(limit, out.length) + ' 条：\n' + out.slice(0, limit).join('\n') : '感悟还一条没有。'
    },
  },
  {
    name: 'insight_read',
    description: '按天取感悟全文（day 形如 2026-11-12，默认今天）。',
    parameters: {
      type: 'object',
      properties: { day: { type: 'string', description: '哪一天，YYYY-MM-DD，默认今天。' } },
      additionalProperties: false,
    },
    output: textOutput,
    run: async (args, cfg) => {
      const day = String(args.day || '').trim() || today()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '日子要长成 YYYY-MM-DD，收到的是：' + day
      const file = fileOf(cfg, day)
      if (!existsSync(file)) return day + ' 没有感悟。'
      return file + '\n\n' + readFileSync(file, 'utf8')
    },
  },
]

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...config }
  // 左栏面板的数据口（师父 m02961）
  ctx.effect(() => ctx.webServer?.register?.({ kind: 'exact', path: '/api/persona-insight', handler: panelHandler(cfg) }))
  // 会话工作区：pre-step 时从 agent.session.header.cwd 取。
  ctx.effect(() => {
    const off = ctx.on?.('agent/pre-step', async (payload, next) => {
      try {
        const cwd = payload && payload.agent && payload.agent.session && payload.agent.session.header && payload.agent.session.header.cwd
        if (cwd) cfg.sessionWs = String(cwd)
      } catch {}
      return next()
    })
    return () => { try { off && off() } catch {} }
  })
  for (const t of tools) {
    ctx.effect(() => ctx.tools.register({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      output: t.output,
      execute: async (args = {}) => {
        try { return { text: String(await t.run(args, cfg)) } } catch (error) {
          return { text: '没办成：' + ((error && error.message) || String(error)) }
        }
      },
    }))
  }
}
