/**
 * 实时注入 —— 这一轮临时要摆进去的一段字。
 * ============================================================================
 * 跟「出场闸」的分工：
 *   - 出现.json  管**长期的**：谁这一轮出场、谁不出场，改一次管很久。
 *   - 实时注入.json 管**临时的**：这一轮要塞一句话进去，用完即撤。
 *
 * 为什么单列一份：出场闸是「关掉一整家」，实时注入是「往里加一段」。
 * 混在一个文件里，加一段就会连出场的名单一起改，改错了分不清是谁的账。
 *
 * 每条带 `turns`：还能活几轮。每轮 assemble 完减一，减到 0 自动撤掉。
 * 所以它是**会自己过期的**——不靠谁记着来删。
 * ============================================================================
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const LIVE_FILE = '实时注入.json'

/** 一次最多塞多少字：写长了就把饭碗挤爆，超过就截。 */
export const MAX_CHARS = 1200

export function emptyLive() {
  return { items: [] }
}

export function normalizeLive(raw) {
  const out = emptyLive()
  const src = raw && typeof raw === 'object' ? raw : {}
  const items = Array.isArray(src.items) ? src.items : []
  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const text = String(it.text || '').trim()
    if (!text) continue
    const turns = Number.isFinite(Number(it.turns)) ? Math.max(0, Math.floor(Number(it.turns))) : 1
    out.items.push({
      text: text.slice(0, MAX_CHARS),
      turns,
      at: String(it.at || ''),
      from: String(it.from || ''),
    })
  }
  return out
}

export function readLive(p) {
  if (!existsSync(p)) return emptyLive()
  try {
    return normalizeLive(JSON.parse(readFileSync(p, 'utf8')))
  } catch {
    return emptyLive()
  }
}

export function writeLive(p, state) {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(normalizeLive(state), null, 2) + '\n', 'utf8')
}

/** 加一条。turns 默认 1：只进下一轮。 */
export function addLive(state, { text, turns = 1, from = '' } = {}) {
  const s = normalizeLive(state)
  const body = String(text || '').trim()
  if (!body) return s
  s.items.push({
    text: body.slice(0, MAX_CHARS),
    turns: Math.max(1, Math.floor(Number(turns) || 1)),
    at: new Date().toISOString(),
    from: String(from || ''),
  })
  return s
}

/**
 * 一条活多久：`turns` 不是「几轮」，是「几个时间窗」。
 * 一个窗 = WINDOW_MS（30 分钟）。为什么不按轮算：一轮里 assemble 会被调好几次，
 * 按轮减会在同一轮里减好几次——那样写 `1` 就等于「立刻过期」。
 * 按时间算，读多少次都只算一次，也不会因为谁忘了删就永远赖着。
 */
export const WINDOW_MS = 30 * 60 * 1000

function alive(it) {
  if (!it || it.turns <= 0) return false
  const at = Date.parse(it.at)
  if (!Number.isFinite(at)) return true
  return Date.now() - at < it.turns * WINDOW_MS
}

/** 渲染成要摆进上下文的字。空的就返回空串——空的段落不占地方。 */
export function renderLive(state) {
  const s = normalizeLive(state)
  const live = s.items.filter(alive)
  if (!live.length) return ''
  const lines = ['## 实时注入（这一轮临时摆进来的）', '']
  for (const it of live) {
    lines.push(`- ${it.text}`)
  }
  lines.push('')
  lines.push('（这段是临时摆的，会自己过期。它不算记忆，也不算人格，说完就撤。）')
  return lines.join('\n')
}

/**
 * 过一轮：每条 turns 减一，减到 0 就删。
 * 返回 { state, dropped }，dropped 是这一轮撤掉的那几条——好写进账里。
 */
export function tickLive(state) {
  const s = normalizeLive(state)
  const keep = []
  const dropped = []
  for (const it of s.items) {
    const next = it.turns - 1
    if (next > 0) keep.push({ ...it, turns: next })
    else dropped.push(it)
  }
  return { state: { items: keep }, dropped }
}

export function clearLive() {
  return emptyLive()
}

export function livePathOf(cfg) {
  const ws = cfg.workspace || process.cwd()
  return join(ws, cfg.stateDir || '.persona-framework', LIVE_FILE)
}
