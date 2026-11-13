import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { emitToRoom } from './home.mjs'

// 听输入：师父在会话里说的话，要先落到桥上，再变成房间里的动作。
// 判据：一句话里点得出「去哪儿 / 做什么」，才算听懂了；点不出就明说没听懂。

export const ROOMS = ['客厅', '卧室', '厨房', '餐厅', '卫生间', '阳台', '菜园', '玄关', '走廊']

// 家具/位置也算落点：说「走到床上」时，房间是卧室，姿势是躺着。
export const SPOTS = {
  床上: { room: '卧室', pose: '躺着' },
  床边: { room: '卧室', pose: '坐着' },
  床: { room: '卧室', pose: '躺着' },
  沙发: { room: '客厅', pose: '坐着' },
  地毯: { room: '客厅', pose: '坐着' },
  餐桌: { room: '餐厅', pose: '坐着' },
  椅子上: { room: '餐厅', pose: '坐着' },
  灶台: { room: '厨房' },
  冰箱: { room: '厨房' },
  洗手台: { room: '卫生间' },
  淋浴: { room: '卫生间' },
  摇椅: { room: '阳台' },
  菜地: { room: '菜园' },
  畦: { room: '菜园' },
  鞋柜: { room: '玄关' },
}

export const ACT_WORDS = {
  去: 'move', 走到: 'move', 到: 'move', 回: 'move',
  动: 'move', 走: 'move', 过去: 'move', 过来: 'move',
  躺: 'pose', 坐: 'pose', 站: 'pose', 趴: 'pose', 蹲: 'pose',
  睡: 'pose', 醒: 'pose',
  跳: 'act', 跳舞: 'act', 伸懒腰: 'act', 行礼: 'act', 玩游戏: 'act',
  扇风: 'act', 吃: 'act', 打哈欠: 'act', 打盹: 'act', 东张西望: 'act',
  梳毛: 'act', 哼歌: 'act',
  开灯: 'light', 关灯: 'light',
}

export const HEAR = { dir: '.persona-framework', sub: '桥/home', log: '听到.jsonl', maxChars: 200 }

const dirOf = (ws, opts = {}) => join(ws || '.', opts.dir || HEAR.dir, HEAR.sub)

export function hearLogPath(ws, opts = {}) {
  return join(dirOf(ws, opts), HEAR.log)
}

// 从 payload 里取最后一条用户原话；取不到就回空串（不猜）
export function lastUserText(payload) {
  const buckets = [payload?.messages, payload?.context?.messages, payload?.history, payload?.agent?.messages]
  for (const list of buckets) {
    if (!Array.isArray(list) || !list.length) continue
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i]
      if (!m || (m.role && m.role !== 'user')) continue
      const c = m.content
      if (typeof c === 'string' && c.trim()) return c
      if (Array.isArray(c)) {
        const t = c.filter((p) => p && typeof p.text === 'string').map((p) => p.text).join('\n')
        if (t.trim()) return t
      }
    }
  }
  return ''
}

export function parseIntent(text) {
  const body = String(text || '')
  if (!body.trim()) return { ok: false, why: '没有原话' }
  const spotKey = Object.keys(SPOTS).find((k) => body.includes(k)) || ''
  const spot = spotKey ? SPOTS[spotKey] : null
  const room = (spot && spot.room) || ROOMS.find((r) => body.includes(r)) || ''
  let kind = ''
  let word = ''
  for (const [w, k] of Object.entries(ACT_WORDS)) {
    if (body.includes(w)) {
      kind = k
      word = w
      break
    }
  }
  const pose = (spot && spot.pose) || ''
  if (!room && !kind) return { ok: false, why: '这句里没有能落地的地方（房间或动作）' }
  return {
    ok: true,
    room,
    kind: kind || (room ? 'move' : 'act'),
    word,
    spot: spotKey,
    pose,
    text: body.slice(0, HEAR.maxChars),
  }
}

export function hearText(ws, text, opts = {}) {
  const it = parseIntent(text)
  const at = new Date().toISOString()
  if (!it.ok) {
    mkdirSync(dirOf(ws, opts), { recursive: true })
    appendFileSync(hearLogPath(ws, opts), JSON.stringify({ at, text: String(text || '').slice(0, HEAR.maxChars), ok: false, why: it.why }) + '\n', 'utf8')
    return { ok: false, why: it.why }
  }
  const sends = []
  const pushSend = (kind, text, desc) => sends.push({ kind, payload: { text, desc } })
  if (it.room) pushSend('move', `${it.word || '去'}${it.room}`, it.text)
  if (it.pose) pushSend('pose', it.pose, it.text)
  else if (it.kind === 'pose') pushSend('pose', it.word, it.text)
  if (it.kind === 'light') pushSend('light', it.word || '开灯/关灯', it.text)
  if (!sends.length) pushSend(it.kind === 'act' ? 'act' : 'move', it.word || '动一下', it.text)
  let wrote = false
  for (const s of sends) {
    try {
      if (emitToRoom(ws, s.kind, s.payload, opts)?.ok) wrote = true
    } catch {}
  }
  mkdirSync(dirOf(ws, opts), { recursive: true })
  appendFileSync(hearLogPath(ws, opts), JSON.stringify({ at, ok: true, room: it.room, kind: it.kind, word: it.word, spot: it.spot, pose: it.pose, text: it.text, wrote }) + '\n', 'utf8')
  return { ok: true, ...it, wrote, line: `${it.room || '屋里'}：${it.pose || it.word || '动一下'}${it.room ? '' : '了'}` }
}

export function renderHeard(ws, opts = {}) {
  const p = hearLogPath(ws, opts)
  if (!existsSync(p)) return '听见：这一轮还没听到什么'
  const rows = readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).slice(-3).map((l) => {
    try { return JSON.parse(l) } catch { return null }
  }).filter(Boolean)
  if (!rows.length) return '听见：这一轮还没听到什么'
  const last = rows[rows.length - 1]
  if (!last.ok) return `听见：上一句没落地（${last.why}）`
  return `听见：上一句 → ${last.room || '屋里'}·${last.kind}${last.wrote ? '（已写进房间）' : '（没写进去）'}`
}

export const __internal = { dirOf }
