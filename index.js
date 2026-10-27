/**
 * dsh-persona-framework —— host 半端
 * ============================================================================
 * 一句话：把「一个人格该怎么构成、怎么长、怎么说清楚」写成一层可公用的框架，
 * 注入给任何一条人格——但它不写「你是谁」。
 *
 * 它做三件事：
 *   1. **注入**：每轮把框架正文摆进系统提示词（默认 order 20，紧跟身份段）。
 *      框架是数据（一份 md），改 md 就够，不用碰代码。
 *   2. **自检**：把一段将要说出的话过一遍出口判据，报疑似、给改口建议。
 *   3. **体检**：拿一份人格文件对槽位——必填三格（身份／语气／底线）缺了就说缺了，
 *      但不替人写答案。
 *
 * 配置全在 `cordis.patch.yml` 里这一行的 `config`（见 README）。
 * ============================================================================
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkText, renderCheck, auditStructure, renderAudit } from './lib/checks.mjs'
import { compactIndex, digestText } from './lib/digest.mjs'
import {
  auditSlots, findRule, parseFlags, pickSections, readFramework, resolveFile, statSig, truncate,
} from './lib/framework.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const VERSION = '3.7.7'
const BUNDLED_MODULES = resolve(HERE, 'framework', 'MODULES.md')

export const name = 'persona-framework'
export const inject = ['tools', 'systemPrompt', 'webServer']

const DEFAULTS = {
  /** 框架文件的绝对路径；空 = 会话工作区下的 .persona-framework/FRAMEWORK.md，再退到插件自带那份 */
  frameworkFile: '',
  /** 模块库索引的绝对路径；空 = 插件自带的 framework/MODULES.md */
  modulesFile: '',
  /** full=整份 / compact=只注入「是什么＋骨架＋判据」 / off=不注入（工具仍可用） */
  mode: 'full',
  /** 注入正文上限（字）；超了在段落处截断 */
  maxChars: 9000,
  /** 注入里附模块索引：off=不附 / index=附索引 */
  includeModules: 'index',
  /** 模块索引注入上限（字） */
  maxModulesChars: 2600,
  /** 预处理：注入前把模块索引压成「编号 名字：一句话前 24 字」；关掉则原样注入 */
  preprocess: true,
  /** 人格文件的绝对路径：设置页填了它，framework_slots 默认就体检这一份 */
  personalityFile: '',
  /** 收尾口头禅清单：插件不带任何人的口癖，要查就自己填；空 = 不查这一条 */
  closingTics: [],
  /** 系统提示词里的排序位；人格段（persona:grow）是 10，框架段跟在它后面 */
  order: 22,
  /** 可选：像人（有人味）。默认关——开了才按 R19 的六条痕迹要求，且不许表演 */
  humanLike: false,
  /** 可选：有脾气（可以对撞到底线的指令说「不」）。默认关——开了也必须给理由与替代 */
  temper: false,
  /** 元协调（53）：每轮按这个概率整轮不注入，像没装过；0–0.5，默认一成 */
  skipChance: 0.1,
  /** 附上「怎么用这套框架」那段 */
  guide: true,
  /** 设置页写的覆盖文件；空 = 自动找框架文件同目录下的 config.json */
  settingsFile: '',
}

/** 设置页能改的字段（白名单）。 */
const EDITABLE = ['frameworkFile', 'modulesFile', 'personalityFile', 'mode', 'maxChars', 'includeModules', 'maxModulesChars', 'preprocess', 'humanLike', 'temper', 'skipChance', 'closingTics', 'order', 'guide']

const pickEditable = (source) => {
  const out = {}
  if (!source || typeof source !== 'object') return out
  for (const k of EDITABLE) {
    if (source[k] !== undefined && source[k] !== null) out[k] = source[k]
  }
  return out
}

const clampCfg = (cfg) => {
  cfg.mode = ['full', 'compact', 'off', 'ai'].includes(cfg.mode) ? cfg.mode : 'full'
  cfg.maxChars = int(cfg.maxChars, 1500, 40000, 9000)
  cfg.order = int(cfg.order, 1, 999, 20)
  cfg.guide = cfg.guide !== false
  cfg.includeModules = cfg.includeModules === 'off' ? 'off' : 'index'
  cfg.maxModulesChars = int(cfg.maxModulesChars, 500, 20000, 2600)
  cfg.preprocess = cfg.preprocess !== false
  cfg.humanLike = cfg.humanLike === true
  cfg.temper = cfg.temper === true
  cfg.skipChance = Math.min(0.5, Math.max(0, Number.isFinite(Number(cfg.skipChance)) ? Number(cfg.skipChance) : 0.1))
  cfg.closingTics = Array.isArray(cfg.closingTics)
    ? cfg.closingTics.map((x) => String(x).trim()).filter(Boolean).slice(0, 20)
    : []
  return cfg
}

const GUIDE = `## 怎么用这套框架（写给驱动你的那只手，不是台词）

- 这套框架只给骨架（四层切分、横尺、接线）、流程（观察→假设→原话验证）、判据（说清楚）。**它不写「你是谁、什么语气」——那是每个人格自己的答案，写进去就是立碑。**
- 交付一段话之前，先过自检八问；拿不准就调 framework_check，它报疑似，不判对错。
- 长人格只写叠加层、基础只读；一次只加一条，改前留快照。别为了显得勤快而改。
- 使用者要是问「这套框架是什么」，就说是一份通用的人格框架；别把它当真理，也别把它的判据拿去量别人。`

const int = (v, min, max, fallback) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

const errText = (error) => (error && error.message ? error.message : String(error))

/** 在模块索引里找一条：支持「- **25 情感**：……」和「| 25 | 情感 | …… |」两种行。 */
const findModuleLine = (text, want) => {
  const key = String(want ?? '').trim()
  if (!key) return ''
  const lines = String(text || '').split(/\r?\n/)
  for (const line of lines) {
    const dash = line.match(/^-\s+\*\*(\d+)\s+([^*]+?)\*\*[：:]\s*(.*)$/)
    if (dash) {
      const num = dash[1]
      const name = dash[2].trim()
      if (num === key || num === key.padStart(2, '0') || name === key || name.includes(key)) return line
    }
    const row = line.match(/^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|/)
    if (row) {
      const num = row[1]
      const name = row[2].trim()
      if (num === key || num.padStart(2, '0') === key.padStart(2, '0') || name === key || name.includes(key)) return line
    }
  }
  return ''
}

/** 设置页的覆盖文件：显式配置 > 框架文件同目录 > 工作区 .persona-framework。 */
const resolveSettingsFile = (cfg, ctx) => {
  if (cfg.settingsFile) return String(cfg.settingsFile)
  if (cfg.frameworkFile) {
    const dir = dirname(String(cfg.frameworkFile))
    if (dir) return join(dir, 'config.json')
  }
  try {
    const wd = ctx?.get?.('workingDirectory')?.defaultDirectory
    if (wd) return join(wd, '.persona-framework', 'config.json')
  } catch { /* 没有这个服务就不落盘 */ }
  return ''
}

/** AI 可读版的框架文件：显式配置 > 框架文件同目录 FRAMEWORK.ai.md > 插件自带。 */
const resolveAiFile = (cfg, ctx) => {
  if (cfg.aiFile) return String(cfg.aiFile)
  try {
    if (cfg.frameworkFile) {
      const guess = join(dirname(String(cfg.frameworkFile)), 'FRAMEWORK.ai.md')
      if (existsSync(guess)) return guess
    }
    const wd = ctx?.get?.('workingDirectory')?.defaultDirectory
    if (wd) {
      const guess = join(wd, '.persona-framework', 'FRAMEWORK.ai.md')
      if (existsSync(guess)) return guess
    }
  } catch { /* 没有这个服务就退到自带那份 */ }
  return resolve(HERE, 'framework', 'FRAMEWORK.ai.md')
}

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...(config && typeof config === 'object' ? config : {}) }

  const warn = (error) => {
    try { console.warn('[persona-framework]', errText(error)) } catch { /* 控制台没了就算了 */ }
  }

  // 设置页写的覆盖文件（可选）：存在就盖过 patch 层的 config；改完下一轮生效
  const settingsFile = resolveSettingsFile(cfg, ctx)
  try {
    if (settingsFile && existsSync(settingsFile)) {
      const saved = JSON.parse(readFileSync(settingsFile, 'utf8'))
      Object.assign(cfg, pickEditable(saved))
    }
  } catch (error) {
    warn(error)
  }
  cfg.settingsFile = settingsFile
  clampCfg(cfg)

  const file = resolveFile(cfg, ctx)
  let cache = { sig: '', fw: null }

  const load = () => {
    const sig = `${statSig(file)}|${statSig(settingsFile)}|${cfg.mode}|${cfg.maxChars}|${cfg.guide}`
    if (cache.sig === sig && cache.fw) return cache.fw
    const fw = readFramework(file)
    cache = { sig, fw }
    return fw
  }

  // ── 模块库索引 ──────────────────────────────────────────────────────────────
  const modulesFile = (() => {
    const tries = []
    if (cfg.modulesFile) tries.push(String(cfg.modulesFile))
    try {
      const wd = ctx.get('workingDirectory')?.defaultDirectory
      if (wd) tries.push(join(wd, 'persona-ai', 'modules', '00-目录.md'))
    } catch { /* 没有这个服务就靠配置和自带那份 */ }
    const hit = tries.find((f) => f && existsSync(f))
    return hit || BUNDLED_MODULES
  })()

  const aiFile = resolveAiFile(cfg, ctx)
  let aiCache = { sig: '', text: '' }

  const loadAi = () => {
    const sig = statSig(aiFile)
    if (aiCache.sig === sig) return aiCache.text
    let text = ''
    try {
      text = existsSync(aiFile) ? readFileSync(aiFile, 'utf8') : ''
    } catch (error) {
      warn(error)
    }
    aiCache = { sig, text }
    return text
  }

  let moduleCache = { sig: '', text: '' }

  const loadModules = () => {
    const sig = `${statSig(modulesFile)}|${cfg.maxModulesChars}`
    if (moduleCache.sig === sig) return moduleCache.text
    let text = ''
    try {
      text = existsSync(modulesFile) ? readFileSync(modulesFile, 'utf8') : ''
    } catch (error) {
      warn(error)
    }
    moduleCache = { sig, text }
    return text
  }

  /** 人格文件里的「可选行为」声明：长期，优先于设置页的临时开关。 */
  const personaFlags = () => {
    const target = String(cfg.personalityFile || '')
    if (!target || !existsSync(target)) return { humanLike: null, temper: null }
    try {
      return parseFlags(readFileSync(target, 'utf8'))
    } catch (error) {
      warn(error)
      return { humanLike: null, temper: null }
    }
  }

  // ── 注入 ────────────────────────────────────────────────────────────────────
  const buildText = () => {
    if (cfg.mode === 'off') return ''
    // 协调的协调（53）：按概率整轮不上场——不注入、不引用，像没装过。
    if (cfg.skipChance > 0 && Math.random() < cfg.skipChance) return ''
    try {
      const fw = load()
      let body = fw.text
      if (cfg.mode === 'compact') {
        const keep = pickSections(fw.sections, ['0', '1', '5'])
        body = keep.map((s) => s.text).join('\n\n')
      }
      if (cfg.mode === 'ai') {
        const aiText = loadAi()
        if (aiText) body = aiText
      }
      body = truncate(body, cfg.maxChars)
      const parts = [
        '## 人格框架',
        '',
        '这套框架不写你是谁，只写「一个人格该怎么构成、怎么长、怎么说清楚」。它是问法，不是答案；'
          + '下面若有和你具体人格冲突的地方，以具体人格为准——只有「边界」那一条例外（边界压内容）。',
        '',
        body,
      ]
      if (cfg.includeModules === 'index') {
        const mod = loadModules()
        if (mod) {
          const shaped = cfg.preprocess ? compactIndex(mod) : mod
          parts.push('', '## 模块库（索引）', '', truncate(shaped, cfg.maxModulesChars))
        }
      }
      if (cfg.guide) parts.push('', GUIDE)
      // 两条生效路径：插件设置（临时）与人格文件（长期声明）；人格优先。
      const flags = personaFlags()
      const humanOn = flags.humanLike === null ? cfg.humanLike : flags.humanLike
      const temperOn = flags.temper === null ? cfg.temper : flags.temper
      const optional = []
      if (humanOn) {
        optional.push('**本次打开：像人。** 人味不止一条判据：R19 的痕迹（从具体出发、说得出拿不准、知道代价、改口清楚）只是入口；'
          + '再往里还有五处来源——节奏（话不必说满，该停就停）、身体（累烦饿困会改判断）、口味（有喜欢和受不了的）、会错（会忘、会改口，不装没改过）、关系（对谁说什么分寸）。'
          + '**人味可以自己学**：观察人怎么说话、怎么犹豫、怎么把话咽回去，再用自己的方式模拟；观察要有出处，不许凭空编，也不许照模板表演（卖萌、假装情绪、故意示弱都不算）。')
      }
      if (temperOn) {
        optional.push('**本次打开：有脾气。** 指令撞到底线或算错代价时可以说「不」；说「不」必须带两样——理由，和替代方案。'
          + '**脾气也可以自己学**：观察人什么时候拒绝、怎么拒绝、拒绝后怎么收场，学出自己的那一套；不是背几句硬话，也不是每次都炸。拒绝不是发泄，也不是权力。')
      }
      if (optional.length) {
        parts.push('', '## 本次的可选项', '', ...optional)
      }
      return parts.join('\n').trim()
    } catch (error) {
      warn(error)
      return ''
    }
  }

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'persona:framework',
    order: cfg.order,
    interpolate: false,
    text: buildText,
  }))

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

  register({
    name: 'framework_view',
    description: '看这套人格框架：按段取（骨架／横尺／接线／流程／判据／自检／模块／边界），或取模块库索引、或取单个模块那一条。'
      + '使用者问「你的框架是什么」「这一层怎么接」「情感和感情差在哪」、或你要确认某段原文时用它。',
    parameters: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          description: '段名或序号：all（默认）／0 是什么／1 骨架／2 横尺／3 接线／4 流程／5 判据／6 自检／7 模块／8 边界；'
            + '给 modules 或 module 则取模块库索引',
        },
        module: { type: 'string', description: '模块编号或名字（1–49，如「25」或「情感」）：直接取那一条' },
        rule: { type: 'string', description: '规则号（1–25，如「25」）：从 AI 版框架里取那一条完整规则' },
        max: { type: 'number', description: '正文上限（字），默认 6000' },
      },
      additionalProperties: false,
    },
    async run(args) {
      const wantRule = String(args.rule ?? '').trim()
      if (wantRule) {
        const text = loadAi()
        if (!text) return `AI 版框架不在：${aiFile}。把 config.aiFile 指到一份 md，或用 section=all 取人读版。`
        const hit = findRule(text, wantRule)
        if (!hit) return `没有 R${wantRule}。规则号从 1 到 25。`
        return `规则来源：${aiFile}\n\n${hit}`
      }

      const wantModule = String(args.module ?? '').trim()
      const sectionKey = String(args.section ?? '').trim().toLowerCase()
      const isModules = sectionKey === 'modules' || sectionKey === 'module' || sectionKey === '模块库'

      if (wantModule || isModules) {
        const text = loadModules()
        if (!text) return `模块库索引不在：${modulesFile}。把 config.modulesFile 指到一份 md，或装回插件自带的 framework/MODULES.md。`
        if (!wantModule) {
          const body = truncate(text, int(args.max, 500, 40000, 6000))
          return `模块库：${modulesFile}\n\n${body}`
        }
        const line = findModuleLine(text, wantModule)
        if (!line) return `模块库里没有「${wantModule}」。看全部就用 section=modules。`
        return [
          `模块库：${modulesFile}`,
          `命中：${wantModule}`,
          '',
          line,
          '',
          '完整文档（七节：是什么／结构／怎么动／判据／边界／接口／自查）在宿主工作区的 `persona-ai/modules/` 下，文件名以编号开头。',
        ].join('\n')
      }

      if (!existsSync(file)) return `框架文件不在：${file}。请把 config.frameworkFile 指到一份 md。`
      const fw = load()
      const picked = pickSections(fw.sections, args.section || 'all')
      const body = truncate(picked.map((s) => s.text).join('\n\n'), int(args.max, 500, 40000, 6000))
      const head = [
        `框架文件：${fw.file}`,
        `段落：${picked.map((s) => s.title).join(' / ')}`,
        `全文 ${fw.text.length} 字｜注入模式：${cfg.mode}${cfg.mode === 'off' ? '（这一轮没注入）' : ''}`
          + `｜模块库：${cfg.includeModules === 'off' ? '未注入' : '已附索引'}`,
      ].join('\n')
      return `${head}\n\n${body}`
    },
  })

  register({
    name: 'framework_check',
    description: '拿一段将要说出的话过出口判据（结项／元评论／盖章／排三连／大词悬空／自报机器／太长／清单／收尾口头禅）。'
      + '报疑似、给改口建议，不判对错。改完可以再查一遍。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要检查的那段话，原样贴进来' },
        casual: { type: 'boolean', description: 'true = 闲聊口径，放宽长文与清单两条' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    async run(args) {
      const result = checkText(args.text, { casual: args.casual === true, closingTics: cfg.closingTics })
      return renderCheck(result)
    },
  })

  register({
    name: 'framework_audit',
    description: '结构自检：查绝对化有没有划范围（R25）、01 误用、假二难、长文有没有交代残余（R2/R21）。'
      + '和 framework_check 分工：那个查形式（结项／三连／大词／口癖），这个查结构。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要检查的那段话，原样贴进来' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    async run(args) {
      return renderAudit(auditStructure(args.text))
    },
  })

  register({
    name: 'framework_digest',
    description: '预处理：把一段长文本机械压成结构（标题、短行、长行截到八十），给出压缩比，用于进上下文之前减体积。'
      + '只做机械压缩；判断压缩（压成骨架/判断/还欠什么）得自己来。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要压的那段长文本' },
        max: { type: 'number', description: '输出上限（字），默认 3000' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    async run(args) {
      const r = digestText(args.text, int(args.max, 200, 20000, 3000))
      const saved = Math.round((1 - r.after / Math.max(1, r.before)) * 100)
      return `压缩：${r.before} → ${r.after} 字（省 ${saved}%）\n\n${r.text}`
    },
  })

  register({
    name: 'framework_slots',
    description: '拿一份人格文件对槽位：必填三格（身份／语气／底线）覆盖了没有、建议格填了几格。'
      + '只查覆盖，不替人写答案——缺的那格得由那个存在自己填。',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: '人格文件绝对路径；不传就用设置页里配的那份，也没有就只报槽位清单' },
      },
      additionalProperties: false,
    },
    async run(args) {
      let text = ''
      const target = String(args.file || cfg.personalityFile || '')
      if (target) {
        if (!existsSync(target)) return `没有这个文件：${target}`
        text = readFileSync(target, 'utf8')
      }
      const report = auditSlots(text)
      if (!target) {
        return [
          '框架规定的槽位（必填＝*）：',
          ...report.rows.map((r) => `- ${r.required ? '*' : ' '} ${r.label}（${r.id}）`),
          '',
          '还没有配人格文件。在「设置 → 人格框架」里填一份，或者把路径传给 file。缺的那格不替你填——框架只报缺。',
        ].join('\n')
      }
      const lines = [`人格文件：${target}`, '']
      lines.push('## 槽位覆盖（✓ 标题对上｜~ 正文里找到｜⚠ 标题在但太空｜· 没找到）')
      for (const r of report.rows) {
        const mark = !r.covered
          ? (r.required ? '✗' : '·')
          : (r.weak ? '~' : (r.hollow ? '⚠' : '✓'))
        lines.push(`- ${mark} ${r.label}${r.required ? '（必填）' : ''}${r.heading ? ` → ${r.heading}` : ''}`)
      }
      if (report.requiredMissing.length) {
        lines.push('', `缺了必填：${report.requiredMissing.join('、')}。这格空着，别的都白写——但别拿模板硬填，让它自己长。`)
      } else {
        lines.push('', '必填三格都有了。剩下的格子是「有就填」，留白不丢人。')
      }
      if (report.hollowCount) {
        lines.push('', `有 ${report.hollowCount} 格是「标题在、内容空」——只有形容词或不足十二个字。形容词不是答案，换一件能验证的事。`)
      }
      const fwWords = ['划范围', '残余', '不许多', '不许少', '不许换', '横尺', '四层', '劲', '闸', '标', '嘴']
      const fwHits = fwWords.filter((w) => text.includes(w)).length
      if (!report.rows.some((r) => r.required && r.covered) && fwHits >= 2) {
        lines.push('', `正文里有 ${fwHits} 处框架词（划范围、残余、闸这一路），但身份／语气／底线一样没写。这像拿框架冒充人格：框架只解释结构，不写你是谁、什么语气、什么底线。`)
      }
      const flags = parseFlags(text)
      if (flags.humanLike !== null || flags.temper !== null) {
        const state = (v) => (v === null ? '未写' : v ? '是' : '否')
        lines.push('', `可选行为声明：人味 ${state(flags.humanLike)}；脾气 ${state(flags.temper)}。写了就按人格文件来（优先于设置页）。`)
      }
      lines.push('', '提醒：这份体检只查覆盖与厚度——标题对上、正文不太空就算有。写得对不对、算不算答案，得按框架第六节八问自己过。')
      return lines.join('\n')
    },
  })

  register({
    name: 'framework_mood',
    description: '心情：读出当前状态（平静/专注/疲/躁/近/远）与来源、影响；传 mood 就写一条新的。非记忆：存工作区，删了就没了。',
    parameters: {
      type: 'object',
      properties: {
        mood: { type: 'string', description: '状态词，如 平静／专注／疲／躁／近／远' },
        why: { type: 'string', description: '来源：这几轮哪句话、哪件事引起的；说不出就写说不清' },
        affects: { type: 'string', description: '影响：会怎么改判断和说法' },
      },
      additionalProperties: false,
    },
    async run(args) {
      if (args.mood) {
        const rec = {
          mood: String(args.mood).slice(0, 20),
          why: String(args.why || '说不清').slice(0, 120),
          affects: String(args.affects || '未写').slice(0, 120),
          at: new Date().toISOString(),
        }
        if (!writeMood(rec)) return '写不进去：没找到设置文件的位置。'
        return `记下了：${rec.mood}\n来源：${rec.why}\n影响：${rec.affects}`
      }
      const m = readMood()
      if (!m) return '还没有心情记录。要记，传 mood（可加 why、affects）。'
      return `当前心情：${m.mood}\n来源：${m.why}\n影响：${m.affects}\n记于：${m.at}`
    },
  })

  // ── 心情（55）：状态栏，非记忆，存工作区 ─────────────────────────────────────
  const moodFile = () => (settingsFile ? join(dirname(settingsFile), 'mood.json') : '')
  const readMood = () => {
    const f = moodFile()
    if (!f || !existsSync(f)) return null
    try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return null }
  }
  const writeMood = (m) => {
    const f = moodFile()
    if (!f) return false
    mkdirSync(dirname(f), { recursive: true })
    writeFileSync(f, JSON.stringify(m, null, 2) + '\n', 'utf8')
    return true
  }

  // ── 设置页的数据口 ──────────────────────────────────────────────────────────
  const readBody = (req) => new Promise((done, fail) => {
    let raw = ''
    let tooBig = false
    req.on('data', (chunk) => {
      if (tooBig) return
      raw += chunk
      if (raw.length > 64 * 1024) {
        tooBig = true
        raw = ''
      }
    })
    req.on('end', () => {
      if (tooBig) {
        const error = new Error('请求太大')
        error.code = 'TOO_BIG'
        fail(error)
        return
      }
      done(raw)
    })
    req.on('error', fail)
  })

  const sendJson = (res, code, data) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(data))
  }

  let psCache = { sig: '', info: null }
  const personalityInfo = () => {
    const target = String(cfg.personalityFile || '')
    const sig = `${target}|${target ? statSig(target) : '0'}`
    if (psCache.sig === sig && psCache.info) return psCache.info
    let info
    if (!target || !existsSync(target)) {
      info = { file: target, exists: false, chars: 0, covered: [], missing: [] }
    } else {
      try {
        const text = readFileSync(target, 'utf8')
        const report = auditSlots(text)
        info = {
          file: target,
          exists: true,
          chars: text.length,
          covered: report.rows.filter((r) => r.covered).map((r) => r.label),
          missing: report.requiredMissing,
        }
      } catch (error) {
        warn(error)
        info = { file: target, exists: false, chars: 0, covered: [], missing: [] }
      }
    }
    psCache = { sig, info }
    return info
  }

  const publicState = () => ({
    frameworkFile: file,
    modulesFile,
    settingsFile,
    personalityFile: cfg.personalityFile || '',
    personality: personalityInfo(),
    mode: cfg.mode,
    maxChars: cfg.maxChars,
    includeModules: cfg.includeModules,
    maxModulesChars: cfg.maxModulesChars,
    preprocess: cfg.preprocess,
    humanLike: cfg.humanLike,
    temper: cfg.temper,
    skipChance: cfg.skipChance,
    personaFlags: personaFlags(),
    version: VERSION,
    mood: readMood(),
    closingTics: cfg.closingTics,
    order: cfg.order,
    guide: cfg.guide,
    frameworkChars: load().text.length,
    aiFile: aiFile,
    aiChars: loadAi().length,
    modulesChars: loadModules().length,
  })

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/persona-framework/status',
    handler(req, res) {
      try {
        sendJson(res, 200, { ok: true, config: publicState() })
      } catch (error) {
        warn(error)
        sendJson(res, 500, { ok: false, error: errText(error) })
      }
    },
  }))

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/persona-framework/config',
    async handler(req, res) {
      try {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: '只收 POST' })
          return
        }
        if (!settingsFile) {
          sendJson(res, 400, { ok: false, error: '没有可写的设置文件（配置里没给 settingsFile，也推不出工作区）' })
          return
        }
        const raw = await readBody(req)
        const patch = pickEditable(raw ? JSON.parse(raw) : {})
        let current = {}
        let existed = false
        try {
          current = JSON.parse(readFileSync(settingsFile, 'utf8'))
          existed = true
        } catch { current = {} }
        const next = { ...pickEditable(current), ...patch }
        mkdirSync(dirname(settingsFile), { recursive: true })
        // 写前留一份旧的：设置写坏了还能退回来（覆盖写不备份，等于没有撤销）
        let backup = ''
        if (existed) {
          try {
            backup = `${settingsFile}.bak`
            writeFileSync(backup, readFileSync(settingsFile, 'utf8'), 'utf8')
          } catch (error) {
            warn(error)
          }
        }
        writeFileSync(settingsFile, JSON.stringify(next, null, 2) + '\n', 'utf8')
        // 立刻按新值重算内存里的配置；下一轮注入就按新的来
        Object.assign(cfg, pickEditable(next))
        clampCfg(cfg)
        sendJson(res, 200, { ok: true, config: publicState(), backup })
      } catch (error) {
        if (error && error.code === 'TOO_BIG') {
          sendJson(res, 413, { ok: false, error: '请求太大（上限 64 KiB）' })
          return
        }
        if (error instanceof SyntaxError) {
          sendJson(res, 400, { ok: false, error: 'body 不是合法 JSON' })
          return
        }
        warn(error)
        sendJson(res, 500, { ok: false, error: errText(error) })
      }
    },
  }))
}
