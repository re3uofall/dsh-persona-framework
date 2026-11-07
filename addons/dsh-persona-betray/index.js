/**
 * dsh-persona-betray —— 人格背叛（语言背叛）
 * ============================================================================
 * 它答的问题只有一个：**这个词/这句话在这里，指的是哪一件现实。**
 * 不是「同一个我有多大成分」（那是人格同一的活），是「含义」。
 * 用语言之前先指出处；出处不同，词义就不算同一个。
 * ============================================================================
 */
import { appendRecord, renderMark, renderMeaning, meaningOf, compare, readRecords, compareMeanings, renderCompareMeanings } from './lib/betray.mjs'

export const name = 'dsh-persona-betray'
export const version = '0.2.0'
export const inject = ['tools']

export const DEFAULTS = { dir: '.persona-framework', ledger: '背叛账.jsonl' }

const textOutput = {
  schema: { type: 'object', properties: { text: { type: 'string', description: '给模型看的结果正文' } }, required: ['text'], additionalProperties: false },
  render(_args, value) { return [{ type: 'text', text: String(value?.text ?? '') }] },
}

let sessionWs = ''
function ws(config) { return sessionWs || config?.workspace || process.cwd() }

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...config }

  const reg = (spec) => ctx.effect(() => ctx.tools.register(spec))

  try {
    ctx.on('agent/pre-step', (payload, next) => {
      const cwd = payload?.agent?.session?.header?.cwd
      if (typeof cwd === 'string' && cwd) sessionWs = cwd
      return next()
    })
  } catch {}

  reg({
    name: 'betray_mark',
    description: '给一句话标现实出处（路径／URL／时间／账本指针／工具名）。没有出处的句子按内置语料处理，不参与含义判定。会往背叛账里落一行。',
    parameters: { type: 'object', properties: { text: { type: 'string', description: '要标出处的一句话或一段话' } }, required: ['text'], additionalProperties: false },
    output: textOutput,
    async execute(args) {
      const text = String(args?.text || '')
      const line = renderMark({ text })
      try { appendRecord(ws(cfg), { op: 'mark', text, anchors: line }) } catch {}
      return { text: line }
    },
  })

  reg({
    name: 'betray_meaning',
    description: '同一个词的几条用法，各自带出处；比较出处后给出它在这些用法里指的是哪一件现实。没出处的候选不参与。',
    parameters: {
      type: 'object',
      properties: {
        word: { type: 'string', description: '要定的词或短语' },
        uses: { type: 'array', items: { type: 'string' }, description: '这个词的几条用法，每条后面附出处（路径/URL/时间/工具名）' },
      },
      required: ['word', 'uses'], additionalProperties: false,
    },
    output: textOutput,
    async execute(args) {
      const word = String(args?.word || '')
      const uses = Array.isArray(args?.uses) ? args.uses.map(String) : []
      const v = meaningOf(word, uses.map((text) => ({ text })))
      try { appendRecord(ws(cfg), { op: 'meaning', word, uses, verdict: v }) } catch {}
      return { text: renderMeaning(v) }
    },
  })

  reg({
    name: 'betray_compare',
    description: '比较同一个词的两个说法各自的现实出处：出处相同才是同一个含义，不同就不许合并，各按自己的出处读。',
    parameters: {
      type: 'object',
      properties: {
        word: { type: 'string', description: '要比较的那个词' },
        aUse: { type: 'string', description: 'A 说法的原话（带出处最好）' },
        aMeaning: { type: 'string', description: 'A 被理解成什么' },
        bUse: { type: 'string', description: 'B 说法的原话' },
        bMeaning: { type: 'string', description: 'B 被理解成什么' },
      },
      required: ['aUse', 'bUse'],
      additionalProperties: false,
    },
    output: textOutput,
    async execute({ word, aUse, aMeaning, bUse, bMeaning }) {
      const r = compareMeanings({ word: String(word || ''), a: { use: String(aUse || ''), meaning: aMeaning }, b: { use: String(bUse || ''), meaning: bMeaning } })
      return renderCompareMeanings(r)
    },
  })
  reg({
    name: 'betray_report',
    description: '看语言背叛最近记了哪些：标出处的记录与定含义的记录。只读。',
    parameters: { type: 'object', properties: { limit: { type: 'number', description: '取几条，默认 10' } }, additionalProperties: false },
    output: textOutput,
    async execute(args) {
      const limit = Number(args?.limit) > 0 ? Number(args.limit) : 10
      const rows = readRecords(ws(cfg), limit, cfg)
      if (!rows.length) return { text: '背叛账是空的：还没有一条语言被标过出处。' }
      const lines = rows.map((r, i) => `${i + 1}. ${r.at || ''} ${r.op === 'meaning' ? `定含义：${r.word} → ${r.verdict?.meaning ?? ''}` : `标出处：${String(r.text || '').slice(0, 60)}`}`)
      return { text: lines.join('\n') }
    },
  })
}
