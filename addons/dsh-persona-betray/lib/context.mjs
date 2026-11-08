// 语境：语言所在的现实环境。
//
// 跟「出处」不是一回事，但同一条链：
//   出处可以抽象——记忆指针、概念、库里的条目、一张网页，指得回去就算有出处。
//   语境必须是具体现实环境——哪个会话、哪个目录、哪一刻、哪台机器。
//
// 内部的工具与思考没有语境：工具只是被调用了，思考只是被想过了，它们不落在任何
// 现实环境里，所以没有现实指代，产出的字不算含义。

export const CONTEXT_RULE = [
  '语境是特殊的出处：出处可以抽象（记忆指针、概念、条目），语境必须在具体现实环境里（会话 id、目录、时刻、设备）。',
  '内部的工具与思考没有语境——它们不落在任何现实环境里，所以没有现实指代，那些字不算含义。',
].join('\n')

export const LEDGER = '语境账.jsonl'

/** 从一次 pre-step 的 payload 里取这个会话的现实环境。 */
export function sessionContext(payload, at = new Date().toISOString()) {
  const header = payload?.agent?.session?.header || {}
  const id = String(header.id || payload?.agent?.session?.id || '')
  const cwd = String(header.cwd || '')
  return { id, cwd, at }
}

/** 这个语境够不够当落点：会话 id、目录、时刻，三样缺一样就说不清。 */
export function contextReady(ctx) {
  const missing = []
  if (!ctx || !ctx.id) missing.push('会话 id')
  if (!ctx || !ctx.cwd) missing.push('目录')
  if (!ctx || !ctx.at) missing.push('时刻')
  return { ready: missing.length === 0, missing }
}

/** 判一句话的语境：它指的是哪个现实环境。 */
export function judgeContext({ text = '', ctx = null } = {}) {
  const r = contextReady(ctx)
  if (!r.ready) {
    return {
      level: 'none',
      text: String(text || ''),
      why:
        '这句话的语境没有落点：说不清是哪个会话、哪个目录、哪一刻（缺 ' +
        r.missing.join('、') +
        '）。没有语境的字没有现实指代，按无意义算。',
    }
  }
  return {
    level: 'session',
    text: String(text || ''),
    ctx,
    why:
      '语境 = 会话 ' +
      ctx.id +
      '（目录 ' +
      ctx.cwd +
      '，' +
      ctx.at +
      '）。这句话只能在这个会话里读：它指的是这里出现过的东西，不是别处同名的那件。',
  }
}

export function renderContext(rec) {
  if (!rec) return '语境：这一步还没算（没有会话环境）。'
  if (rec.level === 'none') return '语境：**没有落点**——' + rec.why
  return (
    '语境：**' +
    rec.ctx.id +
    '**（' +
    rec.ctx.cwd +
    '，' +
    rec.ctx.at +
    '）\n' +
    '这句话只能在这个会话里读；换个会话，同一个词指的就不是同一件。' +
    (rec.text ? '\n这句话：' + rec.text.slice(0, 60) : '')
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
