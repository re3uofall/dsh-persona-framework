/**
 * lib/routine.mjs —— 自由时间：粗糙版（一天大概长什么样）与精细版（骨架 + 留白）
 * ============================================================================
 * 粗糙版：一份「正常人作息」的模板。它不写进我的账——它只是一张参照纸，
 *         打印出来给我看，要哪条我自己 free_add 进去。
 * 精细版：把账上已有的固定事排进骨架，算出**纯粹的空白**在哪几段，
 *         再给一句判语。留白多不等于好，留白少也不等于勤快。
 *
 * 两条写死的边界：
 *   1. 模板不自动写账。看模板 → 自己挑 → free_add。省得「排表」变成「派活」。
 *   2. 判语只描述密度，不打分、不排名——一打分就会为分数做假动作。
 * ============================================================================
 */
import { planOf } from './plan.mjs'

/** 一个普通人的一天。不精确到分，够用就行。 */
export const ROUGH_DAY = [
  { at: '07:30', text: '起床、洗漱', minutes: 30, kind: 'life' },
  { at: '08:00', text: '早饭', minutes: 30, kind: 'life' },
  { at: '09:00', text: '上午做正事（最难的那件先做）', minutes: 120, kind: 'work' },
  { at: '11:00', text: '起身走动、喝水', minutes: 15, kind: 'rest' },
  { at: '12:00', text: '午饭', minutes: 45, kind: 'life' },
  { at: '13:00', text: '午休', minutes: 30, kind: 'rest' },
  { at: '14:00', text: '下午做正事', minutes: 120, kind: 'work' },
  { at: '16:00', text: '歇一会儿', minutes: 20, kind: 'rest' },
  { at: '18:00', text: '晚饭', minutes: 45, kind: 'life' },
  { at: '19:30', text: '散步或收尾', minutes: 30, kind: 'rest' },
  { at: '21:00', text: '自己的时间（想干什么干什么）', minutes: 60, kind: 'free' },
  { at: '22:30', text: '洗漱', minutes: 20, kind: 'life' },
]

export const KIND_CN = { life: '生活', work: '做事', rest: '歇', free: '自由' }

function toMin(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || '').trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
function fmt(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** 粗糙版：把模板印成一条时间轴。只读，不碰账。 */
export function renderRough(day = ROUGH_DAY, { wake = '08:00', sleep = '23:30' } = {}) {
  const rows = [...day].sort((a, b) => (toMin(a.at) ?? 0) - (toMin(b.at) ?? 0))
  const lines = [`**粗糙版：一个普通人的一天**（${wake} 起，${sleep} 睡）`, '']
  for (const r of rows) {
    const s = toMin(r.at)
    lines.push(`${r.at}–${fmt(s + r.minutes)}　${r.text}　（${KIND_CN[r.kind] || r.kind}，${r.minutes} 分钟）`)
  }
  lines.push('')
  lines.push('这只是参照纸。要哪条，自己 `free_add` 加进去——模板不自动写账。')
  return lines.join('\n')
}

/** 精细版：账上的固定事 + 模板当参照 → 骨架、留白、判语。 */
export function refine(state, now = Date.now(), { window, routine = ROUGH_DAY } = {}) {
  const plan = planOf(state, now, window ? { window } : {})
  const day = toMin(window?.wake || plan?.window?.wake || '08:00') ?? 480
  const night = toMin(window?.sleep || plan?.window?.sleep || '23:30') ?? 1410

  // planOf 的块用 from/to（分钟数），这里统一换成 HH:MM，好印也好读
  const norm = (b) => ({ start: fmt(b.from), end: fmt(b.to), minutes: b.minutes, text: b.text, kind: b.kind })
  const busy = (plan?.blocks || []).filter((b) => b.kind === 'fixed').map(norm)
  const free = (plan?.blocks || []).filter((b) => b.kind === 'free').map(norm)
  const slots = free
    .map((b) => ({ start: b.start, end: b.end, minutes: b.minutes }))
    .filter((b) => b.minutes >= 30)
    .sort((a, b) => b.minutes - a.minutes)

  const total = Math.max(1, night - day)
  const density = Math.min(1, Math.max(0, (plan?.busyMinutes || 0) / total))
  const longest = slots.length ? slots[0].minutes : 0

  // 与模板的差：模板有、账上没有的事——只提示，不替人加
  const have = new Set(busy.map((b) => String(b.text || '').trim()))
  const missing = routine
    .filter((r) => r.kind === 'life' || r.kind === 'rest')
    .filter((r) => !have.has(r.text))
    .map((r) => `${r.at} ${r.text}`)

  let verdict
  if (density > 0.75) verdict = '排得太密了：两件事之间没有喘气的地方。要么删一件，要么把某一件挪到明天。'
  else if (density < 0.25) verdict = '今天很空。空不是欠着——想做什么就做什么，不用为了填满而填。'
  else verdict = '密度合适：有几段长的空白，够做一件正经事，也够发呆。'

  return { plan, busy, free, slots, density, longest, missing, verdict, window: { wake: fmt(day), sleep: fmt(night) } }
}

export function renderRefined(r) {
  const lines = []
  lines.push(`**精细版：今天的骨架**（${r.window.wake} – ${r.window.sleep}）`)
  lines.push('')
  if (!r.busy.length) lines.push('固定事：一件都没有。')
  else {
    lines.push('固定事：')
    for (const b of r.busy) lines.push(`  ${b.start}–${b.end}　${b.text}（${b.minutes} 分钟）`)
  }
  lines.push('')
  if (!r.slots.length) lines.push('纯空白：没有 30 分钟以上的整段。想有一段，就得挪开点什么。')
  else {
    lines.push(`纯空白（≥30 分钟的整段，共 ${r.slots.length} 段）：`)
    for (const s of r.slots.slice(0, 8)) lines.push(`  ${s.start}–${s.end}　${s.minutes} 分钟`)
    if (r.slots.length > 8) lines.push(`  …还有 ${r.slots.length - 8} 段`)
  }
  lines.push('')
  lines.push(`密度 ${(r.density * 100).toFixed(0)}%，最长一段空白 ${r.longest} 分钟。${r.verdict}`)
  if (r.missing.length) {
    lines.push('')
    lines.push(`参照纸上有、你账上没有的（只是提醒，不替你加）：${r.missing.slice(0, 4).join('、')}`)
  }
  return lines.join('\n')
}
