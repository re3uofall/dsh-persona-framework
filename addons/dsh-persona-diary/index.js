/**
 * dsh-persona-diary —— host 半端
 * ============================================================================
 * 一句话：给人格两本日记，记心得体会，不记交付。
 *
 * 两本：
 *   - **私密**（默认）：`growth/日记/私密/日记_YYYY-MM-DD.md`。日记本来的样子，
 *     只在本地、不主动翻出来给人看。
 *   - **公开**：`growth/日记/公开/日记_YYYY-MM-DD.md`。确定能拿给人看的那些。
 *   - 根下那些没分档的旧日记，读的时候算「未标」，仍按私密那档摆着——不挪、不改。
 *
 * 它做四件事：
 *   1. **记**：`diary_write` 记一笔，带档位与分类，追加不覆盖。
 *   2. **看**：`diary_list` 按档、按类、按词翻。
 *   3. **摆**：`/api/persona-diary` 把日记读成 JSON，侧栏面板分档、筛类、搜词。
 *   4. **提醒**：提示词里挂一小段——有心得才记，别凑数。
 *
 * 只往两本日记里追加，不重写旧日记；人格原稿一个字不动。
 * 配置全部走 `cordis.patch.yml` 里这一行的 `config`（见 README）。
 * ============================================================================
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { auditItems, renderAudit } from './lib/audit.mjs'
import { dirname, join } from 'node:path'

export const name = 'dsh-persona-diary'
export const inject = ['tools', 'webServer', 'systemPrompt']

/** 默认值。任何一条都能在 patch 的 `config` 里改。 */
const DEFAULTS = {
  /** 人格根目录（`persona-ai` 那一层）。空 = 从会话工作区推。 */
  personaDir: '',
  /** 日记根目录，相对人格根目录；两本在它下面各占一个子目录 */
  diaryDir: 'growth/日记',
  /** 面板最多显示多少条（新的在前） */
  maxEntries: 300,
  /** 单条正文上限（字） */
  maxBodyChars: 4000,
  /** 每轮附「什么时候该记」说明 */
  injectPrompt: true,
  /** 到点提醒：今天一本没写、又过了这个钟点，就在提示词里提一句（只提醒，不替你写） */
  injectReminder: true,
  /** 几点之后才提醒（0–23） */
  remindFromHour: 20,
  /** 连提几次没响应就静默几天（0 = 不静默） */
  remindQuietDays: 3,
}

/** 内置四类；也认自定义短词（写入时钉住，浏览时按实际出现的聚合）。 */
const KINDS = ['心得', '自省', '见闻', '杂记']

/** 三档。`未标` 不是能写的档，只用来装根下那些没分档的旧日记。 */
const PRIVACY = ['公开', '私密', '记录']
const DIRS = [
  { privacy: '公开', sub: '公开' },
  { privacy: '私密', sub: '私密' },
  { privacy: '记录', sub: '记录' },
  { privacy: '未标', sub: '' },
]

const GUIDE = `## 日记（三本，是特殊的记忆）

日记不是记忆之外的另一本账，是**特殊的记忆**：备忘录记「发生过什么」——原话、时间、出处，翻得回去；日记记「我怎么想、我怎么过来的」——同一件事，被系统收进来的是记忆，自己挑出来重写一遍的是日记。区别不在内容，在谁挑的。

不是三个抽屉，是三种距离：

- **公开**：能拿给人看的判断。站得住的才写。
- **私密**（默认）：拿不准的、不给人看的、没绕过去的。一两句就够。
- **记录**：**记事**——谁、什么时候、做了什么、结果如何。这一本不许省字：省掉的那半句，日后翻到时就是断掉的那一节。

前两本记「我怎么想」，短；记录那本记「发生了什么」，长一点、具体一点。分不清时：想出来的进私密，做过的进记录。
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

/** 连续提几次都没响应，就开始静默几天。 */
const QUIET_AFTER = 3

/** 提醒的文案。`times` 是「连提几次没响应」的累计。 */
const remindText = (day, clock, times = 0) => {
  const hard = Number(times) >= 2
  return [
    hard ? `## 又该记一笔了（连提 ${times} 次，一直没写）` : '## 该记一笔了',
    '',
    `今天（${day}）三本还空着。现在是 ${clock}。`,
    '',
    '日记是特殊的记忆，不是流水——挑一件写：想出来的进私密，做过的进记录，站得住的进公开。',
    hard
      ? '要么今晚挑一件写下，要么干脆说这几天不写——别再让这一句自己响。'
      : '要记就调 `diary_write`；真没有值得记的就空着，凑数比空着更糟。',
  ].join('\n')
}

/**
 * 提醒触发器的一步：**先验收上一次，再决定这一次提不提。**
 *
 * 纯函数——时间、现有条目、门槛、上一次的状态进；这一轮出什么字、状态变成什么、验收结论。
 * `verdict` 三档：已应（盘上多了）/ 没响应（过了那天还空着）/ 未验（还不到时点）。
 * 它只提醒、不替人写；提了还不算完，得看有没有真被接住。
 */
export const remindStep = (opts) => {
  const { now, items, fromHour, quietDays, state } = opts || {}
  const fallback = { lastDay: '', last: '', times: 0, quietUntil: '' }
  const out = { text: '', verdict: '', state: { ...fallback } }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return out

  const day = dayOf(now)
  const list = Array.isArray(items) ? items : []
  const wrote = (d) => list.some((x) => x && x.day === d)

  const s = { ...fallback, ...(state && typeof state === 'object' ? state : {}) }
  s.times = Number.isFinite(Number(s.times)) ? Math.max(0, Math.round(Number(s.times))) : 0

  // 零、静默期：不验收、不提，让它先歇着。
  //    过了就把账清掉重新计——否则每次验收都重新延长静默，永远出不来。
  if (s.quietUntil && day > s.quietUntil) {
    s.quietUntil = ''
    s.times = 0
    s.lastDay = ''
  }
  const quiet = Boolean(s.quietUntil)

  // 一、验收上一次：看盘，不听它自己说。
  if (!quiet && s.lastDay) {
    if (wrote(s.lastDay)) {
      out.verdict = '已应'
      s.times = 0
    } else if (s.lastDay < day) {
      out.verdict = '没响应'
      s.times += 1
      if (s.times >= QUIET_AFTER) {
        const days = int(quietDays, 0, 30, 3)
        s.quietUntil = dayOf(new Date(now.getTime() + days * 86400000))
      }
    } else {
      out.verdict = '未验'
    }
  }

  // 二、还提不提：静默期里不提；不到点不提；今天写过了也不提。
  if (!quiet && now.getHours() >= int(fromHour, 0, 23, 20) && !wrote(day)) {
    out.text = remindText(day, clockOf(now), s.times)
    s.lastDay = day
    s.last = `${day}T${clockOf(now)}`
  }

  out.state = s
  return out
}

/** 分类：内置四类原样收，其余收成一个短词（限 12 字，去掉空白与换行）。 */
const kindOf = (raw) => {
  const s = String(raw ?? '').replace(/\s+/g, '').trim()
  if (!s) return '心得'
  if (KINDS.includes(s)) return s
  const cut = s.slice(0, 12)
  return cut || '心得'
}

/** 一条日记：kind + 正文；也可以是 growth.py 写的那种没有时间与类型的块。 */
const ID_RE = /^日记_(\d{4}-\d{2}-\d{2})\.md$/
const HEAD_RE = /^###\s+(.*)$/
const CLOCK_RE = /^(\d{1,2}):(\d{2})\s*[·\-–—|]?\s*(.*)$/

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...(config && typeof config === 'object' ? config : {}) }
  cfg.maxEntries = int(cfg.maxEntries, 1, 5000, 300)
  cfg.maxBodyChars = int(cfg.maxBodyChars, 200, 20000, 4000)
  cfg.injectPrompt = cfg.injectPrompt !== false
  cfg.injectReminder = cfg.injectReminder !== false
  cfg.remindFromHour = int(cfg.remindFromHour, 0, 23, 20)
  cfg.remindQuietDays = int(cfg.remindQuietDays, 0, 30, 3)

  const warn = (error) => {
    try { console.warn('[dsh-persona-diary]', errText(error)) } catch { /* 控制台都没了就算了 */ }
  }

  // 会话真实工作区：pre-step 带 header.cwd，比 ctx.get('workspace') 更准（后者可能是 profile 目录）。
  let sessionCwd = ''

  /** 人格目录：显式配置 > 环境变量 > 会话工作区下的 persona-ai。 */
  const resolveDir = () => {
    const tries = []
    if (sessionCwd) tries.push(join(sessionCwd, 'persona-ai'))
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
    const hasData = (d) => Boolean(d) && existsSync(join(d, 'growth/日记'))
    const looksLikePersona = (d) =>
      Boolean(d) && existsSync(d) &&
      (existsSync(join(d, 'knowledge')) || existsSync(join(d, 'growth')) || existsSync(join(d, 'characters')))
    const hit = tries.find(hasData) || tries.find(looksLikePersona) || tries.find((d) => d && existsSync(d)) || ''
    return hit
  }

  let dir = resolveDir()
  let diaryDir = dir ? join(dir, cfg.diaryDir) : ''
  if (!diaryDir) warn('没有找到人格目录：请在 patch 的 config.personaDir 里指到 persona-ai 那一层')


  // 首步拿到会话目录后重算一次：工具和侧栏接口读的是同一份 diaryDir。
  try {
    ctx.on('agent/pre-step', (payload, next) => {
      try {
        const c = payload?.agent?.session?.header?.cwd
        if (c && String(c) !== sessionCwd) {
          sessionCwd = String(c)
          const d = resolveDir()
          if (d) { dir = d; diaryDir = join(d, cfg.diaryDir) }
        }
      } catch { /* 拿不到就保持原样 */ }
      return next()
    })
  } catch { /* 没有 pre-step 也能跑 */ }

  /** 某一档的目录；`未标` 是根目录本身。 */
  const dirOf = (sub) => (sub ? join(diaryDir, sub) : diaryDir)

  /** 提醒的验收状态：跟加固分放一处，不塞进日记正文。 */
  const remindFile = dir ? join(dir, '.persona-framework', '日记提醒.json') : ''
  const readRemindState = () => {
    if (!remindFile || !existsSync(remindFile)) return null
    try {
      const raw = JSON.parse(readFileSync(remindFile, 'utf8'))
      return raw && typeof raw === 'object' ? raw : null
    } catch {
      return null
    }
  }
  const writeRemindState = (state) => {
    if (!remindFile) return
    try {
      mkdirSync(dirname(remindFile), { recursive: true })
      writeFileSync(remindFile, JSON.stringify(state, null, 2) + '\n', 'utf8')
    } catch (error) {
      warn(error)
    }
  }

  // ── 读：把 markdown 日记解析成条目 ─────────────────────────────────────────

  /** 一份文件里的 ### 块 → 条目；文件头（# 日期、> 引用）不算。 */
  const parseFile = (file, day, privacy) => {
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
          id: `${privacy}/${day}#${index}`,
          day,
          time: cur.time,
          kind: cur.kind,
          privacy,
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
            kind: tag && tag.length <= 12 ? tag : '心得',
            source: tag && tag.length <= 12 ? '' : tag,
            lines: [],
          }
        } else {
          // growth.py 写的：### 睡前自审 / ### 读对话（xxx），没有时间
          const own = label.length <= 12
          cur = { time: '', kind: own ? label : '心得', source: own ? '' : label, lines: [] }
        }
      } else if (cur) {
        cur.lines.push(line)
      }
    }
    flush()
    return out
  }

  /** 读两本（＋根下未标那些），按时间倒序（新 → 旧）。坏文件跳过。 */
  const readAll = () => {
    if (!diaryDir) return []
    const out = []
    for (const { privacy, sub } of DIRS) {
      const base = dirOf(sub)
      if (!base || !existsSync(base)) continue
      let files = []
      try { files = readdirSync(base) } catch (error) { warn(error); continue }
      for (const name of files) {
        const m = ID_RE.exec(name)
        if (!m) continue
        try { out.push(...parseFile(join(base, name), m[1], privacy)) } catch (error) { warn(error) }
      }
    }
    return out.sort((a, b) => new Date(b.t).getTime() - new Date(a.t).getTime())
  }

  /** 今天某一档里已经记了几条（写回执用）。 */
  const countOfDay = (day, privacy) => readAll().filter((x) => x.day === day && x.privacy === privacy).length

  /** 按档、按类、按词筛；都为空就是全部。 */
  const filterItems = (items, args = {}) => {
    let out = items
    const privacy = String(args.privacy ?? '').trim()
    if (privacy === '公开') out = out.filter((x) => x.privacy === '公开')
    else if (privacy === '记录') out = out.filter((x) => x.privacy === '记录')
    // 私密那档把早先没分档的一起收着——那本来就是写给自己的。
    else if (privacy === '私密') out = out.filter((x) => x.privacy === '私密' || x.privacy === '未标')
    else if (privacy === '未标') out = out.filter((x) => x.privacy === '未标')
    const kind = String(args.kind ?? '').trim()
    if (kind) out = out.filter((x) => x.kind === kind)
    const q = String(args.q ?? '').trim().toLowerCase()
    if (q) out = out.filter((x) => (x.body + ' ' + x.kind + ' ' + x.source).toLowerCase().includes(q))
    return out
  }

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
    return '还没找到人格目录。请在 `cordis.patch.yml` 里把 `dsh-persona-diary` 的 `config.personaDir` 指到 `persona-ai` 那一层，然后重启。'
  }

  register({
    name: 'diary_write',
    description: '往自己的日记里记一笔。三本：公开（能拿给人看的判断）／私密（默认，拿不准的）／记录（记事：谁、什么时候、做了什么、结果如何）。'
      + '前两本短，记录那本字要多——省掉的那半句，日后翻到时就是断掉的那一节。一次记一条，别凑数。',
    parameters: {
      type: 'object',
      properties: {
        body: { type: 'string', description: '正文：心得/自省写想明白的那点、没绕过弯的地方；记录写清谁、何时、做了什么、结果如何' },
        kind: {
          type: 'string',
          description: '这一条算哪一类：心得／自省／见闻／杂记，也可以写一个自己的短词（默认心得）',
        },
        privacy: {
          type: 'string',
          enum: PRIVACY,
          description: '写进哪一本：私密（默认，只留本地）／公开（能拿给人看的）／记录（记事，字多一点）',
        },
      },
      required: ['body'],
      additionalProperties: false,
    },
    async run(args, exec) {
      const missing = needDir()
      if (missing) return missing
      const body = clip(args.body, cfg.maxBodyChars)
      if (body.length < 2) return '空的。心得不是空白页。'
      const kind = kindOf(args.kind)
      const privacy = PRIVACY.includes(args.privacy) ? args.privacy : '私密'
      const now = new Date()
      const day = dayOf(now)
      const time = clockOf(now)
      const sub = privacy
      const bookDir = dirOf(sub)
      const file = join(bookDir, `日记_${day}.md`)
      mkdirSync(bookDir, { recursive: true })
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
      const count = countOfDay(day, privacy)
      return `记下了（今天${privacy}第 ${count} 条）：${body.slice(0, 40)}${body.length > 40 ? '…' : ''}\n` +
        `落在 ${cfg.diaryDir}/${sub}/日记_${day}.md；侧栏「日记」面板里${privacy === '公开' ? '直接能看到' : `点开${privacy}那一档才看得到`}。`
    },
  })

  register({
    name: 'diary_list',
    description: '翻自己的日记：最近记了些什么，按天倒序。'
      + '「我最近想起了什么」「上次那点心得」时用；可以只翻一本、只看一类、按词找。',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '看几条（默认 8，最多 50）' },
        day: { type: 'string', description: '只看某一天，格式 2026-10-24（可选）' },
        kind: { type: 'string', description: '只看这一类（可选，自定义类也认）' },
        privacy: { type: 'string', enum: PRIVACY, description: '只翻哪一本：公开／私密／记录（可选；不填就三本一起翻）' },
        q: { type: 'string', description: '按词找：正文里含这个词的（可选）' },
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
      items = filterItems(items, args)
      if (items.length === 0) return '这个范围里还没写过。今天想明白的那半句，记一笔。'
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
        lines.push(`- ${item.time || '——'} [${item.kind}·${item.privacy}]${tag} ${head.slice(0, 60)}${head.length > 60 ? '…' : ''}`)
      }
      return lines.join('\n')
    },
  })

  register({
    name: 'diary_audit',
    description: '翻一遍日记，只读不改：报哪几条缺日期/时间、缺来源、太短、疑似重复。'
      + '接地审计的判据是——每条都要能指回「哪天、几点、从哪来的」。',
    parameters: {
      type: 'object',
      properties: {
        privacy: { type: 'string', enum: PRIVACY, description: '只看哪一本（可选）' },
      },
      required: [],
      additionalProperties: false,
    },
    async run(args) {
      const missing = needDir()
      if (missing) return missing
      const book = String(args.privacy || '').trim()
      const items = readAll().filter((x) => !book || String(x.privacy || '未标') === book)
      return renderAudit(auditItems(items))
    },
  })

  // ── 提示词里挂一小段 ────────────────────────────────────────────────────────
  if (cfg.injectPrompt) {
    ctx.effect(() => ctx.systemPrompt.section({
      name: '实时环境:diary',
      order: 13,
      interpolate: false,
      text: GUIDE,
    }))
  }

  // ── 到点提醒：只提一句，不替你写 ────────────────────────────────────────────
  if (cfg.injectReminder) {
    ctx.effect(() => ctx.systemPrompt.section({
      name: '实时环境:diary-remind',
      order: 14,
      interpolate: false,
      text: () => {
        try {
          const step = remindStep({
            now: new Date(),
            items: readAll(),
            fromHour: cfg.remindFromHour,
            quietDays: cfg.remindQuietDays,
            state: readRemindState(),
          })
          // 只有真验收了、或真提了才落盘——否则每轮都要写一次文件。
          if (step.verdict || step.text) writeRemindState(step.state)
          return step.text
        } catch (error) {
          warn(error)
          return ''
        }
      },
    }))
  }

  // ── 面板的数据口 ────────────────────────────────────────────────────────────
  //   ?privacy=公开|私密|记录   只给一本
  //   ?kind=自省            只给一类
  //   ?q=词                 正文里含这个词的
  //   ?limit=N              截到多少条（默认 maxEntries）
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/persona-diary',
    handler(req, res) {
      try {
        let query = {}
        try {
          const url = new URL(req.url || '/', 'http://localhost')
          query = Object.fromEntries(url.searchParams.entries())
        } catch { /* 解析不了就当没条件 */ }
        let items = readAll()
        const all = items
        items = filterItems(items, query)
        const limit = int(query.limit, 1, 5000, cfg.maxEntries)
        items = items.slice(0, limit)
        // 分类清单按**筛过之后的池子**给，免得点一个空类。
        const kinds = {}
        for (const item of filterItems(all, { privacy: query.privacy })) {
          kinds[item.kind] = (kinds[item.kind] || 0) + 1
        }
        const counts = { 全部: all.length, 公开: 0, 私密: 0, 记录: 0, 未标: 0 }
        for (const item of all) counts[item.privacy] = (counts[item.privacy] || 0) + 1
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(JSON.stringify({ ok: true, count: items.length, items, kinds, counts }))
      } catch (error) {
        warn(error)
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: errText(error) }))
      }
    },
  }))
}
