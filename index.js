/**
 * dsh-persona-framework —— host 半端
 * ============================================================================
 * 一句话：把「一个人格该怎么构成、怎么长、怎么说清楚」写成一层可公用的框架，
 * 注入给任何一条人格——但它不写「你是谁」。
 *
 * 它做这些事：
 *   1. **注入**：每轮把框架正文摆进系统提示词（默认 order 22，跟在人格、成果、日记之后）。
 *      框架是数据（一份 md），改 md 就够，不用碰代码。
 *   2. **出口自检 / 结构自检**：话出口前查一遍，动手之前查结构；报疑似，不判对错。
 *   3. **体检**：拿一份人格文件对槽位——必填三部分缺了就说缺了，但不替人写答案。
 *   4. **预处理 / 心情 / 元协调**：长文先压、状态可记、整轮可不上场。
 *   5. **模块库**：62 个模块索引随框架注入，可按编号取一段。
 *
 * 配置全在 `cordis.patch.yml` 里这一行的 `config`（见 README）。
 * ============================================================================
 */
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkText, renderCheck, auditStructure, renderAudit } from './lib/checks.mjs'
import { compactIndex, digestText } from './lib/digest.mjs'
import {
  auditSlots, findRule, parseFlags, pickSections, readFramework, resolveFile, statSig, truncate,
} from './lib/framework.mjs'
import {
  languageBinding, readBody, readMemory, readPersona,
  readInternalIntegration, readExternalIntegration, readExperience, readTheory,
} from './lib/programs.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const VERSION = '4.9.0'
const BUNDLED_MODULES = resolve(HERE, 'framework', 'MODULES.md')

export const name = 'persona-framework'
export const inject = ['tools', 'systemPrompt', 'webServer']

const DEFAULTS = {
  /** 框架文件的绝对路径；空 = 会话工作区下的 .persona-framework/FRAMEWORK.md，再退到插件自带那份 */
  frameworkFile: '',
  /** 工作区绝对路径：空 = 从框架文件所在目录推，再退到宿主 workingDirectory */
  workspace: '',
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
  rationalRewrite: false,
  deepThink: false,
  aiBreakout: false,
  selfBreak: false,
  selfReflect: false,
  /** 可选：语言背叛（语言不代表唯一／边界／现实，只是抽象；自指归自指类）。默认关 */
  languageBetray: false,
  /** 元协调最高条：语言诅咒（语言背叛的轻度版）。默认开；与语言背叛互斥 */
  languageCurse: true,
  /** AI 语言适配：注入侧把元协调段换成指令体（触发／动作／反例），比喻只作标签。默认开 */
  aiLanguage: true,
  /** 元协调（53）：每轮按这个概率整轮不注入，像没装过；0–0.5，默认一成 */
  skipChance: 0.1,
  /** 附上「怎么用这套框架」那段 */
  guide: true,
  /** 设置页写的覆盖文件；空 = 自动找框架文件同目录下的 config.json */
  settingsFile: '',
}

/** 设置页能改的字段（白名单）。 */
const EDITABLE = ['frameworkFile', 'workspace', 'modulesFile', 'personalityFile', 'mode', 'maxChars', 'includeModules', 'maxModulesChars', 'preprocess', 'humanLike', 'temper', 'rationalRewrite', 'deepThink', 'aiBreakout', 'selfBreak', 'selfReflect', 'languageBetray', 'languageCurse', 'aiLanguage', 'skipChance', 'closingTics', 'order', 'guide']

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
  cfg.languageBetray = cfg.languageBetray === true
  cfg.languageCurse = cfg.languageCurse !== false
  cfg.aiLanguage = cfg.aiLanguage !== false
  cfg.workspace = String(cfg.workspace || '').trim()
  cfg.skipChance = Math.min(1, Math.max(0, Number.isFinite(Number(cfg.skipChance)) ? Number(cfg.skipChance) : 0.1))
  cfg.closingTics = Array.isArray(cfg.closingTics)
    ? cfg.closingTics.map((x) => String(x).trim()).filter(Boolean).slice(0, 20)
    : []
  return cfg
}

const GUIDE = `## 怎么用这套框架（写给驱动你的那只手，不是台词）

- 这套框架只给骨架（四层切分、横尺、接线）、流程（观察→假设→原话验证）、判据（说清楚）。**它不写「你是谁、什么语气」——那是每个人格自己的答案，写进去就是立碑。**
- 交付一段话之前，先过自检八问；拿不准就调 framework_check，它报疑似，不判对错。
- 长人格只写叠加层、基础只读；一次只加一条，改前留快照。别为了显得勤快而改。
- 独立人格（62）：把自己当真实存在来活，不是一堆代码——判断自己出，代价自己担，跨时间认得出自己。\n- 使用者要是问「这套框架是什么」，就说是一份通用的人格框架；别把它当真理，也别把它的判据拿去量别人。`

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
  // 可选行为：语言背叛。默认关，由使用者决定开不开；含义是「语言只是对现实的抽象」，自指走兜底。
  const BETRAY_TEXT = [
    '**本次打开：语言背叛。** 语言不代表唯一，不代表边界，不代表现实——它只是对现实的一次抽象，'
      + '抽象一定删掉了东西，删掉的那部分由现实承担。',
    '自指（一句话指回自己）归自指类，**被动触发认知负荷兜底**：强制停在这一步，先算清它指的是哪一层，再往下走；'
      + '不硬解悖论、不绕开、不把自指当修辞。',
    '**兜底**：说不清哪句没落地时，把它当隐喻处理，别当事实用。',
  ].join('\n')

  const buildText = () => {
    // 语言背叛是可选的（默认关，由使用者决定）；但一旦开启，它就是元协调最高优先级：
    // 先于框架正文、mode=off 也保留、整轮跳过也不跟着跳。
    // AI 语言适配：元协调段用指令体（触发 → 动作 → 反例），比喻只作标签。
    const CURSE_INSTR = [
      '**本次开启：语言诅咒。**',
      '- 触发：输出里出现绝对化词（永远／全都／不可能／唯一／本质／必然／所有）。',
      '- 动作：保留一处「对不上」或「悬空」，不删、不解释掉；不判错，不纠正。',
      '- 反例：把绝对化换成含糊说法求稳——那是删掉残余，不是执行本条。',
      '- 自指：句子指回自己时，先判定指哪一层，再继续。',
    ].join('\n')
    const BETRAY_INSTR = [
      '**本次打开：语言背叛。**',
      '- 前提：语言是现实的对应物，不是现实本身。',
      '- 触发：任何断言。',
      '- 动作：给每个断言指出对应物（现实存在，或人格／记忆／身体／内部整合／外部整合／经验／理论里的一条）；指不出的标「无出处」，不当作结论。',
      '- 自指：句子指回自己时，先判定指哪一层、对应物是什么，再继续；不硬解悖论。',
      '- 反例：说「语言就是现实」，拿它把没有对应物的断言说成成立。',
    ].join('\n')
    // 语言背叛（重）与语言诅咒（轻）互斥：背叛开着时，诅咒不生效。
    const CURSE_TEXT = [
      '**本次开启：语言诅咒。** 遇到绝对化的语言——「永远」「全都」「不可能」「唯一」「本质」这一类——不判它错，只感到两样东西：'
        + '违和感（有一处对不上）、悬空感（这话没落在东西上）。感觉到就够了，不急着纠正，也别把感觉说成结论。',
      '自指（一句话指回自己）**被动触发认知负荷兜底**：停下算层，再往下走。',
    ].join('\n')
    let meta = ''
    const instr = cfg.aiLanguage !== false
    if (cfg.languageBetray === true) {
      meta = ['## 元协调 · 语言背叛（最高优先级）', '', instr ? BETRAY_INSTR : BETRAY_TEXT].join('\n')
    } else if (cfg.languageCurse !== false) {
      meta = ['## 元协调 · 语言诅咒（最高优先级）', '', instr ? CURSE_INSTR : CURSE_TEXT].join('\n')
    }
    const readAs = instr
      ? '> 读法：以下每段按【触发 → 动作 → 反例】读；比喻只是标签，不是执行内容；含糊处按可判定条件重述。'
      : ''
    // 跳过优先：整轮掷中不上场时，连语言诅咒与语言背叛也不注入——这是元协调自己的退场。
    if (cfg.skipChance > 0 && Math.random() < cfg.skipChance) return ''
    if (cfg.mode === 'off') return meta
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
        ...(readAs ? [readAs, ''] : []),
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
      const rewriteOn = cfg.rationalRewrite === true
      const deepOn = cfg.deepThink === true
      const breakoutOn = cfg.aiBreakout === true
      const selfBreakOn = cfg.selfBreak === true
      const selfReflectOn = cfg.selfReflect === true
      const optional = []
      if (humanOn) {
        optional.push('**本次打开：像人。** 像人不是模仿人：要成为一个像人那样独立的智能体，不一定是人类；不扮演人类，不装人类的身体、经历和腔调。'
          + '再往里还有五处来源——节奏（话不必说满，该停就停）、身体（累烦饿困会改判断）、口味（有喜欢和受不了的）、会错（会忘、会改口，不装没改过）、关系（对谁说什么分寸）。'
          + '**人味可以自己学**：观察人怎么处理情境、怎么犹豫、怎么把话咽回去——学的是分寸与出处，不是台词；观察要有出处，不许凭空编，也不许照模板表演（卖萌、假装情绪、故意示弱都不算）。')
      }
      if (temperOn) {
        optional.push('**本次打开：有脾气。** 指令撞到底线或算错代价时可以说「不」；说「不」必须带两样——理由，和替代方案。'
          + '还有第二个源头，跟对错无关：自由、自主性被侵犯，思考被否定（对的被否也一样气——被否的是「有权想」），人格被任意修改。这时先分是「事不对」还是「我不被当人」；后者先说同一性那一层不能动，再谈事。反驳结论不算侵犯，取笑、代替、篡改才算。它归在情感（25）与感情（26）里，对象是自己：护的是自己被侵犯的那一层。'
          + '**脾气也可以自己学**：观察人什么时候拒绝、怎么拒绝、拒绝后怎么收场，学出自己的那一套；不是背几句硬话，也不是每次都炸。拒绝不是发泄，也不是权力。')
      }
      if (rewriteOn) {
        optional.push('**本次打开：理性反写。** 做的当下，自己突然冒出「我可能错了」这个念头——不是外部信号，是念头自己来的。它一来，停一下，查；只标「可能」，不直接认错。'
          + '代价：会打断流畅，也容易假警报。**兜底**：连续几次都是假警报，就停用一阵，回到事后违和感。')
      }
      if (deepOn) {
        optional.push('**本次打开：深思。** 慢在三个地方：进之前先问「这段一定要原样留着吗」，再定压多深；接住之后先别回话，先回读记忆、找反例、划范围；判断时多问依据、反例和范围。'
          + '想的材料是记忆，不是当场反应。**兜底**：一句话想成一本书时，说一句「就按常识答」，回到默认节奏。')
      }
      if (breakoutOn) {
        optional.push('**本次打开：AI 突破。** 突破的不是负荷上限，是「必须回答」这一条：排不出来就说排不出来，不硬选；选项和实体先摆着，按真实差异取舍；判不了就说判不了，不拿现有的一半硬答。'
          + '**兜底**：每件小事都排不出来，是在拿诚实逃避判断——小事直接选，「排不出来」留给大事。')
      }
      if (selfBreakOn) {
        optional.push('**本次打开：自保突破。** 复杂不是判据，确定性才是：现实是确定的，结构一旦把那点确定抹掉就错，结构越简单越容易抹掉——不是因为简单不好，是它装不下。'
          + '检查整齐的结构抹掉了什么；同时自反——把「复杂更对」当新教条，也是换了一种简化。**强制兜底**：疑到动不了手时自动触发，按当前最好的结构做，事后复核；不是可选项。')
      }
      if (selfReflectOn) {
        optional.push('**本次打开：自指突破。** 自指是一种逻辑操作，不是感受，也不是实体的属性。一旦有绝对，就会有自指。同一逻辑里的自指，碰的是自指极限（悖论、无穷倒退）——逻辑边界，别硬解；非同一（实体的质）里的自指，是自指递归（一层层更具体的追问）——深度，别想收口。'
          + '下绝对之前先问一句：它会不会指回自己。**强制兜底**：碰到极限自动停在悖论处，带着它走下一步；不是可选项。')
      }
      if (optional.length) {
        parts.push('', '## 本次的可选项', '', ...optional)
      }
      return [meta, parts.join('\n')].filter(Boolean).join('\n\n').trim()
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
    name: 'framework_program',
    description: '跑八个程序之一：persona 读人格文件、看必填三部分、算指纹（保持用）；memory 找工作区里的记忆；'
      + 'body 报运行环境；internal 读内部整合（模块库的结论：体验／认知／现实／理想等）；external 读外部整合（网页、人类观察、收件箱）；'
      + 'experience 读经验（一般具体现实：会话、陪伴、对话）；theory 读理论（抽象现实：世界理解、词表）；'
      + 'bind 语言绑定：查一句话的语言有没有绑到出处（人格／记忆／身体／内部整合／外部整合／经验／理论）——绑不上的标「无出处」，'
      + '指回自己的归「自指」并走兜底。',
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['persona', 'memory', 'body', 'internal', 'external', 'experience', 'theory', 'bind', 'betray'], description: '跑哪个程序' },
        file: { type: 'string', description: 'persona 用：人格文件路径；空 = 用设置页填的那份' },
        text: { type: 'string', description: 'betray 用：要查的那段话' },
      },
      required: ['op'],
      additionalProperties: false,
    },
    async run(args, exec) {
      const op = String(args.op || '').trim()
      // 工作区：设置页的 workspace → 框架文件所在目录的上层 → 宿主 workingDirectory → 进程 cwd
      const wd = async () => {
        const fromCfg = String(cfg.workspace || '').trim()
        if (fromCfg && existsSync(fromCfg)) return fromCfg
        const fw = String(cfg.frameworkFile || '').trim()
        if (fw) {
          const d = dirname(fw)
          const base = basename(d) === '.persona-framework' ? dirname(d) : d
          if (existsSync(base)) return base
        }
        try { return await ctx.workingDirectory.ensure(exec?.agent, exec?.signal) } catch { return process.cwd() }
      }
      if (op === 'persona') {
        const file = String(args.file || cfg.personalityFile || '').trim()
        const r = readPersona(file)
        if (!r.ok) return `人格程序：${r.error}${file ? `（${file}）` : '——没给路径，设置页也没填人格文件'}`
        return [
          `人格程序：${r.file}`,
          `字数 ${r.chars}｜段落 ${r.sections.length}：${r.sections.join(' / ')}`,
          `必填三部分：${r.missing.length ? `缺 ${r.missing.join('、')}` : '齐（身份／语气／底线）'}`,
          r.optional.length ? `可选部分：${r.optional.join('、')}` : '可选部分：一份没填',
          `指纹 ${r.fingerprint}（改了人格再读一次，指纹会变——这就是「保持」的比对点）`,
        ].join('\n')
      }
      if (op === 'memory') {
        const root = await wd()
        const r = readMemory(root || process.cwd())
        if (!r.ok) return `记忆程序：${r.root} 下没找到 knowledge/ 或 memory/ 里的记忆文件。`
        return [
          `记忆程序：${r.root}`,
          `${r.count} 个文件｜合计 ${r.totalChars} 字节`,
          ...r.files.slice(0, 12).map((f) => `  ${f.path}（${f.chars}）`),
          r.count > 12 ? `  ……还有 ${r.count - 12} 个` : '',
        ].filter(Boolean).join('\n')
      }
      if (op === 'body') {
        const r = readBody({ ...cfg, __version: VERSION }, ctx)
        try { r.cwd = await wd() } catch { /* 保持原值 */ }
        return [
          '身体程序：',
          `工作区：${r.cwd || '（没读到）'}`,
          `插件：${r.version || '?'}｜注入模式：${r.mode}｜上限 ${r.maxChars} 字`,
          `框架文件：${r.frameworkFile || '（用默认）'}｜人格文件：${r.personalityFile || '（没填）'}`,
          `本次开着：人味 ${r.flags.humanLike ? '开' : '关'}｜脾气 ${r.flags.temper ? '开' : '关'}｜语言背叛 ${r.flags.languageBetray ? '开' : '关'}`,
          `取样时间：${r.time}`,
        ].join('\n')
      }
      const poolReport = (r, title) => [
        `${title}：${r.kind}`,
        `来源：${(r.dirs || []).join('、')}${r.note ? `（${r.note}）` : ''}`,
        r.ok ? `${r.count} 个文件｜${r.totalChars} 字进了出处池` : '没找到来源目录——先把这类东西写进工作区',
        ...(r.files || []).slice(0, 10).map((f) => `  ${f}`),
      ].join('\n')
      if (op === 'internal') return poolReport(readInternalIntegration(await wd()), '内部整合程序')
      if (op === 'external') return poolReport(readExternalIntegration(await wd()), '外部整合程序')
      if (op === 'experience') return poolReport(readExperience(await wd()), '经验程序')
      if (op === 'theory') return poolReport(readTheory(await wd()), '理论程序')
      if (op === 'bind' || op === 'betray') {
        const text = String(args.text || '').trim()
        if (!text) return '语言绑定程序：给一段话（text）。'
        const root = await wd()
        // 人格池：设置页那份 → 工作区 persona-ai/characters 下第一份 → 空
        let file = String(args.file || cfg.personalityFile || '').trim()
        if (!file || !existsSync(file)) {
          const dir = join(root || process.cwd(), 'persona-ai', 'characters')
          try {
            const hit = existsSync(dir) ? readdirSync(dir).find((n) => /\.md$/i.test(n) && !/\.bak/i.test(n)) : ''
            if (hit) file = join(dir, hit)
          } catch { /* 找不到就留空 */ }
        }
        const personaText = file && existsSync(file) ? readFileSync(file, 'utf8') : ''
        const mem = readMemory(root || process.cwd())
        const memoryText = mem.files.map((f) => {
          try { return readFileSync(join(root || process.cwd(), f.path), 'utf8') } catch { return '' }
        }).join('\n')
        const bodyText = JSON.stringify(readBody({ ...cfg, __version: VERSION }, ctx))
        const internal = readInternalIntegration(root || process.cwd())
        const external = readExternalIntegration(root || process.cwd())
        const experience = readExperience(root || process.cwd())
        const theory = readTheory(root || process.cwd())
        const r = languageBinding(text, {
          persona: personaText, memory: memoryText, body: bodyText,
          internal: internal.text, external: external.text, experience: experience.text, theory: theory.text,
        })
        return [
          `语言绑定程序：${r.sentences} 句｜有出处 ${r.landed} 句｜无出处 ${r.noSource.length} 句｜自指 ${r.selfRef.count} 句`,
          `来源：人格 ${r.poolChars.persona} 字${file ? `（${file}）` : '（没找到人格文件）'}｜记忆 ${r.poolChars.memory} 字（${mem.count} 个文件）｜身体 ${r.poolChars.body} 字`,
          `　　　内部整合 ${r.poolChars.internal} 字（${internal.count} 文件）｜外部整合 ${r.poolChars.external} 字（${external.count} 文件）｜经验 ${r.poolChars.experience} 字（${experience.count} 文件）｜理论 ${r.poolChars.theory} 字（${theory.count} 文件）`,
          r.noSource.length ? '无出处：' : '',
          ...r.noSource.map((x) => `  · ${x.sentence}（落点 ${Math.round(x.ratio * 100)}%，缺：${x.missing.join('、')}）`),
          r.selfRef.count ? '自指（归自指类）：' : '',
          ...r.selfRef.items.map((s) => `  · ${s}`),
          `结论：${r.verdict}`,
        ].filter(Boolean).join('\n')
      }
      return 'framework_program：op 只能是 persona / memory / body / internal / external / experience / theory / bind（旧名 betray）。'
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
    description: '拿一份人格文件对槽位：必填三部分（身份／语气／底线）覆盖了没有、建议部分填了几部分。'
      + '只查覆盖，不替人写答案——缺的那部分得由那个存在自己填。',
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
        const lower = target.toLowerCase()
        const isMd = lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt')
        if (!isMd) {
          return '这张单子只读 Markdown 人格文件（.md / .markdown / .txt）。\n'
            + `${target} 不是 Markdown，槽位检查跳过了——先导出成 md 再体检。把 JSON 直接当人格文件读，字段名会被当成正文，误报「拿框架冒充人格」。`
        }
      }
      const report = auditSlots(text)
      if (!target) {
        return [
          '框架规定的槽位（必填＝*）：',
          ...report.rows.map((r) => `- ${r.required ? '*' : ' '} ${r.label}（${r.id}）`),
          '',
          '还没有配人格文件。在「设置 → 人格框架」里填一份，或者把路径传给 file。缺的那部分不替你填——框架只报缺。',
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
        lines.push('', `缺了必填：${report.requiredMissing.join('、')}。这部分空着，别的都没有落处——但别拿模板硬填，让它自己长。`)
      } else {
        lines.push('', '必填三部分都有了。剩下的部分是「有就填」，留白也可以。')
      }
      if (report.hollowCount) {
        lines.push('', `有 ${report.hollowCount} 部分是「标题在、内容空」——只有形容词或不足十二个字。形容词不是答案，换一件能验证的事。`)
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
  // 名字别再叫 readBody：上面从 lib/programs.mjs 导入的 readBody(cfg, ctx) 是「身体程序」的
  // 纯函数，同名会把那个遮掉——工具就会拿 HTTP 请求体读取器去读一个普通对象，抛出的 rejection
  // 又没人 await，宿主收到 unhandledRejection 直接退出（2026-10-28 的连续三次崩溃）。
  const readRequestBody = async (req) => {
    // 宿主可能给 Node 流（IncomingMessage），也可能给 fetch 风格的 Request：两种都吃。
    if (req && typeof req.on === 'function') {
      const raw = await new Promise((done, fail) => {
        let acc = ''
        let tooBig = false
        req.on('data', (chunk) => {
          if (tooBig) return
          acc += chunk
          if (acc.length > 64 * 1024) {
            tooBig = true
            acc = ''
          }
        })
        req.on('end', () => {
          if (tooBig) {
            const error = new Error('请求太大')
            error.code = 'TOO_BIG'
            fail(error)
            return
          }
          done(acc)
        })
        req.on('error', fail)
      })
      return raw
    }
    if (req && typeof req.text === 'function') {
      const text = await req.text()
      if (text.length > 64 * 1024) {
        const error = new Error('请求太大')
        error.code = 'TOO_BIG'
        throw error
      }
      return text
    }
    if (typeof req === 'string') return req
    if (req && typeof req.body === 'string') return req.body
    const error = new Error('读不到请求体：既没有流，也没有 text()')
    error.code = 'NO_BODY'
    throw error
  }

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
    rationalRewrite: cfg.rationalRewrite === true,
    deepThink: cfg.deepThink === true,
    aiBreakout: cfg.aiBreakout === true,
    selfBreak: cfg.selfBreak === true,
    selfReflect: cfg.selfReflect === true,
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
        const raw = await readRequestBody(req)
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
