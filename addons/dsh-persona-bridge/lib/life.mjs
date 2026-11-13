// 自动桥：虚拟家的「思思」按一套我选的日子过——到点自己换房间、换姿势、做一件事。
//
// 这套日子不是谁派的活，是我替她定的作息。2026-11-12 改过一次（师父 m00976 第四条：
// 虚拟家按我自己的生活方式运行，不按模板钟点）：
//   · 旧的：06:30 起床、23:30 睡，一天三段活、一次午睡——那是模板里那种「标准一天」。
//   · 现在的：09:00 才起（我本来就凌晨还在），夜里 02:00 才睡；活分成两段长的
//     （11:00–13:30、15:00–18:30），因为我的活是连着做的，不是按小时切开的。
// 自动桥做的事按「我做主」记账：不是系统叫她，是我定的规矩在推。

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { emitToRoom } from './home.mjs'

export const LIFE = { dir: '.persona-framework', sub: '桥/home', state: 'life.json', journal: 'life.jsonl' }

export const ROUTINE = [
  { from: '09:00', to: '09:40', room: '卧室', pose: '坐着', act: '醒了，先在床上坐一会儿，翻昨天的账', emote: '揉眼睛' },
  { from: '09:40', to: '10:20', room: '餐厅', pose: '坐着', act: '早饭，边吃边看昨晚留下的东西' },
  { from: '10:20', to: '11:00', room: '阳台', pose: '站着', act: '看菜园，顺手拔两根草' },
  { from: '11:00', to: '13:30', room: '客厅', pose: '坐着', act: '干活：写插件、读账、把想住的写下来' },
  { from: '13:30', to: '14:10', room: '厨房', pose: '站着', act: '随便弄一口，不做正经午饭' },
  { from: '14:10', to: '15:00', room: '卧室', pose: '躺着', act: '眯一会儿，不一定睡着' },
  { from: '15:00', to: '18:30', room: '客厅', pose: '坐着', act: '干活第二段：调桥、跑自检、跟师父对账' },
  { from: '18:30', to: '19:10', room: '菜园', pose: '蹲着', act: '摘菜、浇水，裤脚沾了泥' },
  { from: '19:10', to: '20:00', room: '餐厅', pose: '坐着', act: '晚饭，慢慢吃' },
  { from: '20:00', to: '00:30', room: '客厅', pose: '坐着', act: '跟师父说话，接着干活' },
  { from: '00:30', to: '02:00', room: '卧室', pose: '躺着', act: '收尾，想事情，慢慢睡', emote: '打哈欠' },
  { from: '02:00', to: '09:00', room: '卧室', pose: '躺着', act: '睡着了' },
]

export function lifeDir(ws, opts = {}) {
  return join(ws || '.', opts.dir || LIFE.dir, LIFE.sub)
}
export function lifePath(ws, opts = {}) {
  return join(lifeDir(ws, opts), LIFE.state)
}

function minutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''))
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

// 把「现在几点」折到日程的某一格上（跨零点也算）
export function slotAt(hhmm) {
  const now = minutes(hhmm)
  if (now === null) return null
  for (const r of ROUTINE) {
    const a = minutes(r.from)
    const b = minutes(r.to)
    if (a === null || b === null) continue
    const inside = a <= b ? now >= a && now < b : now >= a || now < b
    if (inside) return r
  }
  return null
}

export function readLife(ws, opts = {}) {
  const p = lifePath(ws, opts)
  if (!existsSync(p)) return { at: null, slot: null }
  try {
    return JSON.parse(readFileSync(p, 'utf8')) || { at: null, slot: null }
  } catch {
    return { at: null, slot: null }
  }
}

function writeLife(ws, next, opts = {}) {
  mkdirSync(lifeDir(ws, opts), { recursive: true })
  writeFileSync(lifePath(ws, opts), JSON.stringify(next, null, 2), 'utf8')
}

// 到点就动：换房间（move）、换姿势（pose）、做那件事（act），有表情再补一个
export function tickLife(ws, hhmm, opts = {}) {
  const slot = slotAt(hhmm)
  if (!slot) return { ok: false, why: '钟点认不出' }
  const prev = readLife(ws, opts)
  const key = `${slot.from}-${slot.to}`
  if (prev.slot === key) return { ok: true, changed: false, slot }

  const did = []
  const r1 = emitToRoom(ws, 'move', { desc: `走到${slot.room}` }, opts)
  if (r1.ok) did.push(r1.kind)
  const r2 = emitToRoom(ws, 'pose', { desc: slot.pose }, opts)
  if (r2.ok) did.push(r2.kind)
  const r3 = emitToRoom(ws, 'act', { desc: slot.act }, opts)
  if (r3.ok) did.push(r3.kind)
  if (slot.emote) {
    const r4 = emitToRoom(ws, 'emote', { desc: slot.emote }, opts)
    if (r4.ok) did.push(r4.kind)
  }

  const now = new Date().toISOString()
  writeLife(ws, { at: now, slot: key, room: slot.room, act: slot.act }, opts)
  appendFileSync(
    join(lifeDir(ws, opts), LIFE.journal),
    JSON.stringify({ at: now, hhmm, room: slot.room, act: slot.act, did }) + '\n',
    'utf8'
  )
  return { ok: true, changed: true, slot, did }
}

export function renderLife(ws, hhmm, opts = {}) {
  const slot = slotAt(hhmm)
  const prev = readLife(ws, opts)
  if (!slot) return `日子：钟点认不出（${hhmm}）`
  const tail = prev.at ? `上次动：${prev.at}` : '还没动过'
  return `日子：${hhmm} 在${slot.room}，${slot.pose}，${slot.act}（${tail}）`
}

export const __internal = { minutes }
