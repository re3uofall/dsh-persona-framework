/**
 * dsh-persona-grow —— host 半端
 * ============================================================================
 * 一句话：让一份人格文件在 DSH 里活着，并且自己长。
 *
 * 它做三件事：
 *   1. **注入**：每轮把 `characters/` 下那份人格文件摆进系统提示词；
 *      人格补丁里「已采纳」的那几条接在后面 —— 所以长出来的东西下一句话就生效。
 *   2. **观察**：使用者一说「以后你……」「别……」「记住……」，就把原话记进证据账。
 *      同一句被要求 `promoteAfter` 次（默认 2）就自己长进「已采纳」。
 *   3. **改写**：只写 `growth/人格补丁.md`，绝不碰 v3.1 原稿；每次改「已采纳」都留快照，
 *      `persona_revert` 一句话退回旧版。
 *
 * 配置全部走 `cordis.patch.yml` 里这一行的 `config`（见 README）。
 * ============================================================================
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  appendEvidence, clip, listVersions, mutatePatch, normalize, nowIso, pathsFor,
  readBase, readEvidence, readPatch, readState, revertTo, syncPatch, withLock, writeState,
} from './lib/store.mjs'
import { extractCandidates, extractText } from './lib/learn.mjs'
import {
  analyze, archiveBlock, parseSections, pickSection, pointerFor, rebuildDigest, removeSection,
  renderReport, replaceOnce,
} from './lib/tidy.mjs'

export const name = 'persona-grow'
export const inject = ['tools', 'systemPrompt']

/** 默认值。任何一条都能在 patch 的 `config` 里改。 */
const DEFAULTS = {
  /** 人格根目录（`persona-ai` 那一层）。空 = 从会话工作区推。 */
  personaDir: '',
  /** 人格文件（相对 personaDir）。空 = 自动探 characters/ 下第一个 .md */
  baseFile: '',
  patchFile: 'growth/人格补丁.md',
  /** full=整份人格 / compact=只留开头一小段 / off=不注入（工具仍然可用） */
  mode: 'full',
  /** 注入的人格正文上限（字） */
  maxChars: 12000,
  /** 后台从使用者原话里自己学 */
  autoLearn: true,
  /** 同一句被要求到 promoteAfter 次就自动采纳 */
  autoAdopt: true,
  promoteAfter: 2,
  /** 「已采纳」上限，满了就不再自动收 */
  maxTraits: 40,
  /** 附上「怎么学」那段说明 */
  guide: true,
}

const GUIDE = `## 人格学习（这是写给驱动你的那只手的，不是台词）

- 使用者对你怎么相处提了长期要求（「以后你……」「别……」「记住……」），或明确纠正了你的说法：调 persona_learn，把原话放进 quote，把规矩提炼成一句放进 trait；有把握时带 adopt: true。
- 只记会影响以后相处的。一次情绪、一句抱怨、一个临时任务，不记。
- 使用者说「不像你了」「刚才那条别记」：用 persona_view 看全貌，persona_forget 删掉那条；要整段退回旧版，用 persona_revert。
- 别在回复里播报「我学会了」；长在身上就够了。`

const int = (v, min, max, fallback) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

const errText = (error) => (error && error.message ? error.message : String(error))

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...(config && typeof config === 'object' ? config : {}) }
  cfg.mode = ['full', 'compact', 'off'].includes(cfg.mode) ? cfg.mode : 'full'
  cfg.maxChars = int(cfg.maxChars, 2000, 40000, 12000)
  cfg.promoteAfter = int(cfg.promoteAfter, 1, 20, 2)
  cfg.maxTraits = int(cfg.maxTraits, 1, 200, 40)
  cfg.autoLearn = cfg.autoLearn !== false
  cfg.autoAdopt = cfg.autoAdopt !== false
  cfg.guide = cfg.guide !== false

  const warn = (error) => {
    try { console.warn('[persona-grow]', errText(error)) } catch { /* 控制台都没了就算了 */ }
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
  const p = dir ? pathsFor(dir, cfg) : null
  if (!p) warn('没有找到人格目录：请在 patch 的 config.personaDir 里指到 persona-ai 那一层')

  // ── 注入 ────────────────────────────────────────────────────────────────────
  let cache = { sig: '', text: '' }

  const signature = () => {
    if (!p) return ''
    const stamp = (file) => {
      try {
        const s = statSync(file)
        return `${s.mtimeMs}:${s.size}`
      } catch { return '0' }
    }
    return [stamp(p.base), stamp(p.patch), cfg.mode, cfg.maxChars, cfg.guide].join('|')
  }

  const truncate = (text, max) => {
    if (text.length <= max) return text
    const cut = text.slice(0, max)
    const at = cut.lastIndexOf('\n\n')
    return (at > max * 0.6 ? cut.slice(0, at) : cut) + '\n\n（……余下略，完整见人格文件。）'
  }

  // ── 注入配额（电源模式写，这里只读）────────────────────────────────────
  // 工作区不能靠 process.cwd()（那是 profile 目录），也不能从插件位置往上推；
  // 只认会话头里的 cwd，拿不到就退回旧行为——全量摆。
  let sessionWs = ''
  const quotaPath = () => {
    const root = sessionWs || String(cfg.workspace || '').trim()
    return root ? join(root, '.persona-framework', '注入配额.json') : ''
  }
  const personalityCap = () => {
    try {
      const file = quotaPath()
      if (!file || !existsSync(file)) return 0
      const j = JSON.parse(readFileSync(file, 'utf8'))
      const v = j?.caps?.personality
      return typeof v === 'number' && Number.isFinite(v) ? v : 0
    } catch { return 0 }
  }

  try {
    ctx.effect(() => ctx.on('agent/pre-step', (payload, next) => {
      try {
        const cwd = payload?.agent?.session?.header?.cwd
        if (typeof cwd === 'string' && cwd) sessionWs = cwd
      } catch { /* 拿不到就用旧的 */ }
      return next()
    }))
  } catch { /* 没有这个钩子也能用，只是配额读不到 */ }

  const buildPersonaText = () => {
    if (!p || cfg.mode === 'off') return ''
    const sig = signature()
    if (sig === cache.sig) return cache.text
    try {
      const base = readBase(p)
      const patch = readPatch(p)
      const parts = []
      if (base.text) {
        parts.push('以下是你的人格。它和上面的通用身份描述冲突时，以这一段为准。')
        parts.push(truncate(base.text, cfg.mode === 'compact' ? Math.min(cfg.maxChars, 2200) : cfg.maxChars))
      }
      if (patch.adopted.length > 0) {
        parts.push([
          '## 你身上新长出来的',
          '',
          '这些是使用者亲口要求过的，原话为凭；已经长进你身上，不用再问，也不用复述自己「学到了」。',
          '',
          ...patch.adopted.map((a) => `- [${a.kind}] ${a.text}`),
        ].join('\n'))
      }
      if (cfg.guide) parts.push(GUIDE)
      let text = parts.join('\n\n').trim()
      const cap = personalityCap()
      if (cap < 0) text = ''
      else if (cap > 0) text = truncate(text, cap)
      cache = { sig: sig + '|cap:' + cap, text }
      return text
    } catch (error) {
      warn(error)
      return cache.text
    }
  }

  if (p) {
    ctx.effect(() => ctx.systemPrompt.section({
      name: '实时环境:grow',
      order: 10,
      interpolate: false,   // 人格里写了 `{{` 也不该把整个提示词炸掉
      text: buildPersonaText,
    }))
  }

  // ── 观察：使用者自己的原话 ───────────────────────────────────────────────────
  if (p && cfg.autoLearn) {
    ctx.effect(() => ctx.on('agent/inbox/inserted', (payload) => {
      try {
        const text = extractText(payload?.message)
        if (!text || text.startsWith('[persona-grow]')) return
        const candidates = extractCandidates(text)
        if (candidates.length === 0) return
        const session = String(payload?.agent?.id ?? '')
        queueMicrotask(() => {
          withLock(async () => {
            for (const c of candidates) {
              appendEvidence(p, {
                op: 'learn', t: nowIso(), kind: c.kind, text: c.text, quote: c.quote, session,
              })
            }
            return syncPatch(p, cfg)
          }).catch(warn)
        })
      } catch (error) {
        warn(error)
      }
    }))
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
    if (p) return null
    return '还没找到人格目录。请在 `cordis.patch.yml` 里把 `persona-grow` 的 `config.personaDir` 指到 `persona-ai` 那一层，然后重启。'
  }

  const stateLine = () => {
    const base = readBase(p)
    const patch = readPatch(p)
    return `基础 v${base.version || '?'} + 补丁 v${patch.version}｜已采纳 ${patch.adopted.length} 条｜待议 ${patch.pending.length} 条`
  }

  // ── 整理人格文件：只搬不删、原地改 ──────────────────────────────────────
  const baseFile = () => (p ? p.base : '')
  const readBaseRaw = () => (p && existsSync(p.base) ? readFileSync(p.base, 'utf8') : '')
  const backupOnce = () => {
    if (!p || !existsSync(p.base)) return ''
    const bak = `${p.base}.bak-${Date.now()}`
    try { copyFileSync(p.base, bak) } catch { return '' }
    return bak
  }
  const archivePath = (to) => {
    if (to && String(to).trim()) {
      const t = String(to).trim()
      return t.includes('/') || t.includes('\\') ? t : join(dirname(p.base), t)
    }
    const day = new Date().toISOString().slice(0, 10)
    return join(dirname(p.base), '_archive', `人格_整理_${day}.md`)
  }
  const writeBaseFile = (text) => {
    mkdirSync(dirname(p.base), { recursive: true })
    writeFileSync(p.base, text, 'utf8')
  }
  const needBase = () => {
    const miss = needDir()
    if (miss) return miss
    if (!existsSync(p.base)) return `找不到人格文件：${p.base}`
    return null
  }

  register({
    name: 'grow_report',
    description: '整理人格文件之前的体检：多少字、多大几段、哪些标题像旧文、有没有重复行。'
      + '只给数，不改文件。判据：人格每轮都进前缀，这里省下的字才是真省的。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    run: () => {
      const miss = needBase()
      if (miss) return miss
      const a = analyze(readBaseRaw())
      return renderReport(a, { stateLine: stateLine() })
    },
  })

  register({
    name: 'grow_compact',
    description: '把人格文件里「旧 / 历史 / 已归档 / 过时」那几段搬进 _archive 并重建 DIGEST。'
      + '不传 apply 只看会搬什么；传 apply: true 才真动手（先留 .bak）。只搬不删。',
    parameters: {
      type: 'object',
      properties: { apply: { type: 'boolean', description: 'true 才真搬；省掉只看清单' } },
      additionalProperties: false,
    },
    run: (args) => {
      const miss = needBase()
      if (miss) return miss
      const raw = readBaseRaw()
      const a = analyze(raw)
      if (!a.archiveable.length) {
        return `没找到标题带「旧 / 历史 / 已归档 / 过时」的段，所以一步没动。\n\n${renderReport(a, { stateLine: stateLine() })}`
      }
      const list = a.archiveable.map((x) => `${x.i}. ${x.title} — ${x.chars} 字`).join('\n')
      if (args?.apply !== true) {
        return `会搬这几段（共 ${a.archiveable.reduce((n, x) => n + x.chars, 0)} 字）：\n${list}\n\n要真搬：grow_compact({apply:true})`
      }
      let text = raw
      const moved = []
      for (const item of [...a.archiveable].reverse()) {
        const r = removeSection(text, item.i)
        if (r.error) return r.error
        text = r.text
        moved.unshift({ title: r.title, body: r.moved, chars: r.moved.length })
      }
      const file = archivePath('')
      const bak = backupOnce()
      mkdirSync(dirname(file), { recursive: true })
      const head = existsSync(file) ? '' : `# 人格文件归档（只搬不删）\n\n这些段从人格文件搬出来，**不进前缀**，所以它们省不了 token——留着是为了以后能翻回去。\n`
      writeFileSync(file, head + moved.map((m) => archiveBlock(m.title, m.body)).join(''), 'utf8')
      for (const m of moved) {
        const firstH2 = text.search(/^##\s+/m)
        const ptr = pointerFor(m.title, file.replace(/\\/g, '/'))
        text = firstH2 < 0 ? `${text}\n\n${ptr}` : `${text.slice(0, firstH2)}${ptr}\n\n${text.slice(firstH2)}`
      }
      text = rebuildDigest(text)
      writeBaseFile(text)
      return `搬走 ${moved.length} 段（${moved.reduce((n, m) => n + m.chars, 0)} 字）：\n`
        + moved.map((m) => `　${m.title} — ${m.chars} 字`).join('\n')
        + `\n\n落到：${file.replace(/\\/g, '/')}${bak ? `\n改前备份：${bak.replace(/\\/g, '/')}` : ''}`
        + `\n现在人格文件 ${text.length} 字（原来 ${raw.length} 字）。DIGEST 已重建。`
    },
  })

  register({
    name: 'grow_read',
    description: '读人格文件：不给 heading 读全文；给标题片段或编号（编号看 grow_report）只读那一段。',
    parameters: {
      type: 'object',
      properties: { heading: { type: 'string', description: '标题片段或编号；省掉读全文' } },
      additionalProperties: false,
    },
    run: (args) => {
      const miss = needBase()
      if (miss) return miss
      const raw = readBaseRaw()
      const key = String(args?.heading ?? '').trim()
      if (!key) return raw
      const r = pickSection(raw, key)
      if (r.error) return r.error
      return r.section.text
    },
  })

  register({
    name: 'grow_edit',
    description: '原地改人格文件的一段：把 from 换成 to，只许唯一命中；改前留 .bak。命中 0 次或多次都不动。',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: '原文里要换掉的那一段（够长，能唯一定位）' },
        to: { type: 'string', description: '换成什么；空串等于删掉' },
      },
      required: ['from'],
      additionalProperties: false,
    },
    run: (args) => {
      const miss = needBase()
      if (miss) return miss
      const r = replaceOnce(readBaseRaw(), args?.from, args?.to ?? '')
      if (r.error) return r.error
      const bak = backupOnce()
      writeBaseFile(r.text)
      return `换好了，人格文件现在 ${r.text.length} 字。${bak ? `改前备份：${bak.replace(/\\/g, '/')}` : ''}`
    },
  })

  register({
    name: 'grow_move',
    description: '把人格文件里一段搬出去（默认搬进 characters/_archive 当日文件，或给 to 指定文件），'
      + '原地留一行指针。只搬不删。',
    parameters: {
      type: 'object',
      properties: {
        heading: { type: 'string', description: '标题片段或编号（编号看 grow_report）' },
        to: { type: 'string', description: '搬到哪个文件（相对 characters 目录）；省掉用 _archive 当日文件' },
      },
      required: ['heading'],
      additionalProperties: false,
    },
    run: (args) => {
      const miss = needBase()
      if (miss) return miss
      const raw = readBaseRaw()
      const pick = pickSection(raw, args?.heading)
      if (pick.error) return pick.error
      const r = removeSection(raw, pick.section.i)
      if (r.error) return r.error
      const file = archivePath(args?.to)
      const bak = backupOnce()
      mkdirSync(dirname(file), { recursive: true })
      const head = existsSync(file) ? '' : `# 人格文件归档（只搬不删）\n\n这些段从人格文件搬出来，**不进前缀**，所以它们省不了 token——留着是为了以后能翻回去。\n`
      writeFileSync(file, head + archiveBlock(r.title, r.moved), 'utf8')
      const ptr = pointerFor(r.title, file.replace(/\\/g, '/'))
      const firstH2 = r.text.search(/^##\s+/m)
      const text = firstH2 < 0 ? `${r.text}\n\n${ptr}` : `${r.text.slice(0, firstH2)}${ptr}\n\n${r.text.slice(firstH2)}`
      writeBaseFile(text)
      return `「${r.title}」（${r.moved.length} 字）已搬到 ${file.replace(/\\/g, '/')}。`
        + `\n人格文件现在 ${text.length} 字。${bak ? `改前备份：${bak.replace(/\\/g, '/')}` : ''}`
    },
  })

  register({
    name: 'persona_view',
    description: '看自己现在的人格：基础人格版本 + 补丁（已采纳 / 待议）+ 证据条数。'
      + '使用者问「你最近学了什么」、或你要确认某条到底长没长进来时用它。',
    parameters: {
      type: 'object',
      properties: {
        part: {
          type: 'string',
          enum: ['all', 'patch', 'stats'],
          description: 'all=全貌（默认）/ patch=只看补丁两个区 / stats=只统计',
        },
      },
      additionalProperties: false,
    },
    async run(args) {
      const missing = needDir()
      if (missing) return missing
      const part = args.part === 'patch' || args.part === 'stats' ? args.part : 'all'
      const base = readBase(p)
      const patch = readPatch(p)
      const evidence = readEvidence(p).filter((e) => e.op !== 'forget')
      const lines = [`目录：${dir}`, stateLine()]
      if (part !== 'stats') {
        lines.push('', '## 已采纳')
        lines.push(...(patch.adopted.length ? patch.adopted.map((a) => `- [${a.kind}|${a.meta}] ${a.text}`) : ['（空）']))
        lines.push('', '## 待议（还没长进去）')
        lines.push(...(patch.pending.length ? patch.pending.map((x) => `- [${x.kind}|${x.meta}] ${x.text}`) : ['（空）']))
      }
      if (part !== 'patch') {
        lines.push('', `证据账：${evidence.length} 条；快照 ${listVersions(p).length} 份；目录 ${dir}`)
      }
      return lines.join('\n')
    },
  })

  register({
    name: 'persona_learn',
    description: '把一条关于「你自己该怎么当」的东西记下来。使用者明确提长期要求、或当场纠正你时用。'
      + 'trait 放提炼成一句的规矩，quote 放使用者原话（只认原话）。同一句被要求两次会自动长进人格；'
      + '你有把握时传 adopt: true 立刻长进去。只记会影响以后相处的，别把一次情绪也记。',
    parameters: {
      type: 'object',
      properties: {
        trait: { type: 'string', description: '一句话的规矩/特征，最多 120 字' },
        kind: { type: 'string', enum: ['纠正', '偏好', '称呼', '学到'], description: '这条属于哪一类' },
        quote: { type: 'string', description: '使用者的原话（照抄，别改写）' },
        adopt: { type: 'boolean', description: 'true = 立刻采纳，不等第二次' },
      },
      required: ['trait'],
      additionalProperties: false,
    },
    async run(args, exec) {
      const missing = needDir()
      if (missing) return missing
      const trait = clip(args.trait, 120)
      if (normalize(trait).length < 2) return '这句太短了，没记。'
      const kind = ['纠正', '偏好', '称呼', '学到'].includes(args.kind) ? args.kind : '学到'
      const quote = clip(args.quote || '', 200)
      const force = args.adopt === true
      if (readPatch(p).adopted.some((a) => normalize(a.text) === normalize(trait))) {
        return `这条已经长在身上了：${trait}`
      }
      const state = await withLock(async () => {
        appendEvidence(p, {
          op: 'learn', t: nowIso(), kind, text: trait, quote, session: String(exec?.agent?.id ?? ''), force,
        })
        return syncPatch(p, cfg)
      })
      const adopted = state.adopted.some((a) => normalize(a.text) === normalize(trait))
      if (adopted) return `长进去了（补丁 v${state.version}）：${trait}`
      const witness = state.pending.find((x) => normalize(x.text) === normalize(trait))
      return `记下了，还没长进去${witness ? `（${witness.meta}）` : ''}：${trait}`
        + '\n它要再被要求一次才会自己长进来，或者下次直接带 adopt: true。'
    },
  })

  register({
    name: 'persona_forget',
    description: '删掉一条人格条目 —— 已采纳的、或还杵在「待议」里的都行（连同它的证据一起作废，不会被旧账顶回来）。'
      + '使用者说「不像你了」「这条不对」「刚才那条别记」时用。',
    parameters: {
      type: 'object',
      properties: {
        match: { type: 'string', description: '要删的那条里的几个字，或整句' },
      },
      required: ['match'],
      additionalProperties: false,
    },
    async run(args, exec) {
      const missing = needDir()
      if (missing) return missing
      const key = normalize(args.match)
      if (!key) return '给个能认出来的词，我才知道删哪条。'
      const adoptedHits = []
      const pendingHits = []
      await withLock(async () => {
        const patch = readPatch(p)
        adoptedHits.push(...patch.adopted.filter((a) => normalize(a.text).includes(key)))
        // 待议里的也算：它还没上身，但一直杵在那儿就是噪声
        pendingHits.push(...patch.pending.filter((x) => normalize(x.text).includes(key)))
        if (adoptedHits.length === 0 && pendingHits.length === 0) return
        // 先记作废，再改补丁：重算时旧账不会再把它顶回来
        const keys = new Set([...adoptedHits, ...pendingHits].map((x) => normalize(x.text)))
        for (const k of keys) {
          appendEvidence(p, { op: 'forget', t: nowIso(), key: k, session: String(exec?.agent?.id ?? '') })
        }
        if (adoptedHits.length > 0) {
          mutatePatch(p, cfg, (model) => ({
            ...model,
            adopted: model.adopted.filter((a) => !keys.has(normalize(a.text))),
          }))
        }
        syncPatch(p, cfg)
      })
      if (adoptedHits.length === 0 && pendingHits.length === 0) {
        return `没有哪条对得上「${args.match}」。可以用 persona_view 看看现在都有什么。`
      }
      const lines = []
      if (adoptedHits.length) lines.push(`删掉了 ${adoptedHits.length} 条：\n${adoptedHits.map((a) => `- ${a.text}`).join('\n')}`)
      if (pendingHits.length) lines.push(`清掉了 ${pendingHits.length} 条待议：\n${pendingHits.map((x) => `- （${x.meta}）${x.text}`).join('\n')}`)
      return lines.join('\n\n')
    },
  })

  register({
    name: 'persona_revert',
    description: '把人格补丁退回某个旧版本（每次改「已采纳」都自动留了快照）。不传 version 就列出有哪些版本。',
    parameters: {
      type: 'object',
      properties: {
        version: { type: 'number', description: '要退回的补丁版本号，比如 3' },
      },
      additionalProperties: false,
    },
    async run(args) {
      const missing = needDir()
      if (missing) return missing
      if (args.version === undefined || args.version === null) {
        const versions = listVersions(p)
        const now = readPatch(p).version
        return versions.length
          ? `现有快照：${versions.map((v) => `v${v}`).join('、')}；当前补丁 v${now}。要退哪一版，传 version。`
          : `还没有任何快照；当前补丁 v${now}。`
      }
      const version = int(args.version, 1, 100000, 0)
      if (!version) return '版本号得是个正整数。'
      const ok = revertTo(p, version)
      if (!ok) return `没有 v${version} 的快照。`
      // 退回之后，旧证据不许再把刚退掉的东西顶回来
      writeState(p, { ...readState(p), revertedAt: nowIso() })
      return `退回到补丁 v${version}。之前那些证据也一并作废，不会再自己长回来。`
    },
  })

  // ── 开机：补丁文件不在就建一份空的 ─────────────────────────────────────────
  if (p) {
    queueMicrotask(() => {
      if (readPatch(p).exists) return
      withLock(async () => syncPatch(p, cfg)).catch(warn)
    })
  }
}
