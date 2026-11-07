/**
 * 自由时间 / 自由空间的几样实用工具共用的小函数。
 * 只读账、只算，不替谁做决定；写账仍旧走 free.mjs。
 */
import { addItem, readClock, localMinutes, isInQuiet, dndLabel, dayKeyOf } from './free.mjs'
import { planOf } from './plan.mjs'

const DAY = 1440

export function fmtClock(min) {
  const m = ((Math.round(Number(min) || 0) % DAY) + DAY) % DAY
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** 今天还剩下的空档，按「至少多久」筛。已经过去的整段不算。 */
export function gapsOf(state, now = Date.now(), { atLeast = 30 } = {}) {
  const p = planOf(state, now)
  const at = Math.max(5, Math.min(DAY, Number(atLeast) || 30))
  const list = p.blocks
    .filter((b) => b.kind === 'free' && b.minutes >= at && b.to > p.nowMin)
    .map((b) => ({ ...b, from: fmtClock(b.from), to: fmtClock(b.to), startsIn: Math.max(0, b.from - p.nowMin) }))
  return { list, plan: p }
}

export function renderGaps({ list, plan }, atLeast) {
  const head = `现在 ${fmtClock(plan.nowMin)}，今天 ≥${atLeast} 分钟的空档：`
  if (!list.length) return `${head}\n一段都没有。今天排得满，或者醒着的时间已经用完了。`
  const lines = list.map((b) => {
    const when = b.startsIn > 0 ? `还差 ${b.startsIn} 分钟` : '已经在这一段里'
    return `- ${b.from}–${b.to}（${b.minutes} 分钟，${when}）`
  })
  const total = list.reduce((n, b) => n + b.minutes, 0)
  return `${head}\n${lines.join('\n')}\n\n加起来 ${total} 分钟；排表用 free_add。`
}

/** 现在这一刻：在做事、在空档、还是已经该睡了。 */
export function nowOf(state, now = Date.now()) {
  const p = planOf(state, now)
  const at = p.nowMin
  const cur = p.blocks.find((b) => b.from <= at && at < b.to) || null
  const next = p.blocks.filter((b) => b.from > at).sort((a, b) => a.from - b.from)[0] || null
  const quiet = isInQuiet(state?.dnd, now)
  const late = at < p.wake || at >= p.sleep
  return { at, cur, next, quiet, late, plan: p, tz: state?.dnd?.timeZone }
}

export function renderNow(n) {
  const bits = []
  bits.push(`现在 ${fmtClock(n.at)}。`)
  if (n.quiet) bits.push(`安静时段（${dndLabel?.(n.plan?.dnd) || 'DND'}）——到点的事不丢，等出来再提。`)
  if (n.late) bits.push('这个点不在醒着的窗口里，算夜里。')
  if (n.cur && n.cur.kind === 'fixed') bits.push(`这一段在做：${n.cur.text}（到 ${fmtClock(n.cur.to)}）。`)
  else if (n.cur && n.cur.kind === 'free') bits.push(`这一段空着：${fmtClock(n.cur.from)}–${fmtClock(n.cur.to)}，${n.cur.to - n.at} 分钟剩。`)
  else bits.push('这一刻没有排着的事。')
  if (n.next) bits.push(`下一件：${fmtClock(n.next.from)} ${n.next.kind === 'fixed' ? n.next.text : '（空档结束）'}，还差 ${Math.max(0, n.next.from - n.at)} 分钟。`)
  return bits.join('')
}

/** 一页纸的今日简报：不列流水，只给能拿来做决定的那几行。 */
export function briefOf(state, now = Date.now()) {
  const p = planOf(state, now)
  const at = p.nowMin
  const next = p.blocks.filter((b) => b.from > at).sort((a, b) => a.from - b.from)[0] || null
  const freeLeft = p.blocks.filter((b) => b.kind === 'free' && b.to > at).reduce((n, b) => n + Math.max(0, b.to - Math.max(b.from, at)), 0)
  const fixed = p.blocks.filter((b) => b.kind === 'fixed')
  const done = fixed.filter((b) => b.doneToday).length
  const quiet = isInQuiet(state?.dnd, now)
  const lines = []
  lines.push(`今天 ${p.fixed} 件固定事，做完 ${done} 件；空着 ${Math.round(freeLeft)} 分钟，密度 ${Math.round(p.density * 100)}%。`)
  if (next) lines.push(`下一件 ${fmtClock(next.from)}：${next.kind === 'fixed' ? next.text : '空档结束'}（${Math.max(0, next.from - at)} 分钟后）。`)
  else lines.push('今天后面没有排着的事了。')
  if (p.conflicts.length) lines.push(`撞车 ${p.conflicts.length} 处：${p.conflicts.join('；')}。`)
  if (quiet) lines.push('现在在安静时段里。')
  const elastic = p.elastic.slice(0, 5)
  if (elastic.length) lines.push(`抽空能做的：${elastic.join('、')}${p.elastic.length > 5 ? ` 等 ${p.elastic.length} 件` : ''}`)
  return lines.join('\n')
}

/** 最近 N 天打勾：只报数，不排名、不算连续。 */
export function weekOf(state, now = Date.now(), days = 7) {
  const tz = state?.dnd?.timeZone
  const keys = []
  for (let i = 0; i < Math.max(1, Math.min(30, days)); i += 1) keys.push(dayKeyOf(now - i * 86400000, tz))
  const items = Array.isArray(state?.items) ? state.items : []
  const rows = []
  for (const it of items) {
    const done = Array.isArray(it?.doneDays) ? it.doneDays.filter((d) => keys.includes(d)) : []
    if (done.length) rows.push({ text: it.text, kind: it.kind, times: done.length })
  }
  rows.sort((a, b) => b.times - a.times)
  const totalDone = rows.reduce((n, r) => n + r.times, 0)
  const head = `最近 ${keys.length} 天：打勾 ${totalDone} 次，动过 ${rows.length} 件事。`
  if (!rows.length) return `${head}\n一件都没打勾。没做过不等于没排过，别拿这个当分。`
  return `${head}\n${rows.map((r) => `- ${r.text}（${r.kind === 'fixed' ? '固定' : '弹性'}，${r.times} 次）`).join('\n')}\n\n只是数，不是评价。`
}

/** 随想：不排表、不催，落在账旁边的一本手记里。 */
export function noteLine(text, now = Date.now()) {
  const d = new Date(now)
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `- ${stamp} ${String(text).trim()}`
}

/** 哪些「每天都要」的事今天还没落到单子上。 */
export function repeatDue(state, now = Date.now()) {
  const tz = state?.dnd?.timeZone
  const day = dayKeyOf(now, tz)
  const list = Array.isArray(state?.repeats) ? state.repeats : []
  return list.filter((r) => r && r.active !== false && !(Array.isArray(r.lastDays) && r.lastDays.includes(day)))
}

/**
 * 把今天该重复的几条真加进单子，并在重复项上记「今天已落过」。
 * 这一步会写账——它得真动手，不然「每天早饭」永远只停在愿望里。
 */
export function materializeRepeats(state, now = Date.now()) {
  const due = repeatDue(state, now)
  if (!due.length) return { state, added: [] }
  let next = state
  const added = []
  const tz = state?.dnd?.timeZone
  const day = dayKeyOf(now, tz)
  for (const r of due) {
    const res = addItem(next, { kind: r.kind === 'elastic' ? 'elastic' : 'fixed', text: r.text, at: r.at, minutes: r.minutes }, now)
    if (res.ok) {
      next = res.state
      added.push(res.item.text)
    }
    next = {
      ...next,
      repeats: (next.repeats || []).map((x) =>
        x && x.text === r.text && x.at === r.at ? { ...x, lastDays: [...(Array.isArray(x.lastDays) ? x.lastDays : []), day].slice(-14) } : x,
      ),
    }
  }
  return { state: next, added }
}

export { localMinutes, readClock }
