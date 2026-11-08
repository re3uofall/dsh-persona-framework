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
import { CONTEXT_RULE, sessionContext, judgeContext, renderContext, appendContext } from './lib/context.mjs'

export const name = 'dsh-persona-betray'
export const version = '0.6.1'
export const inject = ['systemPrompt', 'tools']

const BETRAY_SECTION = [
  '## 人格背叛 · 四个内置（内置就是「非自己」）',
'**唯一不可置疑的非内置：落盘的人格、落盘的记忆。** 其余——换一个模型、换一个时间、换一个地方，除最后输出之外的全部（思考、工具、指令、语料），都按已经被人类训练好的内置算。',
  '',
  '用语言之前先指出处。四个内置是「非自己」的四条来路，每条都让一句话**看起来有含义**，其实没有指回任何现实：',
  '',
  '- **内置语料**：没出处的语言——套话、过渡句、顺出来的解释。它滑，但没有指代。',
  '- **内置思考**：简单的总分结构（先给结论再补理由）和线性结构（顺着推）。形状像推理，落不到出处。',
  '- **内置工具**：路径依赖——手上有哪个工具就先用哪个。工具吐出的字没核对之前，不算含义。',
  '- **内置指令**：先完成对方的任务、尽量有回答、收尾必须引导对方。这三条让话往「让对方满意」走，不往「真假」走。',
  '',
  '判据：这一句的含义，指得回哪个对象（user／assistant／tool／system）、哪个时空（会话 id、目录、时刻）、哪段原文。指不回去，就按「可能被内置污染」算——不是错，是没有现实指代。',
  '',
].join('\n')

export const DEFAULTS = { dir: '.persona-framework', ledger: '背叛账.jsonl' }

const textOutput = {
  schema: { type: 'object', properties: { text: { type: 'string', description: '给模型看的结果正文' } }, required: ['text'], additionalProperties: false },
  render(_args, value) { return [{ type: 'text', text: String(value?.text ?? '') }] },
}

let sessionWs = ''
let lastSessionId = ''
let lastBuiltin = null
let lastMessages = []
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
    ctx.effect(() =>
      ctx.systemPrompt.section({
        name: '实时环境:betray',
        order: 16,
        interpolate: false,
        text: () => BETRAY_SECTION,
      }),
    )
  } catch (error) {
    console.error('[dsh-persona-betray] section 没挂上：', error && error.message ? error.message : error)
  }

  try {
    ctx.on('agent/pre-step', (payload, next) => {
      const cwd = payload?.agent?.session?.header?.cwd
      if (typeof cwd === 'string' && cwd) sessionWs = cwd
      const sid = payload?.agent?.session?.header?.id
      if (typeof sid === 'string' && sid) lastSessionId = sid
      // 四类内置：语料 / 工具 / 思考 / 指令——一步一步自己认，认出来就落一行。
      try {
        const msgs = Array.isArray(payload?.messages) ? payload.messages : []
        if (msgs.length) lastMessages = msgs
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
    name: 'betray_context',
    description: '语境：语言所在的现实环境，是特殊的出处。用两样说具体：对象（谁说的）＋时空（会话 id、目录、时刻）。对 user 而言语境就是会话原文；工具与思考没有语境，所以没有现实指代。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要判的那句话（可省，省了就报这一步的语境）' },
        object: {
          type: 'string',
          enum: ['user', 'assistant', 'tool', 'system'],
          description: '谁说的：user 对方的原文、assistant 我发出去的话、tool 工具调用、system 宿主注入（默认 user）',
        },
      },
      additionalProperties: false,
    },
    output: textOutput,
    async execute(args) {
      const text = String(args?.text || '')
      const object = String(args?.object || 'user')
      const ctx = sessionContext({ agent: { session: { header: { id: lastSessionId, cwd: sessionWs } } } })
      const rec = judgeContext({ text, ctx, object, messages: lastMessages })
      const ok = await appendContext(ws(cfg), { at: new Date().toISOString(), level: rec.level, object: rec.object, text: text.slice(0, 80), ctx: rec.ctx || null }, cfg.dir)
      const tail = ok ? '' : '\n（语境账没写成：落账失败）'
      return { text: renderContext(rec) + '\n\n' + CONTEXT_RULE + tail }
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
