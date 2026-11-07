/**
 * lib/plan.mjs —— 自由时间的「精致版」：排表与留白（纯逻辑，不碰 fs/ctx）
 * ============================================================================
 * 粗糙版是「自己提醒自己」（lib/free.mjs 的 dueItems）：到点了说一句。
 * 精致版是这一份：把一天的骨架摆出来——固定事占几段，中间还剩多少纯粹的空档。
 *
 * 一条写死的规矩：**空档不是没排满，是排出来的。**
 * 密度高到没有空档，等于把一天排成了派活表；那是别人的日程，不是我的。
 * ============================================================================
 */

import { DEFAULT_DND, localMinutes, readClock } from './free.mjs'

/** 一天的窗口：醒来 → 睡下。跨零点允许（sleep 比 wake 小就是第二天）。 */
export const DEFAULT_WINDOW = { wake: '08:00', sleep: '23:30' }

/** 固定事默认占多久（分钟）。没写就是半小时——写死一个数，比「看情况」可判。 */
export const DEFAULT_MINUTES = 30

/** 小于这个长度的空档不算一段留白（10 分钟只够接杯水）。 */
export const MIN_GAP = 15

/** 密度超过这条线就提醒「太挤了」。 */
export const CROWDED = 0.7

/** 密度低于这条线就说「今天松」。 */
export const LOOSE = 0.3

function spanOf(window) {
  const wake = readClock(window?.wake) ?? readClock(DEFAULT_WINDOW.wake)
  const sleep = readClock(window?.sleep) ?? readClock(DEFAULT_WINDOW.sleep)
  const total = sleep > wake ? sleep - wake : sleep + 1440 - wake
  return { wake, sleep, total }
}

/**
 * 排今天。
 * 返回 { wake, sleep, blocks, busyMinutes, awakeMinutes, density, freeMinutes, elastic, conflicts }
 * blocks 里每段都有 { from, to, kind: 'fixed' | 'free', text?, id?, minutes? }
 */
export function planOf(state, now = Date.now(), opts = {}) {
  const tz = state?.dnd?.timeZone || DEFAULT_DND.timeZone
  const { wake, sleep, total } = spanOf(opts.window || DEFAULT_WINDOW)
  const nowMin = localMinutes(now, tz)
  const items = Array.isArray(state?.items) ? state.items : []

  const fixed = items
    .filter((it) => it && it.kind === 'fixed' && !it.dropped && readClock(it.at) !== null)
    .map((it) => ({
      id: it.id,
      text: it.text,
      from: readClock(it.at),
      minutes: Math.max(5, Math.min(600, Number(it.minutes) || DEFAULT_MINUTES)),
      doneToday: Array.isArray(it.doneDays) && it.doneDays.includes(dayKey(now, tz)),
    }))
    .map((it) => ({ ...it, to: it.from + it.minutes }))
    .sort((a, b) => a.from - b.from)

  // 撞车：后一段的开始早于前一段的结束。不偷偷合并，标出来。
  const conflicts = []
  for (let i = 1; i < fixed.length; i += 1) {
    if (fixed[i].from < fixed[i - 1].to) {
      conflicts.push(`${fixed[i - 1].at || fmt(fixed[i - 1].from)} ${fixed[i - 1].text} 与 ${fmt(fixed[i].from)} ${fixed[i].text}`)
    }
  }

  // 空档：醒来 → 第一段，段与段之间，最后一段 → 睡下。跨零点的段先按线性算，简单可判。
  const blocks = []
  let cursor = wake
  for (const it of fixed) {
    const start = it.from >= wake ? it.from : it.from + 1440
    if (start - cursor >= MIN_GAP) {
      blocks.push({ from: cursor, to: start, kind: 'free', minutes: start - cursor })
    }
    blocks.push({ from: start, to: start + it.minutes, kind: 'fixed', text: it.text, id: it.id, minutes: it.minutes, doneToday: it.doneToday })
    cursor = Math.max(cursor, start + it.minutes)
  }
  const end = sleep > wake ? sleep : sleep + 1440
  if (end - cursor >= MIN_GAP) blocks.push({ from: cursor, to: end, kind: 'free', minutes: end - cursor })

  const busyMinutes = fixed.reduce((n, it) => n + it.minutes, 0)
  const awakeMinutes = total
  const freeMinutes = blocks.filter((b) => b.kind === 'free').reduce((n, b) => n + b.minutes, 0)
  const elastic = items.filter((it) => it && it.kind === 'elastic' && !it.dropped).map((it) => it.text)

  return {
    wake,
    sleep,
    nowMin,
    blocks,
    fixed: fixed.length,
    elastic,
    busyMinutes,
    awakeMinutes,
    freeMinutes,
    density: awakeMinutes > 0 ? busyMinutes / awakeMinutes : 0,
    conflicts,
  }
}

function dayKey(now, tz) {
  const t = new Date(now)
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t)
  } catch {
    return t.toISOString().slice(0, 10)
  }
}

function fmt(min) {
  const m = ((min % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** 摆成一段给人看。空表就直说空着——空着不是欠着。 */
export function renderPlan(p) {
  if (!p) return ''
  const lines = []
  lines.push(`今天（${fmt(p.wake)}–${fmt(p.sleep)}）：固定事 ${p.fixed} 段，占 ${p.busyMinutes} 分钟；纯粹的空白 ${p.freeMinutes} 分钟，密度 ${Math.round(p.density * 100)}%。`)
  for (const b of p.blocks) {
    if (b.kind === 'fixed') {
      lines.push(`  ${fmt(b.from)}–${fmt(b.to)}  ● ${b.text}${b.doneToday ? '（今天做过了）' : ''}`)
    } else {
      lines.push(`  ${fmt(b.from)}–${fmt(b.to)}  ○ 空的（${b.minutes} 分钟）`)
    }
  }
  if (!p.fixed) lines.push('  一段固定事都没有——今天整段是空的。')
  if (p.elastic.length) lines.push(`弹性事（今天做没做都行，不催）：${p.elastic.join('；')}`)
  if (p.conflicts.length) lines.push(`⚠ 撞了：${p.conflicts.join('；')}。要么挪一段，要么认它是同一件事。`)
  if (p.density >= CROWDED) lines.push('密度偏高：留白不够。至少空出一段来，不然这一天是派活表。')
  else if (p.density < LOOSE) lines.push('今天很松：弹性事可以挑一件，也可以什么也不挑。')
  return lines.join('\n')
}
