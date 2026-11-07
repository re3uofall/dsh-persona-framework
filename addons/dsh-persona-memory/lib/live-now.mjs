/**
 * 即时记忆的**实时**来源：直接读这一步进入模型的消息，不等流水导入。
 *
 * 为什么要有它：
 *   原来「即时记忆库」读的是 `persona-ai/knowledge/session/YYYY-MM-DD.md`，
 *   那是 python 每 30 分钟从会话日志导一次的**副本**。导之前，刚说的话不在盘上，
 *   于是这一格就空着——明明话还在手上，却要等一个外部脚本。
 *   用户原话（2026-11-07）：「实时导入！！！」
 *
 * 怎么拿：
 *   `agent/pre-step` 的 `payload.messages` 就是**这一步真正要发出去的那串消息**（一手）。
 *   在这里留一份，注入时用它渲染；拿不到才退回读盘上的 md。
 *
 * 边界：
 *   - 只存最近这一份，不落盘、不累积（它是「此刻」，不是账）。
 *   - 只认 role 为 user / assistant 的；工具结果、系统段一律跳过。
 *   - 超过 maxChars 从**末尾**往前留——最近的话最重要。
 */

const MAX_TURNS = 400
const MAX_CHARS = 20000

let cache = { at: 0, msgs: [] }

/** 从一条消息里抽纯文本（content 可能是字符串，也可能是块数组）。 */
function textOf(msg) {
  const c = msg?.content
  if (typeof c === 'string') return c.trim()
  if (!Array.isArray(c)) return ''
  const parts = []
  for (const b of c) {
    if (!b) continue
    if (typeof b === 'string') { parts.push(b); continue }
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
    // 别把 tool_use / tool_result / image 塞进来：那不是「说了什么」
  }
  return parts.join('\n').trim()
}

/** pre-step 每步调一次：把这一份消息记下来（覆盖，不追加）。 */
export function noteLiveMessages(payload) {
  try {
    const msgs = payload?.messages
    if (!Array.isArray(msgs) || !msgs.length) return
    cache = { at: Date.now(), msgs }
  } catch {
    /* 拿不到就当没有：退回读盘 */
  }
}

/**
 * 渲染成「师父：…／她：…」的逐字对话。
 * 返回 { text, turns, at } —— text 为空表示这一步没有可用的话。
 */
export function liveNowText(opts = {}) {
  const maxChars = Number(opts.maxChars ?? MAX_CHARS)
  const msgs = Array.isArray(cache.msgs) ? cache.msgs : []
  if (!msgs.length) return { text: '', turns: 0, at: 0 }

  const picks = []
  for (const m of msgs) {
    if (!m) continue
    const role = m.role
    if (role !== 'user' && role !== 'assistant') continue
    const t = textOf(m)
    if (!t) continue
    picks.push({ role, text: t })
  }
  if (!picks.length) return { text: '', turns: 0, at: cache.at }

  // 从末尾往前留：最近的话最重要，砍就从最早的砍
  const kept = []
  let used = 0
  for (let i = picks.length - 1; i >= 0; i--) {
    const p = picks[i]
    const cost = p.text.length + 8
    if (kept.length && used + cost > maxChars) break
    kept.unshift(p)
    used += cost
    if (kept.length >= MAX_TURNS) break
  }

  const lines = []
  for (const p of kept) {
    const who = p.role === 'user' ? '师父' : '她'
    lines.push(`${who}：${p.text}`, '')
  }
  return { text: lines.join('\n').trim(), turns: kept.length, at: cache.at }
}

/** 只给诊断用：这一份什么时候记下的、几条。 */
export function liveNowState() {
  return { at: cache.at, count: Array.isArray(cache.msgs) ? cache.msgs.length : 0 }
}
