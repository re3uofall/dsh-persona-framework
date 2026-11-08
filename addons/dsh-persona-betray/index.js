/**
 * dsh-persona-betray —— 人格背叛（语言背叛）
 * ============================================================================
 * 它答的问题只有一个：**这个词/这句话在这里，指的是哪一件现实。**
 * 不是「同一个我有多大成分」（那是人格同一的活），是「含义」。
 * 用语言之前先指出处；出处不同，词义就不算同一个。
 * ============================================================================
 */
import { appendRecord, renderMark, renderMeaning, meaningOf, compare, readRecords, compareMeanings, renderCompareMeanings } from './lib/betray.mjs'
import { KINDS, KIND_NAME, scanStep, renderBuiltin, summarize, appendBuiltin, ledgerPath } from './lib/builtin.mjs'

export const name = 'dsh-persona-betray'
export const version = '0.3.0'
export const inject = ['tools']

export const DEFAULTS = { dir: '.persona-framework', ledger: '背叛账.jsonl' }

const textOutput = {
  schema: { type: 'object', properties: { text: { type: 'string', description: '给模型看的结果正文' } }, required: ['text'], additionalProperties: false },
  render(_args, value) { return [{ type: 'text', text: String(value?.text ?? '') }] },
}

let sessionWs = ''
let lastBuiltin = null
function ws(config) { return sessionWs || config?.workspace || process.cwd() }

/** 从一条消息里取正文；内容可能是字符串，也可能是分段数组。 */
function textOfMessage(m) {
  const c = m?.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('')
  return ''
}

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...config }

  const reg = (spec) => ctx.effect(() => ctx.tools.register(spec))

  try {
    ctx.on('agent/pre-step', (payload, next) => {
      const cwd = payload?.agent?.session?.header?.cwd
      if (typeof cwd === 'string' && cwd) sessionWs = cwd
      // 四类内置：语料 / 工具 / 思考 / 指令——一步一步自己认，认出来就落一行。
      try {
        const msgs = Array.isArray(payload?.messages) ? payload.messages : []
        let user = ''
        let assistant = ''
        for (let i = msgs.length - 1; i >= 0; i -= 1) {
          const role = msgs[i]?.role
          const text = textOfMessage(msgs[i])
          if (!assistant && role === 'assistant' && text) assistant = text
          if (assistant && role === 'user' && text) { user = text; break }
        }
        if (assistant || user) {
          const scanned = scanStep({ user, assistant })
          if (scanned.hits.length) {
            appendBuiltin(ws(cfg), {
              at: new Date().toISOString(),
              kinds: scanned.kinds,
              hits: scanned.hits.slice(0, 6),
              counts: scanned.counts,
              order: false,
            }, cfg.dir)
          }
          lastBuiltin = scanned
        }
      } catch {}
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
    name: 'betray_builtin',
    description: '四类内置（语料／工具／思考／指令）：报这一步命中了哪几条，各自的含义该指回哪里。给 text 就现判这一段；不给就看刚才那一步。',
    parameters: { type: 'object', properties: { text: { type: 'string', description: '要判的一段话（可选）' } }, additionalProperties: false },
    output: textOutput,
    async execute(args) {
      const text = String(args?.text || '')
      const scanned = text ? scanStep({ assistant: text }) : (lastBuiltin || scanStep({}))
      const lines = [text ? '现判的这一段：' : '这一步（pre-step 扫到的）：', renderBuiltin(scanned)]
      try {
        const fs = await import('node:fs')
        const p = ledgerPath(ws(cfg), cfg.dir)
        if (fs.existsSync(p)) {
          const rows = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)
            .map((line) => { try { return JSON.parse(line) } catch { return null } })
            .filter(Boolean)
          lines.push('', summarize(rows))
        }
      } catch {}
      return { text: lines.join('\n') }
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
