/**
 * 探索的触发器：不是只有「每天 10:30 响一次」。
 * ============================================================================
 * 判据（UPDATE.md）：触发器是「没人喊的时候，它凭什么跑」。
 * 所以每一条都必须自己调用、自己落盘——只给一句话不算。
 *
 * 五类，各有自己的条件与冷却：
 *   daily      定时   到点响（宿主闹钟，不在这个文件里）
 *   event      事件   刚 keep 完，且队列空了 → 该补方向了
 *   threshold  阈值   连续 N 天 0 条 → 出问题了
 *   stale      阈值   队列里最早一条超过 N 天没动 → 排了不做
 *   dice       骰子   每轮小概率自己出门
 *
 * 落盘：explore/触发账.jsonl，一行一次，写清「哪条、为什么、证据」。
 * ============================================================================
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULTS = {
  dir: 'explore',
  ledger: '触发账.jsonl',
  dryDays: 3,          // 连续这么多天一条没记，算断粮
  staleDays: 14,       // 队列里最早一条超过这么多天没动，算排了不做
  diceChance: 0.08,    // 每轮掷一次
  cooldownMin: 240,    // 同一条触发器的冷却
  counterWindow: 5,    // 最近几条里看有没有反例类
}

export const TRIGGERS = [
  { id: 'event-queue-empty', kind: 'event', label: '事件：keep 完队列空', why: '刚留下一条，队列却空了——下趟没方向，该补一条。' },
  { id: 'threshold-dry', kind: 'threshold', label: '阈值：连续几天 0 条', why: '连着几天一条没记：要么问题是假的，要么标准太高。' },
  { id: 'threshold-stale', kind: 'threshold', label: '阈值：队列放着没动', why: '队列里最早那条放了很久没动——排了不做，等于没排。' },
  { id: 'dice', kind: 'dice', label: '骰子：自己出门', why: '没到点也可能想出去一趟；掷到了就走。' },
]

const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim()

export function ledgerPath(rootDir, opts = {}) {
  const o = { ...DEFAULTS, ...(opts || {}) }
  return join(rootDir, String(o.dir || DEFAULTS.dir), String(o.ledger || DEFAULTS.ledger))
}

export function readFires(rootDir, opts = {}, n = 10) {
  try {
    const file = ledgerPath(rootDir, opts)
    if (!existsSync(file)) return []
    const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean)
    const out = []
    for (const line of rows.slice(-n)) {
      try { out.push(JSON.parse(line)) } catch { /* 坏一行不挡整本 */ }
    }
    return out
  } catch {
    return []
  }
}

/** 一次触发落一行；没有触发就什么都不写（空账比假账好）。 */
export function appendFires(rootDir, fires, opts = {}) {
  const list = Array.isArray(fires) ? fires.filter(Boolean) : []
  if (list.length === 0) return { written: 0 }
  const file = ledgerPath(rootDir, opts)
  try {
    mkdirSync(join(rootDir, String((opts && opts.dir) || DEFAULTS.dir)), { recursive: true })
  } catch { /* 目录在就算了 */ }
  let written = 0
  for (const f of list) {
    try {
      appendFileSync(file, JSON.stringify(f) + '\n', 'utf8')
      written += 1
    } catch { /* 一条写不进不挡别的 */ }
  }
  return { written, file }
}

const daysBetween = (a, b) => {
  const t1 = Date.parse(a)
  const t2 = Date.parse(b)
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null
  return (t2 - t1) / 86_400_000
}

/**
 * 算这一轮有哪几条该响。
 * 入参都是盘上真读出来的东西，不猜：
 *   state      explore/state.json
 *   queue      队列数组（每项 {topic, added}）
 *   keepDates  最近留下的日期串（YYYY-MM-DD），按时间序
 *   today      今天记了几条
 *   todayDate  今天的日期串
 *   justKept   这一轮是不是刚 keep
 */
export function evaluate(input = {}, opts = {}, now = Date.now()) {
  const o = { ...DEFAULTS, ...(opts || {}) }
  const at = new Date(now).toISOString()
  const fires = []
  const lastBy = (input.state && input.state.lastTrigger) || {}
  const coolEnough = (id) => {
    const last = lastBy[id]
    if (!last) return true
    const d = daysBetween(last, at)
    return d === null ? true : d * 1440 >= Number(o.cooldownMin || 0)
  }
  const push = (id, why, evidence) => {
    const def = TRIGGERS.find((x) => x.id === id)
    if (!def) return
    if (!coolEnough(id)) return
    fires.push({ at, id, kind: def.kind, why: norm(why) || def.why, evidence: evidence || '' })
  }

  const queue = Array.isArray(input.queue) ? input.queue : []
  const keepDates = Array.isArray(input.keepDates) ? input.keepDates : []

  // 事件：刚留下一条，队列空了
  if (input.justKept && queue.length === 0) {
    push('event-queue-empty', '刚留完一条，队列空了：下趟没方向。', 'queue=0')
  }

  // 阈值：连续 dryDays 天一条没记
  if (keepDates.length > 0 && input.todayDate) {
    const last = keepDates[keepDates.length - 1]
    const gap = daysBetween(last, input.todayDate)
    if (gap !== null && gap >= Number(o.dryDays)) {
      push('threshold-dry', `上次留下是 ${last}，到今天 ${Math.floor(gap)} 天没记。`, `last=${last} today=${input.todayDate}`)
    }
  }

  // 阈值：队列最早一条放了太久
  if (queue.length > 0 && input.todayDate) {
    const oldest = queue
      .map((t) => ({ topic: t.topic, added: t.added }))
      .filter((t) => t.added)
      .sort((a, b) => String(a.added).localeCompare(String(b.added)))[0]
    if (oldest) {
      const gap = daysBetween(oldest.added, input.todayDate)
      if (gap !== null && gap >= Number(o.staleDays)) {
        push('threshold-stale', `「${oldest.topic}」排了 ${Math.floor(gap)} 天没动。`, `oldest=${oldest.added}`)
      }
    }
  }

  // 骰子：每轮掷一次
  if (Math.random() < Number(o.diceChance)) {
    push('dice', `掷到了（每次 ${Math.round(Number(o.diceChance) * 100)}%）。`, `at=${at}`)
  }

  return fires
}

/** 把这一轮的触发并进 state，冷却才算真的生效。 */
export function mergeState(state, fires, now = Date.now()) {
  const s = { ...(state || {}) }
  const last = { ...((s.lastTrigger) || {}) }
  const at = new Date(now).toISOString()
  for (const f of fires || []) last[f.id] = at
  s.lastTrigger = last
  return s
}

/** 一行给人看：这一轮响了几条、各为什么。 */
export function renderFires(fires) {
  if (!Array.isArray(fires) || fires.length === 0) return '这一轮没有触发器响。'
  return ['这一轮响了：'].concat(fires.map((f) => `- ${f.id}：${f.why}（${f.evidence}）`)).join('\n')
}
