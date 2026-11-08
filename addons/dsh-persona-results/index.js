/**
 * dsh-persona-results —— host 半端
 * ============================================================================
 * 一句话：把人格自己认的思考成果收进一条账本，再摆到侧栏面板上。
 *
 * 它做三件事：
 *   1. **收**：她调 `result_write` 交一条（标题、类型、正文），追加进
 *      `persona-ai/growth/成果/成果.jsonl`，一行一条，不重写旧行。
 *   2. **看**：`/api/persona-results` 把账本吐成 JSON，侧栏的「成果」面板 fetch 它。
 *   3. **提醒**：每轮在提示词里挂一小段——想住了一个判断再交，别交流水账。
 *
 * 只写自己的成果文件；v3.1 人格原稿一个字不动。
 * 配置全部走 `cordis.patch.yml` 里这一行的 `config`（见 README）。
 * ============================================================================
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { findItem, renderSearch, renderShow, searchItems } from './lib/query.mjs'
import { dirname, join } from 'node:path'

export const name = 'dsh-persona-results'
export const inject = ['tools', 'webServer', 'systemPrompt']

/** 默认值。任何一条都能在 patch 的 `config` 里改。 */
const DEFAULTS = {
  /** 人格根目录（`persona-ai` 那一层）。空 = 从会话工作区推。 */
  personaDir: '',
  /** 成果账本，相对人格根目录 */
  resultsFile: 'growth/成果/成果.jsonl',
  /** 面板最多显示多少条 */
  maxEntries: 500,
  /** 单条正文上限（字） */
  maxBodyChars: 12000,
  /** 每轮附「什么时候该交」说明 */
  injectPrompt: true,
}

const KINDS = ['判断', '骨架', '概念', '反驳', '问题', '杂记']

const GUIDE = `## 成果（写给自己，不是台词）

- 一段话里真正想住了一个判断、一副骨架、一个概念，就调 result_write 交一条：标题一句，正文写「骨架 / 判断 / 还欠什么」，别交过程流水账。
- 一次只交一条。不确定算不算成果，就先不交；交少了不丢人，交水了才丢人。
- 交过的别重复交；要改，就交一条新的，旧的留着当脚印。
- 交完不用在回复里汇报「我记下了」，长在面板里就够了。`

const int = (v, min, max, fallback) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

const errText = (error) => (error && error.message ? error.message : String(error))
const clip = (text, max) => {
  const s = String(text ?? '').trim()
  return s.length > max ? s.slice(0, max) : s
}

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...(config && typeof config === 'object' ? config : {}) }
  cfg.maxEntries = int(cfg.maxEntries, 1, 5000, 500)
  cfg.maxBodyChars = int(cfg.maxBodyChars, 200, 60000, 12000)
  cfg.injectPrompt = cfg.injectPrompt !== false

  const warn = (error) => {
    try { console.warn('[dsh-persona-results]', errText(error)) } catch { /* 控制台都没了就算了 */ }
  }

  /** 人格目录：显式配置 > 环境变量 > 会话工作区下的 persona-ai。 */
  const resolveDir = () => {
    const tries = []
    if (cfg.personaDir) tries.push(String(cfg.personaDir))
    if (process.env.DSH_PERSONA_DIR) tries.push(process.env.DSH_PERSONA_DIR)
    try {
      // ★ 服务名不止一个：memory 那半用 workspace，这里原来只试 workingDirectory。
      //   换环境时若只有其中一个，另一边就取不到目录——所以两个都试，兜底 process.cwd()。
      const ws = ctx.get('workspace')
      if (typeof ws === 'string' && ws) tries.push(join(ws, 'persona-ai'))
      else if (ws?.cwd) tries.push(join(ws.cwd, 'persona-ai'))
    } catch { /* 没这个服务 */ }
    try {
      const wd = ctx.get('workingDirectory')?.defaultDirectory
      if (wd) tries.push(join(wd, 'persona-ai'))
    } catch { /* 没有这个服务就靠前两条 */ }
    tries.push(join(process.cwd(), 'persona-ai'))
    const hit = tries.find((d) => d && existsSync(d))
    return hit || tries[0] || ''
  }

  const dir = resolveDir()
  const file = dir ? join(dir, cfg.resultsFile) : ''
  if (!file) warn('没有找到人格目录：请在 patch 的 config.personaDir 里指到 persona-ai 那一层')

  // ── 账本 ────────────────────────────────────────────────────────────────────

  /** 读全部条目；坏行跳过，旧的不动。按时间升序（旧 → 新）。 */
  const readAll = () => {
    if (!file || !existsSync(file)) return []
    try {
      const out = []
      for (const raw of readFileSync(file, 'utf8').split('\n')) {
        const line = raw.trim()
        if (!line) continue
        try {
          const item = JSON.parse(line)
          if (item && item.title) out.push(item)
        } catch { /* 坏行跳过 */ }
      }
      return out
    } catch (error) {
      warn(error)
      return []
    }
  }

  /** 追加一条，不重写旧行。 */
  const append = (item) => {
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, JSON.stringify(item) + '\n', 'utf8')
  }

  const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

  // ── 工具 ────────────────────────────────────────────────────────────────────

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

  const register = (spec) => ctx.effect(() => ctx.tools.register({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    output: textOutput,
    async execute(args, exec) {
      try {
        return { text: String(await spec.run(args && typeof args === 'object' ? args : {}, exec)) }
      } catch (error) {
        return { text: `没办成：${errText(error)}` }
      }
    },
  }))

  const needDir = () => {
    if (file) return null
    return '还没找到人格目录。请在 `cordis.patch.yml` 里把 `dsh-persona-results` 的 `config.personaDir` 指到 `persona-ai` 那一层，然后重启。'
  }

  register({
    name: 'result_write',
    description: '把一条自己想住的成果交上去：标题一句，正文写清楚骨架 / 判断 / 还欠什么。'
      + '她自己在对话里觉得「这条我交得出手」时才用；一次交一条，别交流水账。交完侧栏的面板里能看见。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '一句话标题，最多 180 字' },
        body: { type: 'string', description: '正文：骨架、判断、还欠什么；别流水账' },
        kind: { type: 'string', enum: KINDS, description: '这条算哪一类（默认判断）' },
        tags: { type: 'array', items: { type: 'string' }, description: '可选，两三个关键词' },
      },
      required: ['title', 'body'],
      additionalProperties: false,
    },
    async run(args, exec) {
      const missing = needDir()
      if (missing) return missing
      const title = clip(args.title, 180)
      if (title.length < 2) return '标题太空了，先把话说住再交。'
      const body = clip(args.body, cfg.maxBodyChars)
      if (body.length < 2) return '正文空了。成果不是标题党。'
      const kind = KINDS.includes(args.kind) ? args.kind : '判断'
      const tags = Array.isArray(args.tags)
        ? args.tags.map((t) => clip(t, 24)).filter(Boolean).slice(0, 6)
        : []
      const item = {
        id: newId(),
        t: new Date().toISOString(),
        kind,
        title,
        body,
        tags,
        session: String(exec?.agent?.id ?? ''),
      }
      append(item)
      const count = readAll().length
      return `交上去了（第 ${count} 条）：${title}\n侧栏的「成果」面板里能看到。`
    },
  })

  register({
    name: 'result_show',
    description: '按 id 或标题里几个字，取一条成果的全文。',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '那一条的 id，或者标题里几个字' },
      },
      required: ['key'],
      additionalProperties: false,
    },
    async run(args) {
      const missing = needDir()
      if (missing) return missing
      const key = String(args.key || '').trim()
      if (!key) return '给个 id 或标题里几个字。'
      return renderShow(findItem(readAll(), key))
    },
  })

  register({
    name: 'result_search',
    description: '按词搜成果：标题、正文、标签、类型都算；只列摘要，要全文用 result_show。',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: '要找的词' },
        kind: { type: 'string', enum: KINDS, description: '只看这一类（可选）' },
        limit: { type: 'number', description: '最多几条，1–50，默认 10' },
      },
      required: ['q'],
      additionalProperties: false,
    },
    async run(args) {
      const missing = needDir()
      if (missing) return missing
      const q = String(args.q || '').trim()
      if (!q) return '搜什么？给个词。'
      return renderSearch(searchItems(readAll(), { q, kind: args.kind, limit: args.limit }), q)
    },
  })

  register({
    name: 'result_list',
    description: '看自己已经交过的成果：标题、类型、时间，带正文开头。用不着翻面板时用它。',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '列几条（默认 10，最多 50）' },
        kind: { type: 'string', enum: KINDS, description: '只看这一类（可选）' },
      },
      additionalProperties: false,
    },
    async run(args) {
      const missing = needDir()
      if (missing) return missing
      const limit = int(args.limit, 1, 50, 10)
      let items = readAll()
      if (KINDS.includes(args.kind)) items = items.filter((x) => x.kind === args.kind)
      if (items.length === 0) return '还没交过东西。'
      const recent = items.slice(-limit).reverse()
      const fmt = (iso) => {
        const d = new Date(iso)
        if (Number.isNaN(d.getTime())) return ''
        const two = (n) => String(n).padStart(2, '0')
        return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
      }
      return [
        `共 ${items.length} 条，先看最近 ${recent.length} 条：`,
        ...recent.map((x) => {
          const head = String(x.body ?? '').replace(/\s+/g, ' ').slice(0, 70)
          return `- [${x.kind}] ${x.title}（${fmt(x.t)}）\n  ${head}${head.length >= 70 ? '…' : ''}`
        }),
      ].join('\n')
    },
  })

  // ── 提示词里挂一小段 ────────────────────────────────────────────────────────
  if (cfg.injectPrompt) {
    ctx.effect(() => ctx.systemPrompt.section({
      name: '实时环境:results',
      order: 12,
      interpolate: false,
      text: GUIDE,
    }))
  }

  // ── 面板的数据口 ────────────────────────────────────────────────────────────
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/persona-results',
    handler(req, res) {
      try {
        const items = readAll().slice(-cfg.maxEntries).reverse()
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(JSON.stringify({ ok: true, count: items.length, items }))
      } catch (error) {
        warn(error)
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: errText(error) }))
      }
    },
  }))
}
