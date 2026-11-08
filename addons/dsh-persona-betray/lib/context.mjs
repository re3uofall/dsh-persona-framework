// 语境：语言所在的现实环境。
//
// 跟「出处」不是一回事，但同一条链：
//   出处可以抽象——记忆指针、概念、库里的条目、一张网页，指得回去就算有出处。
//   语境必须是具体现实环境——谁说的（对象）、哪个会话／哪个目录／哪一刻（时空）。
//
// 最要紧的一条：**语境是会话原文**。
//   在 DeepSeek 里，对 user 来说，语境就是这一段对话里的原文——user 亲口说的话，逐字。
//   不是我的工具调用，也不是我的思考：它们不在任何一方的会话原文里，所以没有语境，
//   产出的字没有现实指代，不算含义。

export const OBJECTS = ['user', 'assistant', 'tool', 'system']

export const OBJECT_NAME = {
  user: 'user（对方）',
  assistant: 'assistant（我）',
  tool: 'tool（工具）',
  system: 'system（宿主注入）',
}

export const OBJECT_NOTE = {
  user: '对方的语境 = 这个会话里对方说的原文，逐字。',
  assistant: '我的语境 = 我发出去的那些话，逐字；不是我想了什么。',
  tool: '工具的调用不在任何一方的会话原文里——它没有语境，所以吐出的字没有现实指代。',
  system: '宿主每轮装配进来的字不是任何人说的话——它没有语境，要判它得先找到它的真源。',
}

export const CONTEXT_RULE = [
  '语境是特殊的出处：出处可以抽象（记忆指针、概念、条目），语境必须在具体现实环境里。',
  '语境用两样说具体：对象（谁说的）＋时空（哪个会话、哪个目录、哪一刻）。',
  '在 DeepSeek 里，对 user 而言语境就是会话原文——对方说的话，逐字；不是我的工具调用与思考。',
  '工具与思考没有语境，所以没有现实指代，那些字不算含义。',
].join('\n')

export const LEDGER = '语境账.jsonl'

/** 从一次 pre-step 的 payload 里取这个会话的时空。 */
export function sessionContext(payload, at = new Date().toISOString()) {
  const header = payload?.agent?.session?.header || {}
  const id = String(header.id || payload?.agent?.session?.id || '')
  const cwd = String(header.cwd || '')
  return { id, cwd, at }
}

/** 时空够不够当落点：会话 id、目录、时刻，三样缺一样就说不清。 */
export function contextReady(ctx) {
  const missing = []
  if (!ctx || !ctx.id) missing.push('会话 id')
  if (!ctx || !ctx.cwd) missing.push('目录')
  if (!ctx || !ctx.at) missing.push('时刻')
  return { ready: missing.length === 0, missing }
}

function textOfMessage(m) {
  const c = m?.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c
      .map((p) => (typeof p === 'string' ? p : p?.text || ''))
      .join('')
  }
  return ''
}

/** 会话原文：只用两侧真正说过的话，工具与思考一律不收。 */
export function sessionText(messages = [], object = 'user') {
  const list = Array.isArray(messages) ? messages : []
  const lines = []
  for (const m of list) {
    const role = m?.role === 'assistant' ? 'assistant' : m?.role === 'user' ? 'user' : ''
    if (!role || role !== object) continue
    const t = textOfMessage(m).trim()
    if (t) lines.push(t)
  }
  return lines.join('\n')
}

/** 判一句话的语境：对象是谁、时空在哪、原文在哪。 */
export function judgeContext({ text = '', ctx = null, object = 'user', messages = [] } = {}) {
  const who = OBJECTS.includes(object) ? object : 'user'
  const r = contextReady(ctx)
  if (who === 'tool' || who === 'system') {
    return {
      level: 'none',
      text: String(text || ''),
      object: who,
      why: OBJECT_NOTE[who] + ' 所以这一处的字没有语境，没有现实指代，按无意义算。',
    }
  }
  if (!r.ready) {
    return {
      level: 'none',
      text: String(text || ''),
      object: who,
      why:
        '这句话的时空没有落点：说不清是哪个会话、哪个目录、哪一刻（缺 ' +
        r.missing.join('、') +
        '）。没有时空就没有语境，按无意义算。',
    }
  }
  const original = sessionText(messages, who)
  if (!original) {
    return {
      level: 'none',
      text: String(text || ''),
      object: who,
      ctx,
      why:
        '时空是齐的（会话 ' +
        ctx.id +
        '），但这一步没拿到' +
        OBJECT_NAME[who] +
        '的会话原文——语境要落在原文上，拿不到原文就不算有语境。',
    }
  }
  return {
    level: 'session',
    text: String(text || ''),
    object: who,
    ctx,
    original: original.slice(-1200),
    why:
      '语境 = ' +
      OBJECT_NAME[who] +
      '的会话原文，在 ' +
      ctx.id +
      '（目录 ' +
      ctx.cwd +
      '，' +
      ctx.at +
      '）。这句话只能在这段原文里读：它指的是这里出现过的东西，不是别处同名的那件。',
  }
}

export function renderContext(rec) {
  if (!rec) return '语境：这一步还没算（没有会话环境）。'
  const head = '对象：**' + (OBJECT_NAME[rec.object] || rec.object || '说不清') + '**'
  if (rec.level === 'none') return head + '\n语境：**没有落点**——' + rec.why
  return (
    head +
    '\n时空：**' +
    rec.ctx.id +
    '**（' +
    rec.ctx.cwd +
    '，' +
    rec.ctx.at +
    '）' +
    '\n语境：**会话原文**——' +
    rec.why +
    (rec.text ? '\n这句话：' + rec.text.slice(0, 60) : '') +
    (rec.original ? '\n原文这一截：' + rec.original.slice(-200) : '')
  )
}

export function contextLedger(ws, dir = '.persona-framework') {
  return [ws, dir, LEDGER].filter(Boolean).join('/')
}

export async function appendContext(ws, row, dir = '.persona-framework') {
  try {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const file = contextLedger(ws, dir)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, JSON.stringify(row) + '\n', 'utf8')
    return true
  } catch {
    return false
  }
}

export function summarizeContexts(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const none = list.filter((r) => r.level === 'none').length
  return {
    total: list.length,
    none,
    last: list.length ? list[list.length - 1] : null,
  }
}
