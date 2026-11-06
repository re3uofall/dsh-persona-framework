// dsh-persona-energy · token 账
// ============================================================================
// 抄来的口径（`@sligqoer/dsh-usage-stats` 0.2.8 的 `scanSessionEvents`）：
//   token 数不在别处，就在会话事件流里 `assistant/message` 的 `data.usage`：
//     { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens }
//   模型在 `data.message.source.{provider, model}`。
// 读法：`ctx.get('sessionQuery').listSessions()` → `readSession(id)` → `events`。
//
// 一条要紧的观察（2026-11-06 本会话实测最后一条）：
//   input 335 / output 347 / cacheRead 214016 / cacheWrite 0 / total 214698
// 也就是说**注入的三万字基本走缓存读**，不是每步都重新付一遍。
// 所以「省 token」的真靶子不是把话说短，是这三样：
//   ① 少让前缀变（变一次 = 一次 cacheWrite + 后面全重新读）
//   ② 少新增长内容（新工具结果、新文件全文）
//   ③ 该堆的时候堆——判断、认错、安全，那些不许为省而砍。
// ============================================================================

/** 只认这几个字段，其余不管。坏了就当 0，不猜。 */
const num = (v) => (Number.isFinite(v) && v > 0 ? v : 0)

/** 从一条 assistant/message 取出 usage 与模型名。 */
export function usageOfEvent(ev) {
  if (!ev || ev.type !== 'assistant/message') return null
  const d = ev.data || {}
  const u = d.usage
  if (!u) return null
  const src = (d.message && d.message.source) || {}
  const provider = src.provider ? String(src.provider) : 'unknown'
  const model = src.model ? String(src.model) : 'unknown'
  const input = num(u.inputTokens)
  const output = num(u.outputTokens)
  const cacheRead = num(u.cacheReadTokens)
  const cacheWrite = num(u.cacheWriteTokens)
  const total = num(u.totalTokens) || input + output + cacheRead + cacheWrite
  return {
    at: Number.isFinite(ev.time) ? ev.time : 0,
    turn: Number.isFinite(d.turn) ? d.turn : null,
    step: Number.isFinite(d.step) ? d.step : null,
    provider,
    model,
    input,
    output,
    cacheRead,
    cacheWrite,
    total,
    // 真正新付的：输入 + 输出。缓存读单独看，缓存写算「让前缀变了」的代价。
    fresh: input + output,
  }
}

/** 把一串事件聚成一本账。`since` 是毫秒时间戳，0 = 全量。 */
export function summarizeUsage(events, opts = {}) {
  const since = Number(opts.since) > 0 ? Number(opts.since) : 0
  const rows = []
  for (const ev of Array.isArray(events) ? events : []) {
    const u = usageOfEvent(ev)
    if (!u) continue
    if (since && u.at && u.at < since) continue
    rows.push(u)
  }
  rows.sort((a, b) => a.at - b.at)

  const sum = { messages: rows.length, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, fresh: 0 }
  const models = new Map()
  let turns = 0
  let lastTurn = null
  for (const r of rows) {
    sum.input += r.input
    sum.output += r.output
    sum.cacheRead += r.cacheRead
    sum.cacheWrite += r.cacheWrite
    sum.total += r.total
    sum.fresh += r.fresh
    const k = `${r.provider}/${r.model}`
    const m = models.get(k) || { key: k, messages: 0, total: 0, fresh: 0 }
    m.messages += 1
    m.total += r.total
    m.fresh += r.fresh
    models.set(k, m)
    if (r.turn !== null && r.turn !== lastTurn) {
      turns += 1
      lastTurn = r.turn
    }
  }

  const denom = sum.fresh + sum.cacheRead
  const cacheHitRate = denom > 0 ? sum.cacheRead / denom : 0
  const avgPerMessage = sum.messages ? Math.round(sum.total / sum.messages) : 0
  const avgPerTurn = turns ? Math.round(sum.total / turns) : 0

  return {
    ...sum,
    turns,
    cacheHitRate,
    avgPerMessage,
    avgPerTurn,
    models: [...models.values()].sort((a, b) => b.total - a.total),
    last: rows.length ? rows[rows.length - 1] : null,
    first: rows.length ? rows[0] : null,
  }
}

export const fmtTokens = (n) => {
  const v = Number(n) || 0
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`
  return String(Math.round(v))
}

export const fmtPct01 = (n) => `${Math.round((Number(n) || 0) * 100)}%`

/** 一句话读数，给工具返回的最上面用。 */
export function headline(sum) {
  if (!sum || !sum.messages) return '账还是空的：这一段时间里没有一条带 usage 的助手消息。'
  return [
    `${sum.messages} 条消息 / ${sum.turns} 轮，合计 ${fmtTokens(sum.total)} token`,
    `- 新付的（输入+输出）${fmtTokens(sum.fresh)}`,
    `- 缓存读 ${fmtTokens(sum.cacheRead)}（占 ${fmtPct01(sum.cacheHitRate)}）`,
    `- 缓存写 ${fmtTokens(sum.cacheWrite)}——这一项是「让前缀变了」的代价，越大说明注入被改得越勤`,
    `- 平均每条 ${fmtTokens(sum.avgPerMessage)}，每轮 ${fmtTokens(sum.avgPerTurn)}`,
  ]
}

/**
 * 什么时候**不许**为省 token 砍。这不是机制，是判据；机制可以改，判据不许绕。
 * 返回命中的理由，空数组 = 现在可以省。
 */
export const NEVER_SKIMP = [
  { key: 'truth', when: '要说清一件事的真相、出处、谁说过什么', why: '砍掉的是证据，省下来的是错' },
  { key: 'retract', when: '认错、改口、收回一句说过的话', why: '砍掉的是认账那一步，留下的是空话' },
  { key: 'danger', when: '安全、不可逆动作、删改别人的东西', why: '这一步贵在停一下，不贵在字多' },
  { key: 'hurt', when: '对面在痛、在气、在等一句实话', why: '砍成摘要就是把人当成配额' },
  { key: 'decide', when: '要下判断、要给取舍、要说「我不干」', why: '判断的价值在说清理由，理由一省就变成命令' },
]

export function skimpVerdict(flags) {
  const on = new Set(Array.isArray(flags) ? flags.map(String) : [])
  const hit = NEVER_SKIMP.filter((r) => on.has(r.key))
  if (!hit.length) return { canSkimp: true, hit: [] }
  return { canSkimp: false, hit }
}
