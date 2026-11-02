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
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_LAYERS, archiveOld, recall, renderArchive, renderPools, renderRecall, scanPools,
} from './lib/pools.mjs'
import { condenseJournal, excerpt, renderCondense } from './lib/journal.mjs'

export const name = 'persona-memory'
// systemPrompt 必须声明：不声明就不会先加载它，`ctx.systemPrompt` 是 undefined，
// `ctx.effect(() => ctx.systemPrompt.section(...))` 抛 TypeError 被 catch 吞掉——
// 表现是「插件 active、自测全过、渲染出得来，注入里一个字都没有」。
export const inject = ['tools', 'systemPrompt']

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
}

function cfgOf(ctx, cfg) {
  const c = { ...DEFAULTS, ...(cfg || {}) }
  if (!c.root) {
    try {
      const wd = ctx?.config?.workspace || ctx?.workspace
      if (wd) c.root = String(wd)
    } catch { /* 保持空 */ }
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

export function apply(ctx, config = {}) {
  const cfg = cfgOf(ctx, config)

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

  for (const t of tools) ctx.tools?.register?.(t)

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
}
