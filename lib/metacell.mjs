/**
 * 四层第一层 · 元胞
 *
 * 它只干一件事：**给一条东西归类。**
 *
 * 归四样：
 *   从哪来（source）—— 决定它算不算缺口
 *   是什么（kind）—— 愿望／代价／都不是
 *   多硬（hard）—— 硬缺口先来
 *   归谁（owner）—— 这一件该谁做
 *
 * **判据只按「来源」和「带没带料」，不按语感。**
 *   「像不像愿望」会飘；「有没有 want 和 cost」不飘。
 *
 * **不给人格字。** 归完只落标签，标签给下一层用，不给它看。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

/* ── 元胞账：它判过的每一条，都得留得下来 ──
 *
 * **为什么要有这本账**：
 *   调节层要能「翻回来改」。没有账，它连自己判过什么都不知道，
 *   只能从头再判一遍——那是重算，不是复审。
 *
 * 一条一个键（用原话），记：从哪来、是什么、多硬、归谁、判的什么结果、判了几次。
 * **不改事实，只记判断。** 事实在原来的地方。
 */
export function cellFile(ws) {
  return join(String(ws || process.cwd()), '.persona-framework', '元胞账.json')
}

export function openCellBook(ws) {
  const f = cellFile(ws)
  let v = {}
  try { v = JSON.parse(readFileSync(f, 'utf8')) } catch { /* 头一次，空的 */ }
  return { _f: f, _dirty: false, rows: (v && typeof v === 'object' && !Array.isArray(v)) ? v : {} }
}

export function saveCellBook(book) {
  if (!book?._dirty) return 0
  const d = dirname(book._f)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  writeFileSync(book._f, JSON.stringify(book.rows, null, 2), 'utf8')
  book._dirty = false
  return 1
}

/** 一条的键：有 what 用 what，没有用原话。**没有键就不进账。** */
export function cellKey(item) {
  if (!item || typeof item !== 'object') return ''
  const w = typeof item.what === 'string' ? item.what.trim() : ''
  if (w) return w.slice(0, 80)
  const s = typeof item.said === 'string' ? item.said.trim() : ''
  if (s) return s.slice(0, 80)
  const t = typeof item.todo === 'string' ? item.todo.trim() : ''
  if (t) return t.slice(0, 80)
  return ''
}

/**
 * 调节层改一条判定。
 * **只改判定，不改事实**；改过的留 `why` 和 `at`，下一轮元胞先读它。
 */
export function setOverride(book, key, patch, why) {
  const k = String(key || '').trim()
  if (!k) return { ok: false, reason: 'no-key' }
  const p = (patch && typeof patch === 'object') ? patch : {}
  const allow = ['from', 'kind', 'hard', 'owner', 'ok']
  const next = {}
  for (const f of allow) {
    if (p[f] !== undefined) next[f] = f === 'hard' || f === 'ok' ? Boolean(p[f]) : String(p[f])
  }
  if (!Object.keys(next).length) return { ok: false, reason: 'nothing-to-change' }
  if (!book.rows[k]) book.rows[k] = { n: 0 }
  book.rows[k].override = { ...next, why: String(why || '').slice(0, 160), at: new Date().toISOString() }
  book._dirty = true
  return { ok: true, changed: next }
}

/** 取一条的改判；没改过就是 null。 */
export function overrideFor(book, key) {
  return book?.rows?.[key]?.override || null
}

/** 从哪来 —— 有由头的三种，和没由头的两种。 */
export const FROM = {
  SAID: '人刚开口',      // 这一轮的现实就是那句话
  LEDGER: '自己记下的',   // 台账、收件箱、队列里躺着的
  LINE: '自己定的线到了', // 假设撞够次数
  CLASH: '两条打架',      // 记忆撞车，得判
  THINK: '凭空想起的',    // 没由头——不算缺口
}

/** 是什么 */
export const KIND = {
  WANT: '愿望',
  COST: '代价',
  EVENT: '事情',
  WHAT: '说不清',
}

/**
 * 归一条。
 *
 * `item` 可能是：
 *   { said: '…' }                    人刚说的一句
 *   { todo: '…' }                    台账里一条
 *   { threshold: ['名', {now, at}] } 撞到线了
 *   { clash: '…' }                   撞车
 *   { inbox: n } / { queue: n }      攒着的
 *
 * 返回 `{ from, kind, hard, owner, ok }`。
 * **`ok: false` 的唯一理由是「没由头」** —— 那就不是缺口。
 */
export function classify(item, overrides) {
  // **先查有没有被改判过。** 改判优先级最高——那是调节层动过手的地方。
  if (overrides) {
    const k = cellKey(item)
    // **只认 override，不认整行。**
    // 账本里的行是「元胞上轮判了什么」，不是「这一轮该判什么」；
    // 拿整行当改判表，旧判定会永远盖掉新判定，元胞就再也不会变。
    const o = k && overrides[k] && overrides[k].override
    if (o) {
      const base = classifyRaw(item)
      return { ...base, ...o, overridden: true }
    }
  }
  return classifyRaw(item, overrides)
}

function classifyRaw(item) {
  if (!item || typeof item !== 'object') {
    return { from: FROM.THINK, kind: KIND.WHAT, hard: false, owner: '', ok: false }
  }

  // ── 从哪来：只认这几种「有出处」的 ──
  let from = FROM.THINK
  let hard = false
  let owner = ''

  if (item.said) {
    from = FROM.SAID
    hard = false
    owner = '它自己回应'
  } else if (item.todo) {
    from = FROM.LEDGER
    hard = true
    owner = '把它办掉'
  } else if (item.threshold) {
    from = FROM.LINE
    hard = true
    owner = '到线了，动手'
  } else if (item.clash) {
    from = FROM.CLASH
    hard = false
    owner = '判它属于哪边'
  } else if (item.inbox || item.queue) {
    from = FROM.LEDGER
    hard = false
    owner = '挑一条处理'
  }

  // ── 是什么：**看带没带 want / cost**，不看像不像 ──
  //
  // 带了两样：这是一件「有价的事」
  // 只带 want：愿望，还没价
  // 只带 cost：代价，还不知道换什么
  // 都没带：只是一句话，不算愿望也不算代价
  let kind = KIND.WHAT
  const hasWant = item.want !== undefined && item.want !== null && String(item.want).trim() !== ''
  const hasCost = item.cost !== undefined && item.cost !== null && String(item.cost).trim() !== ''
  if (hasWant && hasCost) kind = KIND.EVENT
  else if (hasWant) kind = KIND.WANT
  else if (hasCost) kind = KIND.COST
  else if (item.said || item.todo) kind = KIND.WHAT

  // ── 有没有由头：**没出处就不是缺口** ──
  const ok = from !== FROM.THINK

  return { from, kind, hard, owner, ok }
}

/**
 * 一批归完。**只留 ok 的** —— 没由头的直接不进下一层。
 *
 * 返回 `{ kept, dropped }`：kept 是有由头的，dropped 是被挡下的（**留着看，不是删**）。
 */
export function classifyAll(items = [], book) {
  const kept = []
  const dropped = []
  for (const it of items) {
    const k = cellKey(it)
    // 改判表直接从账本里取——**一处写，一处读**，不另存一份
    const overrides = book ? book.rows : null
    const c = classify(it, overrides)
    const row = { ...it, _cell: c }

    // ── 落账：判过的记下来，下一轮翻得到 ──
    if (book && k) {
      const prev = book.rows[k] || {}
      const changed = prev.override && prev.override.at ? prev.override : null

      // ── 存疑：**元胞自己判得前后不一样，就是可能错了** ──
      //
      // 这不是感觉，是四条可判定的：
      //   一、同一条，这轮判的类和上轮不一样
      //   二、判成了「说不清」（它自己没判出来）
      //   三、改过又被撤，撤了又改（反复）
      //
      // **存疑不改判定**——只把它挑出来给调节层看。改不改，是调节层的事。
      let suspect = prev.suspect || null
      if (!changed && prev.kind && prev.kind !== c.kind) {
        suspect = { why: '前后判得不一样', was: prev.kind, now: c.kind, at: new Date().toISOString() }
      } else if (c.kind === KIND.WHAT && !suspect) {
        suspect = { why: '没判出来（说不清）', was: '', now: c.kind, at: new Date().toISOString() }
      }
      if (prev.droppedTo && changed) {
        suspect = { why: '改过又撤、撤了又改（反复）', was: '', now: c.kind, at: new Date().toISOString() }
      }

      // **改判过的照着改判记，不改回去**；没改判的照这一轮的正记
      book.rows[k] = {
        n: (prev.n || 0) + 1,
        from: changed ? prev.from : c.from,
        kind: changed ? prev.kind : c.kind,
        hard: changed ? prev.hard : c.hard,
        owner: changed ? prev.owner : c.owner,
        ok: changed ? prev.ok : c.ok,
        at: new Date().toISOString(),
        ...(changed ? { override: changed } : {}),
        ...(suspect ? { suspect } : {}),
      }
      book._dirty = true
    }

    if (c.ok) kept.push(row)
    else dropped.push(row)
  }
  return { kept, dropped }
}

/**
 * 这一轮要不要过元胞。
 *
 * **按「离人格多远」分流，不是按比例抽**：
 *   远的（从哪来）—— 可以省
 *   近的（愿望还是代价）—— 不许省
 *
 * 返回 true = 要过；false = 可以省。
 */
export function mustClassify(item) {
  // 带了 want 或 cost 的，就是「离人格近」—— 必过
  const hasW = item?.want !== undefined && item?.want !== null && String(item.want).trim() !== ''
  const hasC = item?.cost !== undefined && item?.cost !== null && String(item.cost).trim() !== ''
  if (hasW || hasC) return true
  // 别的（纯来源判定）可以省
  return false
}
