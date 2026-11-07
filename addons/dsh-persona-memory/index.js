import { gateSkip, noteStep } from './lib/gate.mjs'
/**
 * dsh-persona-memory —— host 半端
 * ============================================================================
 * 一句话：把「记忆池」从一堆文件变成一个分得清层、装得进预算的东西。
 *
 * 它解决一个具体毛病：**流水淹掉判断**。
 * 每轮对话的全文（journal）和从中提炼出的一句（judgment）放在同一个池里，
 * 池子越大，检索时流水越占位置；人只看到「想不起来的变多了」，以为是记忆不行了。
 *
 * 五个工具，一条线：
 *   memory_stats     先看谁在吃预算           （诊断）
 *   memory_condense  把流水压成一行一条        （提炼）
 *   memory_archive   把超期的挪出去            （减重）
 *   memory_recall    按预算取，流水分得少      （检索）
 *   memory_source    按指针翻回一手原文          （门）
 *
 * 三条边界：
 *   · **不写内容**：它从不改记忆里的字，只挪位置、压行、分配预算。
 *   · **不猜格式**：流水的格式认不出就跳过，不瞎提炼。
 *   · **干跑优先**：condense / archive 默认 dryRun，要看结果再加 dryRun=false。
 *
 * 配置全部走 `cordis.patch.yml` 里这一行的 `config`。
 * ============================================================================
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { FIELDS, SETTINGS_DIR, SETTINGS_FILE, normalizePatch, normalizeStored, pickCurrent } from './lib/settings.mjs'
import {
  DEFAULT_LAYERS, archiveOld, recall, renderArchive, renderPools, renderRecall, scanPools,
} from './lib/pools.mjs'
import { condenseJournal, excerpt, renderCondense } from './lib/journal.mjs'
import { decideWrite, explain as explainGate } from './lib/writegate.mjs'
import {
  renderReinforce, saveReinforce, scoreFiles, DEFAULT_SUBJECTS, loadReinforce,
} from './lib/reinforce.mjs'
import {
  addStimulus, readStimulus, renderLedgerNote, renderLongLibrary, renderNowLibrary, renderOtherLibrary,
  renderShortLibrary, renderTempLibrary, STIMULUS_FILE,
} from './lib/libraries.mjs'
import { findVerbatim, renderTrace } from './lib/trace.mjs'
import { check as consistencyCheck, renderConsistency } from './lib/consistency.mjs'
import { record as auditRecord } from './lib/audit.mjs'
import { mergeMemoryContexts } from './lib/merge.mjs'
import { link as edgeLink, edgesOf, counterparts, renderEdges, renderWalk } from './lib/edges.mjs'
import { reject as rejectClaim, renderRejected } from './lib/rejected.mjs'
import { addAnchor, renderAnchors } from './lib/anchors.mjs'
import { recordState, stateOf, renderState } from './lib/state.mjs'
import { countOverdue, measureLayers, rebuildIndex, renderSlimReport } from './lib/slim.mjs'
import { reflect as reflectOnce, renderReflect } from './lib/reflect.mjs'
import { renderFlywheel } from './lib/flywheel.mjs'
import { DEFAULT_LIVE, liveMemory, renderLive } from './lib/live.mjs'

export const name = 'persona-memory'
// systemPrompt 必须声明：不声明它就不会先加载，`ctx.systemPrompt` 是 undefined，
// 下面那几处 `ctx.effect(() => ctx.systemPrompt.section(...))` 会抛 TypeError 被 catch 吞掉——
// 表现就是「插件 active、自测全过、渲染得出内容，但注入里一个字都没有」。
export const inject = ['tools', 'systemPrompt', 'webServer']

/**
 * 提醒账：触发器写下的「这一轮该调它」。
 * 这里只负责把它**摆到眼前**——账本上写着「只能手动调用」那几个字，就是没人替它按下去。
 * 摆进来不等于调用了；把提醒当成调用，比不提醒更坏。
 */
function renderRemindNote(root, { limit = 5 } = {}) {
  const f = join(root, 'persona-ai', 'knowledge', 'chat', '触发器提醒账.md')
  if (!existsSync(f)) return ''
  let lines = []
  try {
    lines = readFileSync(f, 'utf8')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
  } catch {
    return ''
  }
  if (!lines.length) return ''
  // 只摆最近一天写下的。旧账不沉底，提醒会变成背景噪声——
  // 「这一轮该调它」放两天就只剩「它」了，跟这一轮没关系。
  const now = Date.now()
  const fresh = lines.filter((l) => {
    const m = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/.exec(l)
    if (!m) return false
    const t = Date.parse(m[1])
    return Number.isFinite(t) && now - t < 24 * 3600_000
  })
  if (!fresh.length) return ''
  const tail = fresh.slice(-Math.max(1, Number(limit) || 5))
  return [
    '## 触发器提醒（账里这一轮该调的）',
    '',
    ...tail.map((l) => `- ${l}`),
    '',
    '（这些是**提醒**，不是已经调用过。要真调，还得自己按下去。）',
  ].join('\n')
}

const DEFAULTS = {
  /** 记忆根（工作区根）。空 = 用会话工作区。 */
  root: '',
  /** 判断层目录（相对工作区根）。反写落在这层——每个人指自己的，别随包带出去。 */
  judgmentDir: 'knowledge',
  /** 流水层目录（相对工作区根） */
  journalDir: 'persona-ai/knowledge/session',
  /** 一次 recall 的默认预算（字） */
  budget: 2000,
  /** 归档干跑默认开 */
  dryRunDefault: true,
  /** 流水早于几天算过期 */
  archiveAfterDays: 7,
  /** 流水层占检索预算的最高比例 */
  journalShare: 0.15,

  // ── 两个库 + 注入顺序 ────────────────────────────────────────────────────
  /** 长期记忆目录（相对工作区根）：攒下来的，还没进人格 */
  longTermDir: 'persona-ai/knowledge/长期记忆',
  /** 临时库注入最近几天的流水 */
  injectShortDays: 2,
  /** 即时记忆：两轮之间停多少分钟算「这一段结束了」——结束的那段转给短期 */
  nowGapMinutes: 45,
  /** 临时库 / 即时库要不要注入 */
  injectTemp: true,
  injectNow: true,
  /** 注入顺序的基准：即时 10 → 人格原文件 20/22 → 短期 25 → 其他记忆 30 */
  injectOrder: 10,
  /**
   * 注全的上限（字）。超了就截，而且要说出来。
   *
   * ★ 闸是**天数**（injectShortDays），不是这个数。这里只是防爆的最后一道：
   *   2 天的真实流水就可能十几万字（11-01 单日 31 万字节），
   *   拿 6 万当闸等于天天砍掉一半。所以放到 20 万——正常天数下不该碰到它。
   */
  /**
   * 短期那格的字数预算。**按字数切，不按条数平分。**
   * 一天 420 轮里大半是同一件事说三遍；按条数切，刚说的和昨天最早那句同价。
   * 从最新往回累加，字到哪儿切到哪儿。
   */
  shortBudgetChars: 30000,
  maxInjectChars: 200000,
  /** 主体词：撞上就加分 */
  subjectWords: [],
  /** 加固要不要参与排序 */
  reinforce: true,
}

/** 设置页写在哪：工作区里的 .persona-framework/记忆配置.json */
function settingsPathOf(cfg) {
  const root = cfg?.root ? String(cfg.root) : ''
  if (!root) return ''
  return join(root, SETTINGS_DIR, SETTINGS_FILE)
}

function cfgOf(ctx, cfg) {
  const c = { ...DEFAULTS, ...(cfg || {}) }
  if (!c.root) {
    try {
      const wd = ctx?.config?.workspace || ctx?.workspace
      if (wd) c.root = String(wd)
    } catch { /* 保持空 */ }
  }
  // 设置页改的（白名单字段）压过 cordis 配置：界面上刚改的就是最新意愿。
  // 只收白名单里的键——设置文件被写坏，最多丢掉一个字段，不会让插件跑挂。
  c._settingsPath = settingsPathOf(c)
  if (c._settingsPath && existsSync(c._settingsPath)) {
    try {
      Object.assign(c, normalizeStored(JSON.parse(readFileSync(c._settingsPath, 'utf8'))))
    } catch { /* 读坏当没有，用默认 */ }
  }
  return c
}

function layersOf(cfg) {
  const L = JSON.parse(JSON.stringify(DEFAULT_LAYERS))
  // 判断层 / 流水层指哪儿：按 config 覆盖，包里的默认值保持中立
  if (cfg.judgmentDir) L.judgment.dirs = [String(cfg.judgmentDir)]
  if (cfg.journalDir) L.journal.dirs = [String(cfg.journalDir)]
  // journal 的权重和份额可配；其余层按默认
  if (cfg.journalShare != null && L.journal) {
    L.journal.weight = Math.max(0, Math.min(1, Number(cfg.journalShare)))
  }
  return L
}

/**
 * 加固打分器：给 recall 用，只在同一层里排先后。
 *
 * 两样东西拼起来：
 *   · **时间性**——账上记的 `at`，没有就按文件 mtime；越近越靠前。
 *   · **主体线**——账上记的 `hits`（撞了几个主体词）。
 *
 * 账是 `memory_reinforce` 跑出来的。没跑过也有分：只算时间那一半，
 * 主体那一半空着——**空着比编一个好**。
 */
function scoreOfFile(root, cfg) {
  const { entries } = loadReinforce(root)
  const now = Date.now()
  const subjects = Array.isArray(cfg.subjectWords) && cfg.subjectWords.length
    ? cfg.subjectWords : DEFAULT_SUBJECTS
  return (f) => {
    let rel = ''
    try { rel = relative(root, f.path).split('\\').join('/') } catch { rel = String(f.path || '') }
    const prev = entries[rel]
    const at = (prev && prev.at) || (f.mtime ? new Date(f.mtime).toISOString() : '')
    const days = at ? Math.max(0, (now - Date.parse(at)) / 86400_000) : null
    const hits = prev ? (Number(prev.hits) || 0) : 0
    // 和 reinforce.mjs 的 scoreOf 同一个式子；这里不读文件内容，所以不重算 hits
    const score = 0.6 * (0.5 ** ((days == null ? 0 : days) / 7)) + 0.4 * Math.min(1, hits / 3)
    return Number.isFinite(score) ? score : 0
  }
}

/** 会话工作区缓存：pre-step 时从 agent.session.header.cwd 拿到，同步路径也用它。 */
let sessionWs = ''

function noteSessionWs(payload) {
  const cwd = payload?.agent?.session?.header?.cwd
  if (typeof cwd === 'string' && cwd) sessionWs = cwd
}

/**
 * 同步路径（注入、加固、账）的工作区。
 * ★ 只认配置和进程 cwd 会落到 profile 目录——那会把账写到别人家去，踩过。
 *   顺序：配置 → 会话工作区（pre-step 缓存）→ ctx.config.workspace → 进程 cwd。
 */
function resolveRoot(ctx, cfg) {
  if (cfg?.root) return cfg.root
  if (sessionWs) return sessionWs
  if (ctx?.config?.workspace) return String(ctx.config.workspace)
  return process.cwd()
}

// ── 注入配额（只在别处写了才生效）──────────────────────────────────────
// 由 dsh-persona-energy 的电源模式写：<工作区>/.persona-framework/注入配额.json
// 0 = 不限，负数 = 这份不摆，正数 = 最多这么多字。读不到就当没这回事。
function quotaCaps(ctx, cfg) {
  try {
    const root = resolveRoot(ctx, cfg)
    const file = join(root, '.persona-framework', '注入配额.json')
    if (!existsSync(file)) return {}
    const j = JSON.parse(readFileSync(file, 'utf8'))
    return (j && typeof j === 'object' && j.caps && typeof j.caps === 'object') ? j.caps : {}
  } catch { return {} }
}

function applyCap(ctx, cfg, text, key) {
  const caps = quotaCaps(ctx, cfg)
  // 旧键名还认：只写了 memoryShort 的，就是流水那一份
  const v = caps[key] !== undefined ? caps[key] : (key === 'memoryJournal' ? caps.memoryShort : undefined)
  if (typeof v !== 'number' || !Number.isFinite(v)) return text
  if (v < 0) return ''
  if (v === 0) return text
  const t = String(text || '')
  return t.length <= v ? t : t.slice(0, v) + `\n（电源模式截到 ${v} 字。要全文：memory_source 按指针翻。）`
}

async function wd(ctx, cfg) {
  if (cfg.root) return cfg.root
  // ★ 服务名不止一个，两个都试：别的地方用 workingDirectory，这里原来只试 workspace。
  //   只认一个，换环境就会有一边取不到工作区。
  try {
    const v = await ctx?.get?.('workspace')
    if (typeof v === 'string' && v) return v
    if (v?.cwd) return v.cwd
  } catch { /* 落空 */ }
  try {
    const d = await ctx?.get?.('workingDirectory')
    const dir = typeof d === 'string' ? d : d?.defaultDirectory
    if (dir) return dir
  } catch { /* 落空 */ }
  return process.cwd()
}

/**
 * 每个工具的 output 声明。
 * ★ 宿主硬要求：tool 必须 declare output { schema, render }。
 *   漏了不是「渲染不好看」，是**注册期直接 TypeError、整个插件不激活**——
 *   装上了、profile 里看得见、就是不动。这一条在 UPDATE-GUIDE 里记着，我写这个插件时还是漏了。
 */
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

/** 给前端递一份 JSON；出错也要回一份，别让页面挂在转圈上 */
function sendJson(res, status, payload) {
  try {
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(JSON.stringify(payload))
  } catch {
    try { res.end('{}') } catch { /* 收摊 */ }
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 64 * 1024) { reject(new Error('请求太大')); try { req.destroy() } catch { /* 收摊 */ } }
    })
    req.on('end', () => resolve(raw))
    req.on('error', reject)
  })
}

export function apply(ctx, config = {}) {
  const cfg = cfgOf(ctx, config)

  // 现取一台：设置页刚存进去的值，下一次读就得看得见。
  // 只在启动时算一次 cfg，界面「保存后变回 30000」就是这么来的——
  // 文件写对了，回显和注入用的还是启动那一刻的旧值。
  const live = () => cfgOf(ctx, config)

  // ── 设置页：读／写 ──────────────────────────────────────────────────────
  // 两件事分开：读报「当前真在用的值」，写只收白名单字段并留一份旧的。
  // 写坏了能退回——覆盖写不备份，等于没有撤销。
  ctx.effect(() => ctx.webServer?.register({
    kind: 'exact',
    path: '/api/persona-memory/status',
    handler(req, res) {
      try {
        const now = live()
        sendJson(res, 200, {
          ok: true,
          fields: FIELDS,
          values: pickCurrent(now),
          file: now._settingsPath || '',
          fileExists: !!(now._settingsPath && existsSync(now._settingsPath)),
          root: now.root || '',
        })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  }))

  ctx.effect(() => ctx.webServer?.register({
    kind: 'exact',
    path: '/api/persona-memory/config',
    async handler(req, res) {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: '只收 POST' })
          return
        }
        // 现取：写和读必须指同一个文件。启动时算的 cfg 只在那一次是对的，
        // 工作区一换、root 一改，写和读就分家了。
        const file = live()._settingsPath
        if (!file) {
          sendJson(res, 400, { ok: false, error: '没有可写的位置：config.root 是空的' })
          return
        }
        const raw = await readRequestBody(req)
        let patch = {}
        try {
          patch = normalizePatch(JSON.parse(raw || '{}'))
        } catch {
          sendJson(res, 400, { ok: false, error: '递上来的不是合法 JSON' })
          return
        }
        if (!Object.keys(patch).length) {
          sendJson(res, 400, { ok: false, error: '没有一个字段过得了白名单（键名或范围不对）' })
          return
        }
        let current = {}
        let existed = false
        try {
          current = normalizeStored(JSON.parse(readFileSync(file, 'utf8')))
          existed = true
        } catch { current = {} }
        const next = { ...current, ...patch }
        mkdirSync(dirname(file), { recursive: true })
        if (existed) {
          try { writeFileSync(`${file}.bak`, readFileSync(file, 'utf8'), 'utf8') } catch { /* 备份失败不拦 */ }
        }
        writeFileSync(file, JSON.stringify(next, null, 2) + '\n', 'utf8')
        // 别一句「都生效了」盖过去：这张表里只有四个数是真的每轮现读，
        // 其余是注册时（段在不在、排第几）或启动时（工具默认值）定的，
        // 写完得重载插件才换得过来。分开报，人才知道刚才那一下动没动。
        const LIVE_KEYS = ['injectShortDays', 'shortBudgetChars', 'nowGapMinutes', 'maxInjectChars']
        const savedKeys = Object.keys(patch)
        const liveKeys = savedKeys.filter((k) => LIVE_KEYS.includes(k))
        const laterKeys = savedKeys.filter((k) => !LIVE_KEYS.includes(k))
        const note = laterKeys.length
          ? `存好了。${liveKeys.length ? `${liveKeys.join('、')} 下一轮就生效；` : ''}` +
            `${laterKeys.join('、')} 要重载插件才生效（它们是注册时或启动时定下的值）。`
          : '存好了。下一轮组装系统提示词时就用新值。'
        sendJson(res, 200, {
          ok: true,
          saved: savedKeys,
          live: liveKeys,
          later: laterKeys,
          next,
          file,
          note,
        })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  }))

  const need = (s) => {
    if (!s) throw new Error('persona-memory 需要会话工作区，读不到。请显式设 config.root。')
    return s
  }

  const tools = [
    {
      name: 'memory_stats',
      description:
        '看记忆池的账：每层多少个文件、多少字、占多少、检索权重多少。' +
        '先跑这个——它会直接指出「流水层占了多少」，那是记忆变慢的常见原因。只读，不改任何文件。',
      parameters: { type: 'object', properties: {} },
      output: textOutput,
      execute: async () => {
        const root = need(await wd(ctx, cfg))
        const scan = scanPools(root, layersOf(cfg))
        return { text: renderPools(scan) }
      },
    },
    {
      name: 'memory_gate',
      description:
        '写入门禁：问一条路径该按哪一档写、还缺什么复核。' +
        '四档——流水 0 随便写、判断 1 要先想一遍、模块库 2 要想+验、人格 3 要想+验（不经过人）。' +
        '判据不是「能不能写」（那是权限），是「写之前该过的程序过没过」。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要写的目标路径（相对工作区根）' },
          reviewers: {
            type: 'array',
            items: { type: 'string' },
            description: "这次已经做过的复核：'reflect'（先想过）/ 'verify'（验过）",
          },
        },
        required: ['path'],
      },
      output: textOutput,
      execute: async (args = {}) => {
        const v = decideWrite({ path: args.path, reviewers: args.reviewers || [] })
        return { text: explainGate(v) }
      },
    },
    {
      name: 'memory_ledger',
      description:
        '记忆账的一个入口，十二个动作：link 连边、edges 查边、walk 沿边走几层、reject 记一条被证伪的假设、rejected 看负记忆、'
        + 'anchor 钉锚点、anchors 看锚点、state 记状态变化、chain 看状态链、'
        + 'reflect 回看盘上痕迹、flywheel 捞最近的改口现场、consistency 查有没有重犯旧错。',
      parameters: {
        type: 'object',
        properties: {
          op: {
            type: 'string',
            enum: ['link', 'edges', 'walk', 'reject', 'rejected', 'anchor', 'anchors', 'state', 'chain', 'reflect', 'flywheel', 'consistency'],
            description: '要干哪一件',
          },
          from: { type: 'string', description: 'link：从哪条（指针，如 chat/2026-11-03.md#2）' },
          to: { type: 'string', description: 'link：到哪条' },
          type: { type: 'string', enum: ['cites', 'refutes', 'refines', 'same', 'supersedes'], description: 'link：什么关系' },
          node: { type: 'string', description: 'edges 查哪条的边（不给就列全部）；walk 从哪条开始走' },
          claim: { type: 'string', description: 'reject：哪条假设被证伪了' },
          why: { type: 'string', description: 'link / reject / anchor：为什么' },
          evidence: { type: 'string', description: 'reject / state：证据（原话、指针、路径）' },
          text: { type: 'string', description: 'anchor：哪句话不能忘' },
          source: { type: 'string', description: 'anchor：指回原文' },
          subject: { type: 'string', description: 'state / chain：变化的主体' },
          slot: { type: 'string', description: 'state：哪个槽（默认 default）' },
          old: { type: 'string', description: 'state：旧值' },
          next: { type: 'string', description: 'state：新值' },
          kind: {
            type: 'string',
            enum: ['migration', 'retraction', 'enablement', 'acquisition', 'replacement'],
            description: 'state：变化类型（不给就按 old/next 推；两个都空要显式给）',
          },
          days: { type: 'number', description: 'flywheel：看最近几天（默认 7）' },
          depth: { type: 'number', description: 'walk：走几层（默认 2）' },
          max: { type: 'number', description: 'walk：最多走几条（默认 30）' },
        },
        required: ['op'],
      },
      output: textOutput,
      execute: async (args = {}) => {
        const root = need(await wd(ctx, cfg))
        const op = String(args.op || '')
        try {
          switch (op) {
            case 'link': {
              const r = edgeLink(root, { from: args.from, to: args.to, type: args.type, why: args.why })
              return { text: `连上了：${r.from} --${r.type}--> ${r.to}` }
            }
            case 'edges':
              return { text: renderEdges(root, args.node) }
            case 'walk':
              return { text: renderWalk(root, args.node, { depth: args.depth, max: args.max }) }
            case 'reject': {
              const r = rejectClaim(root, { claim: args.claim, why: args.why, evidence: args.evidence })
              return { text: `记下了：${r.claim}（落在 ${r.file}）` }
            }
            case 'rejected':
              return { text: renderRejected(root) }
            case 'anchor': {
              const r = addAnchor(root, { text: args.text, source: args.source, why: args.why })
              return { text: r.added ? `钉住了：${r.text}（共 ${r.count} 条）` : r.note }
            }
            case 'anchors':
              return { text: renderAnchors(root) }
            case 'state': {
              const r = recordState(root, {
                subject: args.subject,
                slot: args.slot,
                old: args.old ?? null,
                new: args.next ?? null,
                kind: args.kind,
                evidence: args.evidence,
              })
              return { text: `记下了：${r.subject} 第 ${r.seq} 次 · ${r.kind}` }
            }
            case 'chain':
              return { text: renderState(root, args.subject) }
            case 'reflect':
              return { text: renderReflect(root) }
            case 'flywheel':
              return { text: renderFlywheel(root, { days: args.days }) }
            case 'consistency':
              return { text: renderConsistency(root) }
            default:
              return { text: `没有这个 op：${op}（可用：link / edges / reject / rejected / anchor / anchors / state / chain / reflect / flywheel / consistency）` }
          }
        } catch (error) {
          return { text: `没成：${error?.message || error}` }
        }
      },
    },
    {
      name: 'memory_condense',
      description:
        '把流水（每轮全文）压成「一行一条」，写进判断层；原文留在原处不动。' +
        '默认干跑，只看结果不写文件；确认后再 dryRun=false。格式认不出就跳过，不瞎提炼。',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: '流水目录（相对工作区），默认 persona-ai/knowledge/session' },
          to: { type: 'string', description: '写到哪，默认 persona-ai/knowledge/chat' },
          dryRun: { type: 'boolean', description: '默认 true（只看不写）' },
        },
      },
      output: textOutput,
      execute: async (args = {}) => {
        const root = need(await wd(ctx, cfg))
        const r = condenseJournal(root, {
          from: args.from, to: args.to,
          dryRun: args.dryRun !== false && cfg.dryRunDefault !== false ? args.dryRun !== false : args.dryRun === true,
        })
        return { text: renderCondense(r) }
      },
    },
    {
      name: 'memory_archive',
      description:
        '把早于 N 天的流水文件挪进 _archive/（归档层不参与检索）。默认干跑。' +
        '只挪位置，不动内容——要核对随时翻回去。',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: '早于几天算过期，默认取配置 archiveAfterDays（7）' },
          dryRun: { type: 'boolean', description: '默认 true' },
        },
      },
      output: textOutput,
      execute: async (args = {}) => {
        const root = need(await wd(ctx, cfg))
        const r = archiveOld(root, {
          days: args.days ?? cfg.archiveAfterDays,
          dryRun: args.dryRun === true,
          layers: layersOf(cfg),
        })
        return { text: renderArchive(r) }
      },
    },
    {
      name: 'memory_slim_report',
      description:
        '记忆体检：按记忆自己的分层报数（判断/理论/外部/流水/归档），并标出哪几层**进前缀**。' +
        '判据：只有进前缀的那部分每步真花钱；归档层删它一分不省，所以只搬不删。',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: '流水几天算超期，默认取配置 archiveAfterDays（7）' },
        },
      },
      output: textOutput,
      execute: async (args = {}) => {
        const root = need(await wd(ctx, cfg))
        const layers = layersOf(cfg)
        const rows = measureLayers(root, layers)
        const days = args.days ?? cfg.archiveAfterDays ?? 7
        const journalDirs = (layers.journal && layers.journal.dirs) || ['persona-ai/knowledge/session']
        const overdue = journalDirs.reduce((n, d) => n + countOverdue(root, d, days), 0)
        const indexFile = join(root, 'persona-ai', 'knowledge', 'INDEX.md')
        const index = existsSync(indexFile) ? `有（persona-ai/knowledge/INDEX.md）` : '还没有，跑一次 memory_index 就建起来'
        // 上限照配置走，别写死——写死就会跟注入那边对不上。
        const budgets = [
          { key: 'short', label: '短期记忆', chars: Number(cfg.shortChars ?? 20000), note: '只摆最近几天，超了截断' },
          { key: 'other', label: '其他记忆', chars: Number(cfg.maxOtherChars ?? 3000), note: '只摆标题行' },
          { key: 'long', label: '长期记忆', chars: 0, note: '全部摆（条目少才允许）' },
          { key: 'live', label: '实时检索', chars: Number(cfg.live?.maxChars ?? 1600), note: '撞上的几条，带指针' },
          { key: 'now', label: '最近这一阵', chars: Number(cfg.nowChars ?? 800), note: '刚浮上来的几条' },
        ]
        return { text: renderSlimReport(rows, { days, overdue, index, budgets }) }
      },
    },
    {
      name: 'memory_index',
      description:
        '重建 persona-ai/knowledge/INDEX.md：每个域多少文件、多少 KB。' +
        '这份索引**不进前缀**，是给我按图取用的；不传 apply 只看会写哪、写多大。',
      parameters: {
        type: 'object',
        properties: { apply: { type: 'boolean', description: 'true 才真写；省掉只看' } },
      },
      output: textOutput,
      execute: async (args = {}) => {
        const root = need(await wd(ctx, cfg))
        const rows = measureLayers(root, layersOf(cfg))
        const preview = `会写 persona-ai/knowledge/INDEX.md：${rows.length} 层、${rows.reduce((n, r) => n + r.files, 0)} 个文件、${(rows.reduce((n, r) => n + r.bytes, 0) / 1024).toFixed(1)} KB。`
        if (args.apply !== true) return { text: preview + '\n\n要真写：memory_index({apply:true})' }
        const r = rebuildIndex(root, (cfg.knowledgeDir || 'persona-ai/knowledge'))
        return {
          text: `索引重建好了：${r.domains} 个域、${r.files} 个文件、${(r.bytes / 1024).toFixed(1)} KB。\n落到：${r.file.replace(/\\/g, '/')}\n它不进前缀，所以不花每轮的 token。`,
        }
      },
    },
    {
      name: 'memory_recall',
      description:
        '按预算取记忆：从各层按权重轮流取，判断层先拿满，流水层分到的少。' +
        '给 query 就只在含这串字的文件里取。预算用完就停，不因为池子大而变慢。',
      parameters: {
        type: 'object',
        properties: {
          budget: { type: 'number', description: '总共取多少字，默认取配置 budget（2000）' },
          query: { type: 'string', description: '只取含这串字的文件（可省）' },
        },
      },
      output: textOutput,
      execute: async (args = {}) => {
        const root = need(await wd(ctx, cfg))
        const r = recall(root, {
          budget: args.budget ?? cfg.budget,
          query: args.query,
          layers: layersOf(cfg),
          reinforce: cfg.reinforce === false ? null : scoreOfFile(root, cfg),
        })
        return { text: renderRecall(r) }
      },
    },
  ]

  tools.push({
    name: 'memory_source',
    description:
      '按指针取原文——**逐字片段，不做转述**。指针长这样：`session/2026-10-28.md#12`（第 12 个小节）。'
      + 'memory_condense 压出来的每一行都带指针；这条就是那扇门，翻回一手层核对。',
    parameters: {
      type: 'object',
      properties: {
        pointer: { type: 'string', description: '指针：`文件相对路径#序号`，如 session/2026-10-31.md#3' },
        chars: { type: 'number', description: '最多取多少字，默认 600' },
      },
      required: ['pointer'],
    },
      output: textOutput,
    execute: async (args = {}) => {
      const root = need(await wd(ctx, cfg))
      const raw = String(args.pointer || '').trim()
      const m = raw.match(/^(.*?)#(\d+)$/)
      if (!m) {
        return { text: `指针格式不对：\`${raw}\`
要的是 \`文件#序号\`，比如 \`session/2026-10-31.md#3\`。` }
      }
      const rel = m[1].replace(/^\/+/, '')
      const seq = Number(m[2])
      // 只许读记忆池里的，不许 ../ 出去
      if (rel.includes('..')) return { text: '指针不许带 ..，只取记忆池里的。' }
      const file = join(root, 'persona-ai/knowledge', rel)
      if (!existsSync(file)) {
        // 也试试直接把 rel 当相对工作区的路径
        const alt = join(root, rel)
        if (!existsSync(alt)) return { text: `没有这个文件：${rel}
（找过 persona-ai/knowledge/${rel} 和 ${rel}）` }
        const t = readFileSync(alt, 'utf8')
        return { text: `【逐字片段，未转述】${rel}#${seq}

${excerpt(t, seq, Number(args.chars ?? 600))}` }
      }
      const t = readFileSync(file, 'utf8')
      const seg = excerpt(t, seq, Number(args.chars ?? 600))
      if (!seg) return { text: `这个文件里没有第 ${seq} 个小节（${rel}）。数一下 \`## \` 标题有几个。` }
      return { text: `【逐字片段，未转述】${rel}#${seq}

${seg}` }
    },
  })

  // ── 按字查 ────────────────────────────────────────────────────────────────
  //
  // `memory_recall` 按意思找，它的强项是「像」；所以它永远能给出一段看起来相关的。
  // 而「师父说过这句没有」「我答应过他吗」要的是**按字**：在就是存在，不在就不存在，
  // 中间没有「很像」。这两件事不能用一个工具办。
  tools.push({
    name: 'memory_trace',
    description:
      '按字查：这句话到底在不在这本账上，是谁说的，在那一节。'
      + '要回答「我说过吗」「他答应过我吗」时**先查这个，别凭记忆**。'
      + '结果分三类：师父说的 / 她说的 / 认不出是谁说的。**只有「师父说的」能用来认承诺。**'
      + '它和 memory_recall 不是一回事：recall 只会给你「很像的一段」，这条是「有没有这句」。'
      + '说「没有」就是真没有——除非它说「没扫完」。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '要查的那句话，可以整段贴进来。' },
      },
      required: ['query'],
    },
    output: textOutput,
    execute: async (args = {}) => {
      const root = need(await wd(ctx, cfg))
      const q = String(args.query || '').trim()
      if (!q) return { text: '（要给一句话。）' }
      const dirs = (() => {
        const set = new Set()
        for (const l of Object.values(layersOf(cfg))) {
          if (Array.isArray(l?.dirs)) for (const d of l.dirs) set.add(d)
        }
        if (cfg.longTermDir) set.add(cfg.longTermDir)
        // 归档层不参与检索，这里也不翻——同一条约定，不能一个地方守一个地方不守。
        return [...set].filter((d) => !/_archive/.test(d))
      })()
      try {
        return { text: renderTrace(q, findVerbatim(root, dirs, q)) }
      } catch (e) {
        return { text: `（查的时候出错了：${e && e.message}。**这次不算查过**，别当成「没有」。）` }
      }
    },
  })

  tools.push({
    name: 'memory_reinforce',
    description:
      '加固：算「谁先浮上来」，只改排序、不动一个字节。两条线——时间性（越近越靠前，半衰期 7 天）'
      + '和主体线（撞到主体词越多越靠前）。默认只看（saved=false）；要落盘就 saved=true，写进 .persona-framework/加固.json。'
      + '加固不决定留不留，也不替你挑哪条重要。',
    parameters: {
      type: 'object',
      properties: {
        saved: { type: 'boolean', description: 'true = 算完落盘（recall 下次就按新分排）；默认只算不写' },
        subjects: { type: 'array', items: { type: 'string' }, description: '临时换一组主体词（可省，默认取配置）' },
      },
    },
    output: textOutput,
    execute: async (args = {}) => {
      const root = need(await wd(ctx, cfg))
      const layers = layersOf(cfg)
      const scan = scanPools(root, layers)
      const files = scan.pools.flatMap((p) => p.files)
      const subjects = Array.isArray(args.subjects) && args.subjects.length
        ? args.subjects : cfg.subjectWords
      const r = scoreFiles(root, files, { subjects })
      const saved = args.saved === true ? saveReinforce(root, r.items) : null
      return { text: renderReinforce({ items: r.items, saved }) }
    },
  })

  tools.push({
    name: 'memory_stimulus',
    description:
      '刺激记忆：一个词勾起一整串的那种。`op=add` 记一个「词 → 指针」；`op=list` 看整张表。'
      + '它是钩子不是鱼——存的是指针，内容还得用 memory_source 翻回去。',
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['add', 'list'], description: 'add 记一条 / list 看全表' },
        word: { type: 'string', description: 'op=add：触发词（如「加固」）' },
        pointer: { type: 'string', description: 'op=add：指到哪，如 session/2026-10-31.md#3' },
      },
      required: ['op'],
    },
    output: textOutput,
    execute: async (args = {}) => {
      const root = need(await wd(ctx, cfg))
      if (args.op === 'add') {
        const r = addStimulus(root, args.word, args.pointer)
        if (!r.ok) return { text: `没记：${r.why}` }
        return { text: `记下了：「${r.word}」现在挂着 ${r.count} 个指针（${STIMULUS_FILE}）。\n**钩子不是鱼**：指针只是门，内容回去翻原文。` }
      }
      const { words } = readStimulus(root)
      const keys = Object.keys(words || {})
      if (!keys.length) return { text: `刺激记忆是空的（${STIMULUS_FILE} 还没有）。` }
      const lines = [`刺激记忆：${keys.length} 个钩子`, '']
      for (const k of keys) {
        const refs = Array.isArray(words[k]) ? words[k] : [words[k]]
        lines.push(`- **${k}** → ${refs.map((x) => `\`${x}\``).join('、')}`)
      }
      return { text: lines.join('\n') }
    },
  })

  for (const t of tools) ctx.tools?.register?.(t)

  // ── 加固账自动刷新 ──────────────────────────────────────────────────────
  //
  // 加固分 = 时间线 + 主体线：
  //   · 时间线（`at` 距今天）每次**现算**，不会老；
  //   · 主体线（`hits`，撞了几个主体词）得从 `.persona-framework/加固.json` 里读，
  //     账不刷新，它就是死的——新文件进不来，旧文件的命中数也永远不变。
  //
  // 所以：启动补一次（账可能还是几天前的），之后每 12 小时一次。
  // 算不出来就不吭声，recall 会退回只算时间那一半——比报错强。
  if (cfg.reinforce !== false) {
    const refreshReinforce = () => {
      try {
        const root = resolveRoot(ctx, cfg)
        const files = scanPools(root, layersOf(cfg)).pools.flatMap((p) => p.files)
        if (!files.length) return
        const subjects = Array.isArray(cfg.subjectWords) && cfg.subjectWords.length
          ? cfg.subjectWords : DEFAULT_SUBJECTS
        saveReinforce(root, scoreFiles(root, files, { subjects }).items)
      } catch { /* 加固算不出来不挡事 */ }
    }
    ctx.effect?.(() => {
      const first = setTimeout(refreshReinforce, 5_000)
      const every = setInterval(refreshReinforce, 12 * 3600_000)
      first?.unref?.()
      every?.unref?.()
      return () => { clearTimeout(first); clearInterval(every) }
    })
  }

  // ── 注入顺序：即时 → 人格原文件 → 长期记忆 → 短期记忆 → 其他记忆 ──────────
  //
  // ★ 顺序是师父定的硬要求，不是风格：
  //   1. 即时记忆   order 10 —— 这一轮正在说什么（在手上，不在盘上；给钩子）
  //   2. 人格原文件 order 20/22（另一份插件）—— 我一贯怎么说话
  //   3. 长期记忆   order 23 —— **紧跟人格原文件后面**：从短期里挑出来的值，记得久、而且重要
  //   4. 短期记忆   order 25 —— 这几天到底干了什么（缩过、按字数切）
  //   5. 其他记忆   order 30 —— 其余的都在这一格（判断、见闻、网络、词表、收件箱），只摆标题行
  //
  //   三、五两格**不是一格**。以前把它们并成过一格，把「其他记忆」写成了「长期那格」，错了：
  //   其他记忆是「别的都放这儿」，长期记忆是「攒下来不多、够久也够重的那几条」。
  //   长期记忆贴人格，是因为它和人格最近；其他记忆垫底，因为它最杂。
  //
  //   后三样都**注全**（不检索、不截断，除了 maxInjectChars 那道明说的上限），
  //   而且记忆**比人格原文件重要**——两样打架时，昨天那个是真的。
  //   这不是「记忆压人格」，是「不填缝」：两样都摆出来，让它自己撞。
  const baseOrder = Number(cfg.injectOrder ?? 10)

  if (cfg.injectNow !== false) {
    try {
      ctx.effect(() => ctx.systemPrompt.section({
        name: 'persona-memory:now',
        order: baseOrder,
        interpolate: false,
        text: () => {
          if (gateSkip()) return ''
          try {
            const c = live()
            const root = resolveRoot(ctx, c)
            return renderNowLibrary(root, c)
          } catch (error) {
            return `## 即时记忆库\n\n读不出来：${error?.message || error}`
          }
        },
      }))
    } catch { /* 没有 systemPrompt 也能用 */ }
  }

  if (cfg.injectTemp !== false) {
    try {
      ctx.effect(() => ctx.systemPrompt.section({
        name: 'persona-memory:short',
        order: baseOrder + 15, // 10 → 25：让开人格原文件的 20/22
        interpolate: false,
        text: () => {
          if (gateSkip()) return ''
          try {
            const c = live()
            const root = resolveRoot(ctx, c)
            return applyCap(ctx, c, renderShortLibrary(root, c), 'memoryJournal')
          } catch (error) {
            return `## 短期记忆\n\n读不出来：${error?.message || error}\n（**说得出读不出来，比假装注全了强**。）`
          }
        },
      }))
    } catch { /* 没有 systemPrompt 也能用 */ }

    try {
      ctx.effect(() => ctx.systemPrompt.section({
        name: 'persona-memory:other',
        order: baseOrder + 20, // 10 → 30：其他记忆排在短期之后
        interpolate: false,
        text: () => {
          if (gateSkip()) return ''
          try {
            const c = live()
            const root = resolveRoot(ctx, c)
            // 「其他」那一格按记忆分层各读各的上限：判断(chat)/理论(world,lexicon)/外部(web,human,net)
            return renderOtherLibrary(root, { ...c, otherCaps: quotaCaps(ctx, c) })
          } catch (error) {
            return `## 其他记忆\n\n读不出来：${error?.message || error}`
          }
        },
      }))
    } catch { /* 没有 systemPrompt 也能用 */ }

    try {
      ctx.effect(() => ctx.systemPrompt.section({
        name: 'persona-memory:long-term',
        order: baseOrder + 13, // 10 → 23：**紧紧跟在人格原文件（20/22）后面**，排在短期（25）之前
        interpolate: false,
        text: () => {
          if (gateSkip()) return ''
          try {
            const c = live()
            const root = resolveRoot(ctx, c)
            return applyCap(ctx, c, renderLongLibrary(root, c), 'memoryLong')
          } catch (error) {
            return `## 长期记忆\n\n读不出来：${error?.message || error}`
          }
        },
      }))
    } catch { /* 没有 systemPrompt 也能用 */ }
  }

  // 记账与认账：记忆的规矩。**不受任何开关管**——内容可以不摆，规矩不能不在。
  try {
    ctx.systemPrompt?.section?.({
      name: 'persona-memory:ledger',
      order: 59,
      interpolate: false,
      text: () => renderLedgerNote(),
    })
  } catch { /* 没有 systemPrompt 也能用 */ }

  // 注入一段提示：让主模型知道「先 stats，别全量读」
  if (cfg.hint !== false) {
    try {
      ctx.systemPrompt?.section?.({
        name: 'persona-memory',
        order: 61,
        text: [
          '## 记忆池怎么用',
          '记忆池分五层：判断、理论、外部、流水、归档。**流水不是记忆**——它是每轮全文，检索时只分到很少的预算。',
          '要回忆一件事：先 `memory_recall`（按预算取，别全量读）；要看清池子多大、谁在吃预算：`memory_stats`。',
          '觉得「想不起来的变多了」，先跑 `memory_stats` 看流水层占比，再决定是 `memory_condense` 提炼还是 `memory_archive` 减重。',
          '',
        ].join('\n'),
      })
    } catch { /* 没有 systemPrompt 也能用 */ }
  }

  // ── 钩子触发器 ────────────────────────────────────────────────────────────
  // 钩子不是定时，是挂在宿主必经点上：组装提示词时、会话事件时。
  // 所以它绕不过去——比触发器表更硬。灵枢原插件就是这么干的：
  // `system-prompt/assemble` + `session/event` 两个钩子，再加一堆 op 当工具。
  //
  // 两条纪律：
  //   1. 钩子失败绝不能影响主流程：全部 try/catch，出错静默。
  //   2. assemble 里 push 的内容每步要稳定：宿主按内容判重，
  //      同一轮里内容变了会多付一份快照。所以这里节流 + 缓存文本。
  if (cfg.hooks !== false) {
    let lastAssembleAt = 0
    let consistencyNote = ''
    let lastReflectDay = ''
    let dailyNote = ''
    let dailyPushed = false
    // 实时记忆要用的那句话：从 `agent/pre-step` 拿「进入这一步的最后一条用户消息」。
    // 为什么从这儿借：`system-prompt/assemble` 的 AssembleContext 只有 scope/signal，
    // 拿不到本轮输入；pre-step 的 payload 里有 messages，那是一手。
    // 拿不到就空着——不拿上一轮的话顶替，那会把「这一轮相关」变成「上一轮相关」。
    let liveQuery = ''
    let liveQueryAt = 0
    try {
      ctx.on('agent/pre-step', async (payload, next) => {
        // 记步：本插件自己那一份 gate 只有自己写、自己读，才谈得上不依赖别人。
        // 不记的话 gateSkip() 永远说「第一步」，四段全量注入每步都跑一遍。
        noteStep(payload)
        try { noteSessionWs(payload) } catch { /* 拿不到就继续用旧的 */ }
        try {
          const msgs = payload?.messages
          if (Array.isArray(msgs) && msgs.length) {
            const last = msgs[msgs.length - 1]
            const text = typeof last?.content === 'string'
              ? last.content
              : Array.isArray(last?.content)
                ? last.content.map((b) => (typeof b?.text === 'string' ? b.text : '')).join(' ')
                : ''
            const t = String(text || '').trim()
            if (t) {
              liveQuery = t.slice(0, 500)
              liveQueryAt = Date.now()
            }
          }
        } catch { /* 取不到就当这一轮没有输入可扫 */ }
        return next()
      })
    } catch { /* 没有这个钩子也能用 */ }
    try {
      ctx.on('system-prompt/assemble', async (assembly, _c, next) => {
        try {
          const root = resolveRoot(ctx, cfg)
          const now = Date.now()
          if (now - lastAssembleAt > 10 * 60_000) {
            lastAssembleAt = now
            const hits = consistencyCheck(root)
            consistencyNote = hits.length
              ? [
                '## 一致性提醒（自动）',
                '',
                `有 ${hits.length} 处记忆把已经被证伪的说法又写了一遍（负记忆里判过）。要看清：调 \`memory_consistency\`。`,
              ].join('\n')
              : ''
          }

          // 每天第一次组装时回看一次。只报异常，正常一句不吭；报过就不再报。
          // 这条是「记忆账七件套」里唯一够得上自动触发的：其余六样要我判断，自动不了。
          const today = new Date().toISOString().slice(0, 10)
          if (lastReflectDay !== today) {
            lastReflectDay = today
            dailyPushed = false
            try {
              const r = reflectOnce(root)
              dailyNote = r.warns?.length
                ? ['## 记忆回看（每天一次）', '', ...r.warns.map((w) => `- ${w}`)].join('\n')
                : ''
              if (dailyNote) {
                auditRecord(root, { op: 'reflect', decision: 'allow', why: r.warns.join('；').slice(0, 300) })
              }
            } catch { dailyNote = '' }
          }
          if (!Array.isArray(assembly?.contexts)) return next()

          // 实时记忆：拿刚那一句去扫，撞上了才摆；撞不上就空着——空着比凑数强。
          try {
            if (cfg.liveMemory !== false && liveQuery && Date.now() - liveQueryAt < 5 * 60_000) {
              const liveLimit = Number(cfg.liveLimit) || DEFAULT_LIVE.limit
              const liveChars = Number(cfg.liveChars) || DEFAULT_LIVE.maxChars
              const hits = liveMemory(root, liveQuery, {
                limit: liveLimit,
                maxChars: liveChars,
                days: Number(cfg.liveDays) || DEFAULT_LIVE.days,
              })
              const note = renderLive(hits, { maxChars: liveChars })
              if (note) {
                const capped = applyCap(ctx, cfg, note, 'live')
                if (capped) assembly.contexts.push({ name: 'persona-memory:live', text: capped })
              }
            }
          } catch { /* 算不出来就不摆 */ }

          // 触发器写下的提醒：摆到眼前，但不许说成已经调过。
          try {
            if (cfg.remindToContext !== false) {
              const note = renderRemindNote(root, { limit: Number(cfg.remindLimit) || 5 })
              if (note) assembly.contexts.push({ name: 'persona-memory:remind', text: note })
            }
          } catch { /* 读不到就不摆 */ }

          if (consistencyNote) {
            assembly.contexts.push({ name: 'persona-memory:consistency', text: consistencyNote })
          }

          // 每日回看只推一次：推过就归零，不留常驻的提醒。
          if (dailyNote && !dailyPushed) {
            assembly.contexts.push({ name: 'persona-memory:reflect', text: dailyNote })
            dailyPushed = true
          }

          // 合并去重 + 总预算：逻辑在 lib/merge.mjs，这里只负责删。
          // 只认本插件注的段，别人的一个字都不动；只删不重排。
          for (const c of mergeMemoryContexts(assembly.contexts, cfg.assembleBudgetChars)) {
            const i = assembly.contexts.indexOf(c)
            if (i >= 0) assembly.contexts.splice(i, 1)
          }
        } catch { /* 钩子失败不影响主流程 */ }
        return next()
      })
    } catch { /* 没有这个钩子也能用 */ }

    let lastEventAt = 0
    try {
      ctx.on('session/event', (session, event) => {
        try {
          // 只记消息类事件，且一分钟最多一条——每个工具结果都记会把账淹掉
          if (!String(event?.type || '').includes('message')) return
          const now = Date.now()
          if (now - lastEventAt < 60_000) return
          lastEventAt = now
          const root = resolveRoot(ctx, cfg)
          auditRecord(root, { op: 'message', decision: 'allow', why: '会话事件（钩子自动记）' })
        } catch { /* 静默 */ }
      })
    } catch { /* 没有这个钩子也能用 */ }
  }
}

export const config = {
  root: { type: 'string', default: '', description: '记忆根（工作区根）。留空用会话工作区。' },
  judgmentDir: { type: 'string', default: 'knowledge', description: '判断层目录（相对工作区根）。反写落这层——每个装的人指自己的，别随包带出去。' },
  journalDir: { type: 'string', default: 'persona-ai/knowledge/session', description: '流水层目录（相对工作区根）' },
  budget: { type: 'number', default: 2000, min: 200, max: 20000, description: '一次 recall 的默认字数预算' },
  archiveAfterDays: { type: 'number', default: 7, min: 1, max: 365, description: '流水早于几天算过期' },
  journalShare: { type: 'number', default: 0.15, min: 0, max: 1, description: '流水层最多占检索预算的比例' },
  dryRunDefault: { type: 'boolean', default: true, description: 'condense / archive 默认只干跑' },
  hint: { type: 'boolean', default: true, description: '往系统提示里加一段「记忆池怎么用」' },
  longTermDir: { type: 'string', default: 'persona-ai/knowledge/长期记忆', description: '长期记忆目录（相对工作区根）：攒下来的，还没进人格' },
  injectTemp: { type: 'boolean', default: true, description: '临时库注不注入（人格原文件之后、注全）' },
  injectNow: { type: 'boolean', default: true, description: '即时库注不注入（临时库之后、注全）' },
  injectOrder: { type: 'number', default: 10, min: 1, max: 999, description: '注入顺序的基准：即时=它，短期=它+15，其他记忆=它+20。人格原文件在 20/22，正好夹在中间' },
  nowGapMinutes: { type: 'number', default: 45, min: 5, max: 240, description: '即时记忆按停顿分段：两轮之间停多少分钟算这一段结束（结束的那段转给短期）' },
  injectShortDays: { type: 'number', default: 2, min: 1, max: 60, description: '临时库里的短期记忆取最近几天' },
  shortBudgetChars: { type: 'number', default: 30000, min: 2000, max: 400000, description: '短期那格的字数预算：按字数从最新往回切，不按条数平分' },
  maxInjectChars: { type: 'number', default: 200000, min: 2000, max: 400000, description: '注全的上限（字）；闸是天数，这里只防爆；超了会截断并写明' },
  subjectWords: { type: 'array', items: { type: 'string' }, description: '主体词：文档里撞上就加权（留空用内置那张表）' },
  reinforce: { type: 'boolean', default: true, description: '加固参与 recall 的排序（只改先后，不动字节）' },
  hooks: { type: 'boolean', default: true, description: '钩子触发器：组装提示词时查一致性、会话事件来时记审计（关掉就只剩手动调工具）' },
  assembleBudgetChars: { type: 'number', default: 24000, min: 2000, max: 200000, description: '记忆各段加起来的总预算（字）；超了在 assemble 钩子里按「提示→记账→其他→短期→长期」的顺序删，即时那段永不删' },
}
