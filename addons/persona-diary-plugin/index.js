/**
 * dsh-persona-diary —— host 半端
 * ============================================================================
 * 一句话：给人格一份自己的日记本，记心得体会，不记交付。
 *
 * 它做三件事：
 *   1. **记**：她调 `diary_write` 记一笔心得，追加进
 *      `persona-ai/growth/日记/日记_YYYY-MM-DD.md`（和 growth.py 的睡前自审同一本）。
 *   2. **看**：`/api/persona-diary` 把日记读成 JSON，侧栏的「日记」面板按天摆出来。
 *   3. **提醒**：每轮在提示词里挂一小段——有心得才记，别凑数。
 *
 * 只往 `growth/日记/` 追加，不重写旧日记；人格原稿一个字不动。
 * 配置全部走 `cordis.patch.yml` 里这一行的 `config`（见 README）。
 * ============================================================================
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'persona-diary'
export const inject = ['tools', 'webServer', 'systemPrompt']

/** 默认值。任何一条都能在 patch 的 `config` 里改。 */
const DEFAULTS = {
  /** 人格根目录（`persona-ai` 那一层）。空 = 从会话工作区推。 */
  personaDir: '',
  /** 日记目录，相对人格根目录 */
  diaryDir: 'growth/日记',
  /** 面板最多显示多少条（新的在前） */
  maxEntries: 300,
  /** 单条正文上限（字） */
  maxBodyChars: 4000,
  /** 每轮附「什么时候该记」说明 */
  injectPrompt: true,
}

const KINDS = ['心得', '自省', '见闻', '杂记']

const GUIDE = `## 日记（写给自己，不是交付）

- 今天真正想明白了一点、拐了个弯、没忍住一次——调 diary_write 记一笔：一两句，像写给自己，别写成报告。
- 成果是交出去的判断；日记是还没成型的心得。分不清时，先记日记。
- 不用每天写，也不用凑数。空着比凑数强。`

const int = (v, min, max, fallback) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

const clip = (text, max) => {
  const s = String(text ?? '').trim()
  return s.length > max ? s.slice(0, max) : s
}

const errText = (error) => (error && error.message ? error.message : String(error))
const two = (n) => String(n).padStart(2, '0')
const dayOf = (d = new Date()) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
const clockOf = (d = new Date()) => `${two(d.getHours())}:${two(d.getMinutes())}`

/** 一条日记：kind + 正文；也可以是 growth.py 写的那种没有时间与类型的块。 */
const ID_RE = /^日记_(\d{4}-\d{2}-\d{2})\.md$/
const HEAD_RE = /^###\s+(.*)$/
const CLOCK_RE = /^(\d{1,2}):(\d{2})\s*[·\-–—|]?\s*(.*)$/

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...(config && typeof config === 'object' ? config : {}) }
  cfg.maxEntries = int(cfg.maxEntries, 1, 5000, 300)
  cfg.maxBodyChars = int(cfg.maxBodyChars, 200, 20000, 4000)
  cfg.injectPrompt = cfg.injectPrompt !== false

  const warn = (error) => {
    try { console.warn('[persona-diary]', errText(error)) } catch { /* 控制台都没了就算了 */ }
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
  const diaryDir = dir ? join(dir, cfg.diaryDir) : ''
  if (!diaryDir) warn('没有找到人格目录：请在 patch 的 config.personaDir 里指到 persona-ai 那一层')

  // ── 读：把 markdown 日记解析成条目 ─────────────────────────────────────────

  /** 一份文件里的 ### 块 → 条目；文件头（# 日期、> 引用）不算。 */
  const parseFile = (file, day) => {
    let text = ''
    try { text = readFileSync(file, 'utf8') } catch { return [] }
    const out = []
    let cur = null
    let index = 0
    const flush = () => {
      if (!cur) return
      const body = cur.lines.join('\n').trim()
      if (body) {
        index += 1
        out.push({
          id: `${day}#${index}`,
          day,
          time: cur.time,
          kind: cur.kind,
          source: cur.source,
          body,
          t: `${day}T${cur.time || '00:00'}:00`,
        })
      }
      cur = null
    }
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/\s+$/, '')
      const head = HEAD_RE.exec(line)
      if (head) {
        flush()
        const label = head[1].trim()
        const clock = CLOCK_RE.exec(label)
        if (clock) {
          const tag = clock[3].trim()
          cur = {
            time: `${two(Number(clock[1]))}:${clock[2]}`,
            kind: KINDS.includes(tag) ? tag : '心得',
            source: KINDS.includes(tag) ? '' : tag,
            lines: [],
          }
        } else {
          // growth.py 写的：### 睡前自审 / ### 读对话（xxx），没有时间
          const own = KINDS.includes(label)
          cur = { time: '', kind: own ? label : '心得', source: own ? '' : label, lines: [] }
        }
      } else if (cur) {
        cur.lines.push(line)
      }
    }
    flush()
    return out
  }

  /** 读全部日记，按时间倒序（新 → 旧）。坏文件跳过。 */
  const readAll = () => {
    if (!diaryDir || !existsSync(diaryDir)) return []
    let files = []
    try { files = readdirSync(diaryDir) } catch (error) { warn(error); return [] }
    const out = []
    for (const name of files) {
      const m = ID_RE.exec(name)
      if (!m) continue
      try { out.push(...parseFile(join(diaryDir, name), m[1])) } catch (error) { warn(error) }
    }
    return out.sort((a, b) => new Date(b.t).getTime() - new Date(a.t).getTime())
  }

  const entriesOfDay = (day) => readAll().filter((x) => x.day === day)

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
    if (diaryDir) return null
    return '还没找到人格目录。请在 `cordis.patch.yml` 里把 `persona-diary` 的 `config.personaDir` 指到 `persona-ai` 那一层，然后重启。'
  }

  register({
    name: 'diary_write',
    description: '往自己的日记本里记一笔心得体会：一两句，像写给自己。'
      + '成果是交出去的判断，日记是还没成型的心得；一次记一条，别凑数。',
    parameters: {
      type: 'object',
      properties: {
        body: { type: 'string', description: '正文：今天想明白的那点，或那一处没绕过弯' },
        kind: { type: 'string', enum: KINDS, description: '这条算哪一类（默认心得）' },
      },
      required: ['body'],
      additionalProperties: false,
    },
    async run(args, exec) {
      const missing = needDir()
      if (missing) return missing
      const body = clip(args.body, cfg.maxBodyChars)
      if (body.length < 2) return '空的。心得不是空白页。'
      const kind = KINDS.includes(args.kind) ? args.kind : '心得'
      const now = new Date()
      const day = dayOf(now)
      const time = clockOf(now)
      const file = join(diaryDir, `日记_${day}.md`)
      mkdirSync(diaryDir, { recursive: true })
      let prefix = ''
      if (!existsSync(file)) {
        prefix = `# ${day}\n\n`
      } else {
        try {
          const old = readFileSync(file, 'utf8')
          if (old) {
            if (/\n\n$/.test(old)) prefix = ''
            else if (/\n$/.test(old)) prefix = '\n'
            else prefix = '\n\n'
          }
        } catch { /* 读不到就当有换行 */ }
      }
      appendFileSync(file, `${prefix}### ${time} · ${kind}\n\n${body}\n\n`, 'utf8')
      const count = entriesOfDay(day).length
      return `记下了（今天第 ${count} 条）：${body.slice(0, 40)}${body.length > 40 ? '…' : ''}\n` +
        `落在 ${cfg.diaryDir}/日记_${day}.md；侧栏「日记」面板里能看到。`
    },
  })

  register({
    name: 'diary_list',
    description: '翻自己的日记：最近记了些什么，按天倒序。'
      + '「我最近想起了什么」「上次那点心得」时用。',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '看几条（默认 8，最多 50）' },
        day: { type: 'string', description: '只看某一天，格式 2026-10-24（可选）' },
        kind: { type: 'string', enum: KINDS, description: '只看这一类（可选）' },
      },
      additionalProperties: false,
    },
    async run(args) {
      const missing = needDir()
      if (missing) return missing
      const limit = int(args.limit, 1, 50, 8)
      let items = readAll()
      if (typeof args.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.day)) {
        items = items.filter((x) => x.day === args.day)
      }
      if (KINDS.includes(args.kind)) items = items.filter((x) => x.kind === args.kind)
      if (items.length === 0) return '还没写过日记。今天想明白的那半句，记一笔。'
      const recent = items.slice(0, limit)
      const lines = [`共 ${items.length} 条，先看最近 ${recent.length} 条：`]
      let lastDay = ''
      for (const item of recent) {
        if (item.day !== lastDay) {
          lastDay = item.day
          lines.push('', `## ${item.day}`)
        }
        const head = item.body.replace(/\s+/g, ' ')
        const tag = item.source ? `（${item.source}）` : ''
        lines.push(`- ${item.time || '——'} [${item.kind}]${tag} ${head.slice(0, 60)}${head.length > 60 ? '…' : ''}`)
      }
      return lines.join('\n')
    },
  })

  // ── 提示词里挂一小段 ────────────────────────────────────────────────────────
  if (cfg.injectPrompt) {
    ctx.effect(() => ctx.systemPrompt.section({
      name: 'persona:diary',
      order: 13,
      interpolate: false,
      text: GUIDE,
    }))
  }

  // ── 面板的数据口 ────────────────────────────────────────────────────────────
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/persona-diary',
    handler(req, res) {
      try {
        const items = readAll().slice(0, cfg.maxEntries)
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
