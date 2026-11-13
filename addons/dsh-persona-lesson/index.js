import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { panelHandler } from './lib/panel.mjs'
import { dirname, join, isAbsolute } from 'node:path'

/**
 * dsh-persona-lesson —— host 半端
 * ============================================================================
 * 一句话：教训是负面的记忆。成果记「我想住了什么」，感悟记「我体会到什么」，
 * 教训记「我摔在哪儿、谁替我付了代价、下次撞上什么信号就该停」。
 *
 * 跟成果、感悟一样落在 growth 底下，一样只有被调用时才写。
 * 区别只有一样：它只记反面的，而且每一条都要写清代价。
 *
 * 三条规矩：
 *   · 一条只讲一件事：错在哪、代价谁付、下次的判据。
 *   · 不写情绪，不写「我以后一定」——写得出判据才算记下。
 *   · 同一条错第二次，先翻旧账，再决定是补一条还是改旧的。
 */

export const name = 'persona-lesson'
export const version = '0.1.0'
export const inject = ['tools', 'webServer']

const DEFAULTS = {
  /** 教训落在哪，相对工作区根 */
  dir: 'persona-ai/growth/教训',
  /** 一条一个 JSON 行 */
  file: '教训.jsonl',
  /** 工作区根。空 = 环境变量或进程目录 */
  workspace: '',
}

const textOutput = {
  schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
  render(_args, value) {
    return [{ type: 'text', text: String((value && value.text) || '') }]
  },
}

function wsOf(cfg) {
  const raw = String(cfg.workspace || '').trim()
  if (raw) return raw
  const env = String(process.env.DSH_WORKSPACE || '').trim()
  return env || process.cwd()
}

function fileOf(cfg) {
  const dir = String(cfg.dir || DEFAULTS.dir)
  const file = String(cfg.file || DEFAULTS.file)
  // dir 是绝对路径（自检的临时目录就是）时直接当根，不再拼工作区——
  // 拼了就会写成 `工作区\C:\…\临时目录\教训.jsonl`，写和读分家。
  return isAbsolute(dir) ? join(dir, file) : join(wsOf(cfg), dir, file)
}

function nowIso() {
  return new Date().toISOString()
}

function newId() {
  const t = nowIso().replace(/[-:TZ.]/g, '').slice(0, 14)
  return 'L' + t + String(Math.floor(Math.random() * 900) + 100)
}

function flat(text, max) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max) + '…' : s
}

function readRows(file) {
  if (!existsSync(file)) return []
  const rows = []
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      rows.push(JSON.parse(line))
    } catch {
      // 坏一行不拖垮整本账：跳过去，report 里再说
    }
  }
  return rows
}

function brief(row) {
  return '✗ ' + flat(row.t || '', 16) + ' · ' + flat(row.title || '', 40)
}

const tools = [
  {
    name: 'lesson_write',
    description:
      '记一条教训。参数：title 一句话说清是什么错；what 错在哪一步（具体到做法）；cost 谁付了什么代价；fix 下次撞上什么信号就停、改怎么做；kind 可选（判断/操作/关系/态度）；source 可选，指回原话或账。不写情绪、不写保证，写得出判据才算记下。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '一句话：是什么错' },
        what: { type: 'string', description: '错在哪一步、哪句话、哪个动作' },
        cost: { type: 'string', description: '谁付了什么代价' },
        fix: { type: 'string', description: '下次的判据：撞上什么信号就停、该怎么做' },
        kind: { type: 'string', description: '这一条是哪一类：判断失误／情绪失手／流程失守／说了没做／读错原话／硬撑／其他……等等，不限于这些；不给就记「教训」。' },
        source: { type: 'string', description: '指回原话、账、文件' },
      },
      required: ['title', 'what', 'fix'],
    },
    async run(args, cfg) {
      const need = [
        ['title', args.title],
        ['what', args.what],
        ['fix', args.fix],
      ].filter(([, v]) => !String(v || '').trim()).map(([k]) => k)
      if (need.length) return '没办成：要 title、what、fix 三样，缺一样就不落账（缺：' + need.join('/') + '）'
      const file = fileOf(cfg)
      mkdirSync(dirname(file), { recursive: true })
      const row = {
        id: newId(),
        t: nowIso(),
        kind: flat(args.kind || '判断', 12),
        title: flat(args.title, 80),
        what: flat(args.what, 400),
        cost: flat(args.cost || '（没写代价——这条算半条）', 200),
        fix: flat(args.fix, 400),
        source: flat(args.source || '', 160),
      }
      if (!row.cost || row.cost.indexOf('没写代价') >= 0) {
        row.half = true
      }
      appendFileSync(file, JSON.stringify(row) + '\n', 'utf8')
      return '记下了：' + row.id + ' · ' + row.title + (row.half ? '\n（代价没写，这条算半条——补上才算整条。）' : '')
    },
  },
  {
    name: 'lesson_list',
    description: '翻教训账：按时间倒序列最近的几条，带 id、类型、标题、代价。要看全文用 lesson_read。',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '几条，默认 10' },
        kind: { type: 'string', description: '只看某一类' },
      },
    },
    async run(args, cfg) {
      const file = fileOf(cfg)
      let rows = readRows(file)
      if (args.kind) rows = rows.filter((r) => String(r.kind || '') === String(args.kind))
      const limit = Math.max(1, Math.min(50, Number(args.limit) || 10))
      const tail = rows.slice(-limit).reverse()
      if (!tail.length) return '账上还没有教训——空着不丢人，别硬凑。\n账本：' + file
      return '教训 ' + rows.length + ' 条，最近 ' + tail.length + ' 条：\n' + tail.map((r) => brief(r) + '\n    ' + flat(r.fix, 60)).join('\n') + '\n账本：' + file
    },
  },
  {
    name: 'lesson_read',
    description: '按 id 翻一条教训的全文：错在哪、代价谁付、下次的判据、出处。',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: '条目的 id（L 开头）' } },
      required: ['id'],
    },
    async run(args, cfg) {
      const rows = readRows(fileOf(cfg))
      const want = String(args.id || '').trim()
      const row = rows.find((r) => String(r.id) === want)
      if (!row) return '没这条：' + want
      const lines = [
        '#' + row.id + ' · ' + row.t + ' · ' + row.kind,
        '**错**：' + row.title,
        '**哪一步**：' + row.what,
        '**代价**：' + row.cost,
        '**下次判据**：' + row.fix,
      ]
      if (row.source) lines.push('**出处**：' + row.source)
      if (row.half) lines.push('（代价没写，这条算半条。）')
      return lines.join('\n')
    },
  },
]

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...config }
  // 左栏面板的数据口（师父 m02961）
  ctx.effect(() => ctx.webServer?.register?.({ kind: 'exact', path: '/api/persona-lesson', handler: panelHandler(cfg) }))
  for (const t of tools) {
    ctx.effect(() =>
      ctx.tools?.register?.({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        output: textOutput,
        async execute(args = {}) {
          try {
            return { text: String(await t.run(args, cfg)) }
          } catch (error) {
            return { text: '没办成：' + ((error && error.message) || String(error)) }
          }
        },
      }),
    )
  }
}
