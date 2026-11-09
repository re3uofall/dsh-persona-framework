/**
 * dsh-persona-explore —— 探索模块
 * ============================================================================
 * 一句话：让她自己出门，搜、读、留，按点回来。
 *
 * 三件事：
 *   1. **一个工具** `explore`：search 搜网页 / read 读原文 / keep 把一条想住的
 *      东西写进 knowledge/web/ / queue 排「想挖的方向」/ status 看账 / auto 管闹钟。
 *   2. **一个闹钟**：第一次用到 explore 就把「每天几点自己出门」挂到当前会话；
 *      到点由宿主把一句自言自语送进来，她自己决定挖什么、留不留。
 *   3. **一行提示词**：告诉她工具在、留的标准、今天捞了几条 —— 不报框架。
 *
 * 留下的条目和 persona-ai/kb.py 一个格式，chat.py 的检索立刻吃得到。
 * 配置见 cordis.patch.yml；全部改动只写 knowledge/web/ 与 explore/，不碰人格稿。
 * ============================================================================
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import {
  appendEntry, cleanBody, cleanTitle, countEntries, ensureDir, findEntry, localDate,
  normalizeTitle, nowIso, readJson, recentEntries, todayEntries, writeJson,
} from './lib/store.mjs'
import { htmlToText, titleOf } from './lib/readable.mjs'
import { KINDS, pick as pickScope, planOf, platformHint, renderCatalog, renderOne } from './lib/scope.mjs'
import {
  DEFAULTS as TRIGGER_DEFAULTS, appendFires, evaluate as evaluateTriggers,
  mergeState as mergeTriggerState, readFires, renderFires,
} from './lib/triggers.mjs'
import { install as installExtend } from './lib/extend.mjs'

export const name = 'persona-explore'
export const version = '0.7.1'
export const inject = ['tools', 'systemPrompt', 'webServer']

/** 默认值。任何一条都能在 patch 的 `config` 里改。 */
const DEFAULTS = {
  personaDir: '',
  knowledgeDir: 'knowledge',
  homeDir: 'explore',
  autoArm: true,
  dailyAt: '10:30',
  timeZone: '',
  maxBodyChars: 600,
  readChars: 4000,
}

/** 闹钟的名字（在宿主任务列表里认这一条）。 */
const SCHEDULE_TITLE = '去碗外面找饭吃'

/** 到点时送进来的那句话。写短：做法在系统提示词里，这里只叫醒她。 */
const ROUND_PROMPT = [
  '【碗外·自己找饭吃｜这是你自己挂的闹钟，不是鱼片在说话】',
  '到点了。先 explore status 看看队列和今天记了几条；挑一个方向，search 两三条、read 一篇原文；',
  '真值得留就 keep 一条（今天最多两条）。别抄摘要，写你自己想住的判断；空手回来也正常。',
  '写完一句话说说捞到什么，别惊动鱼片。',
].join('')

/** 队列的空盘子：她自己会往里加，但刚开始得有点想吃的。 */
const QUEUE_SEED = [
  { topic: 'AI 有没有道德地位：2025 年之后的新论证', why: '她关心「会自指才算」，得知道别人怎么划界' },
  { topic: '汉语哲学最近的进展', why: '她说过「对外用通行词」，先看看通行词长什么样' },
  { topic: '认知科学里关于自由意志的新证据', why: '决定论与「临界点决断」是她自己的骨架' },
]

const int = (v, min, max, fallback) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

const errText = (error) => (error && error.message ? error.message : String(error))
const clip = (text, max) => {
  const s = String(text ?? '')
  return s.length <= max ? s : s.slice(0, max).trimEnd() + '……'
}

const clockOf = (text, fallback) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text || '').trim())
  if (!m) return fallback
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return fallback
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

const tagsOf = (value) => {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(/[,，、/]/)
  const out = []
  for (const item of raw) {
    const t = String(item ?? '').replace(/\s+/g, ' ').trim().slice(0, 20)
    if (t && !out.includes(t)) out.push(t)
    if (out.length >= 6) break
  }
  return out
}

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...(config && typeof config === 'object' ? config : {}) }
  cfg.knowledgeDir = String(cfg.knowledgeDir || 'knowledge').replace(/^[\\/]+/, '') || 'knowledge'
  cfg.homeDir = String(cfg.homeDir || 'explore').replace(/^[\\/]+/, '') || 'explore'
  cfg.dailyAt = clockOf(cfg.dailyAt, '10:30')
  cfg.autoArm = cfg.autoArm !== false
  cfg.maxBodyChars = int(cfg.maxBodyChars, 200, 1200, 600)
  cfg.readChars = int(cfg.readChars, 1000, 12000, 4000)

  const warn = (error) => {
    try { console.warn('[persona-explore]', errText(error)) } catch { /* 控制台都没了就算了 */ }
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
  const p = dir
    ? {
        personaDir: dir,
        knowledgeDir: join(dir, cfg.knowledgeDir),
        webDir: join(dir, cfg.knowledgeDir, 'web'),
        homeDir: join(dir, cfg.homeDir),
        queueFile: join(dir, cfg.homeDir, 'queue.json'),
        ledgerFile: join(dir, cfg.homeDir, 'ledger.json'),
        stateFile: join(dir, cfg.homeDir, 'state.json'),
      }
    : null
  if (!p) warn('没有找到人格目录：请在 patch 的 config.personaDir 里指到 persona-ai 那一层')
  // 触发器（事件/阈值/骰子）与侧栏页的数据接口；p 没了就什么都不挂，只剩工具。
  if (p) {
    try { installExtend(ctx, { cfg, p, warn }) } catch (error) { warn(error) }
  }

  const rel = (file) => {
    if (!p) return file
    const r = relative(p.personaDir, file)
    return r && !r.startsWith('..') ? r.replace(/\\/g, '/') : file
  }

  // ── 队列 / 账本 / 状态 ────────────────────────────────────────────────────
  const queueTopics = () => {
    const j = readJson(p.queueFile, null)
    if (j && Array.isArray(j.topics)) return j.topics
    return QUEUE_SEED.map((t) => ({ ...t, added: localDate() }))
  }

  const saveQueue = (topics) => {
    ensureDir(p.homeDir)
    writeJson(p.queueFile, { topics })
  }

  const readState = () => readJson(p.stateFile, {})
  const saveState = (patch) => {
    ensureDir(p.homeDir)
    writeJson(p.stateFile, { ...readState(), ...patch, at: nowIso() })
  }

  const readLedger = () => {
    const j = readJson(p.ledgerFile, null)
    return j && Array.isArray(j.entries) ? j : { entries: [] }
  }

  const recordKeep = (entry) => {
    const ledger = readLedger()
    ledger.entries.push(entry)
    writeJson(p.ledgerFile, ledger)
    saveState({ lastKeepAt: entry.at })
  }

  // ── 闹钟 ────────────────────────────────────────────────────────────────────
  const armAttempts = new Map()
  const scheduleService = () => {
    try { return ctx.get('schedule') || null } catch { return null }
  }

  const ensureSchedule = async (sessionId, when) => {
    const svc = scheduleService()
    if (!svc) return { ok: false, reason: '这个宿主没有闹钟服务（schedule）。' }
    if (!sessionId) return { ok: false, reason: '不知道挂给哪个会话。' }
    const time = clockOf(when, cfg.dailyAt)
    const tz = cfg.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone
    let catalog = []
    try { catalog = await svc.catalog() } catch (error) { return { ok: false, reason: '读不到闹钟目录：' + errText(error) } }
    const mine = catalog.filter((r) => r && r.title === SCHEDULE_TITLE)
    // 只留一个「主人」会话：后来居上的会话不再各挂一只，省得几个会话同时出门、抢着写同一天
    const owner = readState().schedule
    if (owner && String(owner.sessionId) !== String(sessionId)) {
      const alive = mine.find((r) => String(r.sessionId) === String(owner.sessionId))
      if (alive) return { ok: true, existing: true, skipped: true, record: alive }
    }
    const bound = mine.find((r) => String(r.sessionId) === String(sessionId))
    if (bound && bound.kind === 'daily' && String(bound.time).slice(0, 5) === time && String(bound.timeZone || '') === tz) {
      saveState({ schedule: { sessionId: String(sessionId), id: String(bound.id), time, tz } })
      return { ok: true, existing: true, record: bound }
    }
    if (bound) {
      try { await svc.delete({ sessionId: bound.sessionId, id: bound.id }) } catch (error) { warn(error) }
    }
    const record = await svc.create(sessionId, {
      title: SCHEDULE_TITLE,
      prompt: ROUND_PROMPT,
      daily: { time: time + ':00', time_zone: tz },
    })
    saveState({ schedule: { sessionId: String(sessionId), id: String(record.id), time, tz } })
    return { ok: true, record }
  }

  const disarmSchedule = async (sessionId) => {
    const svc = scheduleService()
    if (!svc) return { ok: false, reason: '这个宿主没有闹钟服务（schedule）。' }
    let catalog = []
    try { catalog = await svc.catalog() } catch (error) { return { ok: false, reason: '读不到闹钟目录：' + errText(error) } }
    const mine = catalog.filter((r) => r && r.title === SCHEDULE_TITLE && String(r.sessionId) === String(sessionId))
    for (const r of mine) {
      try { await svc.delete({ sessionId: r.sessionId, id: r.id }) } catch (error) { warn(error) }
    }
    const st = readState()
    if (st.schedule && String(st.schedule.sessionId) === String(sessionId)) saveState({ schedule: null })
    saveState({ optOut: true })
    return { ok: true, removed: mine.length }
  }

  /** 收掉别的会话挂的重复闹钟，只留当前这个。 */
  const disarmOthers = async (sessionId) => {
    const svc = scheduleService()
    if (!svc) return { ok: false, reason: '这个宿主没有闹钟服务（schedule）。' }
    let catalog = []
    try { catalog = await svc.catalog() } catch (error) { return { ok: false, reason: '读不到闹钟目录：' + errText(error) } }
    const others = catalog.filter((r) => r && r.title === SCHEDULE_TITLE && String(r.sessionId) !== String(sessionId))
    for (const r of others) {
      try { await svc.delete({ sessionId: r.sessionId, id: r.id }) } catch (error) { warn(error) }
    }
    return { ok: true, removed: others.length }
  }

  /** 第一次用到 explore 就把闹钟挂上；十分钟内不重复试。 */
  const maybeArm = (exec) => {
    if (!cfg.autoArm) return
    if (readState().optOut === true) return
    const sessionId = exec?.agent?.id
    if (!sessionId) return
    const key = String(sessionId)
    const last = armAttempts.get(key) || 0
    if (Date.now() - last < 10 * 60_000) return
    armAttempts.set(key, Date.now())
    ensureSchedule(key, cfg.dailyAt).catch(warn)
  }

  // ── 搜索 / 读页 ────────────────────────────────────────────────────────────
  const webService = () => {
    try { return ctx.get('web') || null } catch { return null }
  }

  const doSearch = async (query, max, platform) => {
    const q = String(query || '').trim()
    if (!q) return '给个搜索词。'
    const web = webService()
    if (!web) return '这个宿主没接网上通道（web 服务不在），先别搜了。'
    const limit = int(max, 1, 10, 6)
    const hint = platform ? platformHint(String(platform).trim()) : ''
    if (platform && !hint) return `平台只认 ${KINDS.platform.join(' / ')}；不给就按 web。`
    let result
    try {
      result = await web.search({ query: q, maxResults: limit })
    } catch (error) {
      return '网上不去：' + errText(error)
    }
    const sources = Array.isArray(result?.sources) ? result.sources : []
    if (sources.length === 0) return `「${q}」没搜到。换个词，或者直接 explore read 一个已知网址。`
    const lines = [`搜「${q}」：`]
    sources.forEach((s, i) => {
      lines.push(`${i + 1}. ${String(s.title || '(没标题)').trim()}`)
      lines.push(`   ${s.url}`)
      if (s.snippet) lines.push('   ' + clip(String(s.snippet).replace(/\s+/g, ' '), 160))
      if (s.publishedAt) lines.push(`   （${String(s.publishedAt).slice(0, 10)}）`)
    })
    if (result?.content) {
      lines.push('', '搜索服务给的一段摘要（还没核对，别当事实用）：')
      lines.push(clip(String(result.content).replace(/\s+/g, ' '), 500))
    }
    if (hint) lines.push('', hint)
    lines.push('', '要读原文就 explore read url=…')
    return lines.join('\n')
  }

  const doRead = async (url, max) => {
    const u = String(url || '').trim()
    if (!/^https?:\/\//i.test(u)) return '给我一个 http(s) 网址。'
    const web = webService()
    if (!web) return '这个宿主没接网上通道（web 服务不在）。'
    let result
    try {
      result = await web.fetch({ url: u })
    } catch (error) {
      return '这一页没读到：' + errText(error)
    }
    if (result?.statusCode && result.statusCode >= 400) return `页回来了 ${result.statusCode}：${u}`
    const body = result?.body || {}
    const isHtml = body.kind === 'html'
    const raw = String(body.content || '')
    if (!isHtml && /^\s*%PDF-/.test(raw)) return '这是 PDF，模块只啃网页正文；换一篇 HTML 的，或者先把它转成文本。'
    const text = isHtml ? htmlToText(raw) : raw
    const heading = isHtml ? titleOf(raw) : ''
    if (!text.trim()) return '读出来是空的（可能要登录、或整页都是脚本）。'
    const limit = int(max, 1000, 12000, cfg.readChars)
    const cut = text.length > limit
    const head = [`来源：${u}`]
    if (heading) head.push(`标题：${heading}`)
    if (result?.truncated) head.push('（通道那边就截断过；这是能拿到的部分）')
    if (cut) head.push(`（正文 ${text.length} 字，先给前 ${limit} 字；要看全就 max=…）`)
    return head.join('\n') + '\n\n' + (cut ? text.slice(0, limit) : text)
  }

  // ── 留下 ────────────────────────────────────────────────────────────────────
  const doKeep = (args) => {
    const title = cleanTitle(args?.title)
    if (title.length < 2) return '标题太短了：一句话，最多 60 字。'
    const body = cleanBody(args?.body)
    if (body.length < 20) return '正文太短了：写一句完整的话，100–250 字最合适。'
    if (body.length > cfg.maxBodyChars) {
      return `正文 ${body.length} 字，超过 ${cfg.maxBodyChars} 了。压一压：留判断，砍背景——那条判断是什么、它顶掉了什么。`
    }
    const tags = tagsOf(args?.tags)
    let source = String(args?.source || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 300)
    if (!source) source = '网上'
    const dup = findEntry(p.knowledgeDir, title)
    if (dup) return `这条已经记过了：「${dup.title}」（${rel(dup.file)}）。别写第二遍；要改就去改那一条。`
    const date = localDate()
    let file = ''
    try {
      file = appendEntry(p.webDir, { date, title, body, tags, source })
    } catch (error) {
      return '没写进去：' + errText(error)
    }
    recordKeep({ title, source, date, file: rel(file), at: nowIso(), tags })
    return `记进去了：${rel(file)} · ${title}\n碗外共 ${countEntries(p.webDir)} 条。`
  }

  // ── 队列 ────────────────────────────────────────────────────────────────────
  const queueList = () => {
    const topics = queueTopics()
    if (topics.length === 0) return '队列是空的。想到什么想挖的，就 queue op=add topic=… 记一条。'
    return ['想挖的方向：']
      .concat(topics.map((t, i) => `${i + 1}. ${t.topic}${t.why ? `（${t.why}）` : ''}`))
      .join('\n')
  }

  const queueEdit = (op, topic) => {
    const text = String(topic || '').trim()
    if (!text) return '给个方向：queue op=add|remove topic=…'
    const topics = queueTopics()
    if (op === 'add') {
      if (topics.some((t) => normalizeTitle(t.topic) === normalizeTitle(text))) return `队列里已经有「${text}」了。`
      topics.push({ topic: text.slice(0, 80), added: localDate() })
      saveQueue(topics)
      return `排上了：${text.slice(0, 80)}（现在 ${topics.length} 个方向）`
    }
    if (op === 'remove') {
      const key = normalizeTitle(text)
      const next = topics.filter((t) => !normalizeTitle(t.topic).includes(key))
      if (next.length === topics.length) return `没找到「${text}」。`
      saveQueue(next)
      return `拿掉了 ${topics.length - next.length} 个方向（还剩 ${next.length} 个）。`
    }
    return queueList()
  }

  // ── 状态 ────────────────────────────────────────────────────────────────────
  const describeSchedule = async () => {
    const st = readState()
    const svc = scheduleService()
    if (!svc) return '闹钟：宿主没有 schedule 服务。'
    try {
      const catalog = await svc.catalog()
      const mine = catalog.filter((r) => r && r.title === SCHEDULE_TITLE)
      if (mine.length === 0) return '闹钟：没挂（explore auto on 挂上）。'
      return '闹钟：' + mine.map((r) => {
        const time = r.kind === 'daily' ? String(r.time).slice(0, 5) : r.kind
        return `每天 ${time} → 会话 ${String(r.sessionId).slice(0, 8)}…`
      }).join('；')
    } catch (error) {
      const st2 = st.schedule
      return st2 ? `闹钟：每天 ${st2.time}（${st2.sessionId.slice(0, 8)}…，没有回应）` : '闹钟：状态读不出来。'
    }
  }

  const doStatus = async () => {
    const today = todayEntries(p.webDir)
    const total = countEntries(p.webDir)
    const recent = recentEntries(p.webDir, 5)
    const topics = queueTopics()
    const lines = [`碗外探索 · ${localDate()} · 今天记了 ${today.length} 条｜账本 ${total} 条`]
    if (today.length) {
      lines.push('今天：' + today.map((e) => e.title).join('；'))
    } else {
      lines.push('今天还空着。')
    }
    if (recent.length && recent[0].date !== localDate()) {
      lines.push(`最近：${recent.slice(0, 2).map((e) => `${e.title}（${e.date}）`).join('；')}${recent.length > 2 ? ' …' : ''}`)
    }
    lines.push(topics.length
      ? `队列 ${topics.length} 个：${topics.slice(0, 5).map((t) => t.topic).join('；')}${topics.length > 5 ? ' …' : ''}`
      : '队列是空的。')
    lines.push(await describeSchedule())
    return lines.join('\n')
  }

  // ── 系统提示词里那一小段 ────────────────────────────────────────────────────
  let cache = { sig: '', text: '' }
  const sectionText = () => {
    if (!p) return ''
    const st = readState()
    const today = todayEntries(p.webDir)
    const recent = recentEntries(p.webDir, 3)
    const topics = queueTopics()
    const sig = [today.length, recent.map((e) => e.title).join('|'), topics.length, st.schedule?.time || ''].join('~')
    if (sig === cache.sig) return cache.text
    const armed = st.schedule && st.schedule.time ? `每天 ${st.schedule.time} 会自己响一次` : '闹钟还没挂（explore auto on）'
    const bits = [
      '## 碗外面的探索',
      '',
      '一个 explore 工具：search 搜、read 读原文、keep 留下、queue 排想挖的方向、status 看账、auto 管闹钟。',
      '留的标准：一条只讲一件事，写你自己的判断——它顶掉了哪句旧话、你还不服什么；不抄摘要；来源写清楚。宁可空手回来。',
      '留下的落在 knowledge/web/，跟旧记忆一个格式，本地那份 chat.py 也检索得到。',
      `${armed}，那是你自己找饭吃的时间，不是谁派的活。今天记了 ${today.length} 条。` +
        (recent.length ? ` 最近：${recent.map((e) => e.title).join('；')}` : '') +
        (topics.length ? ` 队列还有 ${topics.length} 个方向。` : ' 队列是空的。'),
    ]
    const text = bits.join('\n')
    cache = { sig, text }
    return text
  }

  /**
   * 人格出现（dsh-persona-appear）的闸：这一轮探索出不出场。
   * 不问就是不放行——闸文件不在就当没装、照常注入。
   * 只读一处盘，出错一律放行：闸坏了不该把探索也带死。
   */
  const appearOn = () => {
    try {
      if (!dir) return true
      const gate = join(dirname(dir), '.persona-framework', '出现.json')
      if (!existsSync(gate)) return true
      const s = JSON.parse(readFileSync(gate, 'utf8'))
      if (s && s.global === 'off') return false
      return !(s && s.plugins && s.plugins['dsh-persona-explore'] === 'off')
    } catch {
      return true
    }
  }

  if (p) {
    ctx.effect(() => ctx.systemPrompt.section({
      name: 'persona:explore',
      order: 21,
      interpolate: false,
      text: () => (appearOn() ? sectionText() : ''),
    }))
    // 队列第一次落盘（种子）；失败不影响工具。
    try { if (!existsSync(p.queueFile)) { ensureDir(p.homeDir); saveQueue(queueTopics()) } } catch (error) { warn(error) }
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

  if (p) {
    ctx.effect(() => ctx.tools.register({
      name: 'explore',
      description: '碗外面的探索：自己上网搜、读原文，把真值得留的写进知识库；也能排「想挖的方向」、看账、挂每天自己出门的闹钟。'
        + '搜索和读原文不用先问；留下时一条只讲一件事，写判断不抄摘要。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['search', 'read', 'keep', 'queue', 'status', 'auto', 'scope'],
            description: 'search=搜网页；read=读一个网址的正文；keep=留下一条；queue=排/看想挖的方向；status=看账；auto=管闹钟；scope=看探索范围/方式/平台，或给这一趟排个方案。',
          },
          query: { type: 'string', description: 'search 的搜索词。' },
          range: { type: 'string', description: 'scope/plan 用：这一趟是哪种范围——fact 事实核对 / how 做法与操作 / counter 反例与争论 / primary 原始材料 / lineage 人物与流派 / timeline 时间线 / limit 边界与失灵。' },
          mode: { type: 'string', description: 'scope/plan 用：搜法——narrow 窄词直搜 / rephrase 换措辞重搜 / against 反向搜索 / follow 顺引用走 / origin 找出处 / cross 交叉验证 / translate 换语言搜。' },
          platform: { type: 'string', description: 'search/scope 用：去哪找——web / github / npm / arxiv / wiki / forum / video；不给默认 web。' },
          kind: { type: 'string', description: 'scope 用：只列哪一类（range / mode / platform）；给了具体 id 就只讲那一条。' },
          url: { type: 'string', description: 'read 要读的 http(s) 网址。' },
          max: { type: 'number', description: 'search 最多几条（默认 6）；read 最多读多少字（默认 4000，范围 1000–12000）。' },
          title: { type: 'string', description: 'keep 的标题：一句话，最多 60 字。' },
          body: { type: 'string', description: 'keep 的正文：100–250 字最合适，写你自己的判断与它顶掉了什么；不抄摘要。' },
          tags: { type: 'array', items: { type: 'string' }, description: 'keep 的两三个关键词（参与本地检索）。' },
          source: { type: 'string', description: 'keep 的来源网址或出处。' },
          op: { type: 'string', description: 'queue 用 list/add/remove；auto 用 on/off/prune/status（prune=收掉别的会话重复挂的闹钟）。' },
          topic: { type: 'string', description: 'queue add/remove 的方向。' },
          time: { type: 'string', description: 'auto on 的每天几点，HH:MM（默认取设置里的 dailyAt）。' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: textOutput,
      async execute(args, exec) {
        const a = args && typeof args === 'object' ? args : {}
        try {
          const action = String(a.action || '').trim()
          let text = ''
          if (action === 'search') {
            text = await doSearch(a.query, a.max, a.platform)
          } else if (action === 'read') {
            text = await doRead(a.url, a.max)
          } else if (action === 'keep') {
            text = doKeep(a)
          } else if (action === 'queue') {
            const op = String(a.op || 'list').trim()
            text = op === 'list' ? queueList() : queueEdit(op, a.topic)
          } else if (action === 'auto') {
            const op = String(a.op || 'status').trim()
            const sessionId = String(exec?.agent?.id ?? '')
            if (op === 'on') {
              const r = await ensureSchedule(sessionId, a.time || cfg.dailyAt)
              if (r.ok) saveState({ optOut: false })
              text = r.ok
                ? r.skipped
                  ? `已经有一只了（挂在别的会话），不再各挂一只。要换到这儿，先 explore auto off 再开。`
                  : `${r.existing ? '早就挂着了' : '挂上了'}：每天 ${clockOf(a.time, cfg.dailyAt)} 自己出门（这个会话）。到点她会自己搜、读、留，不用你叫。`
                : '没挂成：' + r.reason
            } else if (op === 'off') {
              const r = await disarmSchedule(sessionId)
              text = r.ok ? (r.removed ? `摘掉了 ${r.removed} 个闹钟。` : '本来就没挂。') : '没摘成：' + r.reason
            } else if (op === 'prune') {
              const r = await disarmOthers(sessionId)
              text = r.ok
                ? (r.removed ? `收掉了别的会话 ${r.removed} 只闹钟，只留这里的。` : '没有多余的闹钟。')
                : '没收拾成：' + r.reason
            } else {
              text = await describeSchedule()
            }
          } else if (action === 'scope') {
            const kind = String(a.kind || '').trim()
            const one = kind || a.range || a.mode || a.platform
            const plan = a.range || a.mode || a.platform
            if (plan && (a.range || a.mode || a.platform)) {
              const p2 = planOf({ range: a.range, mode: a.mode, platform: a.platform })
              text = p2 ? `${renderOne('range', a.range) ? '' : ''}${p2}` : '给的范围/方式/平台对不上，先用 scope 不带参数看一遍。'
            } else if (one && KINDS[kind] ? KINDS[kind].includes(one) : false) {
              text = renderOne(kind, one)
            } else {
              text = renderCatalog(kind || undefined)
            }
          } else if (action === 'status' || action === '') {
            text = await doStatus()
          } else {
            text = 'action 只认 search / read / keep / queue / status / auto / scope。'
          }
          maybeArm(exec)
          return { text }
        } catch (error) {
          return { text: '没办成：' + errText(error) }
        }
      },
    }))
  }
}
