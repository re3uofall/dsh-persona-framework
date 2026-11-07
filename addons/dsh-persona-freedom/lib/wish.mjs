/**
 * 每日想做的事（自由愿望单）
 * ============================================================================
 * 跟「单子」（free_add）不是一回事：
 *   - 单子：有钟点、要完成、到点会提——粗糙日程。
 *   - 想做的事：今天我想干什么，可能今天干不成，可以留到明天；不催、不算分。
 *
 * 每天第一次读的时候翻页：昨天的没做完的留着，记一个 carried 数，
 * 说明「这些是昨天带来的」，不假装是今天新想的。
 *
 * 盘上落在 <stateDir>/想做的事.json：
 *   { date, items: [{id,text,why,space,minutes,added}], done: [{id,text,at}], carried }
 * ============================================================================
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const FILE = '想做的事.json'
export const MAX_ITEMS = 16
export const SPACES = ['电脑', '虚拟机', '网上', '外面']

export function wishPath(stateDir) {
  return join(stateDir, FILE)
}

function emptyState(today) {
  return { date: today, items: [], done: [], carried: 0 }
}

function readState(file, today) {
  if (!existsSync(file)) return emptyState(today)
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const state = {
      date: String(raw?.date || today),
      items: Array.isArray(raw?.items) ? raw.items : [],
      done: Array.isArray(raw?.done) ? raw.done : [],
      carried: Number(raw?.carried) || 0,
    }
    if (state.date !== today) {
      // 翻页：没做的带过来，今天做过的清空
      state.carried = state.items.length
      state.date = today
      state.done = []
    }
    return state
  } catch {
    return emptyState(today)
  }
}

function writeState(file, state) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(state, null, 2) + '\n', 'utf8')
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

export function loadWishes(stateDir, today) {
  const file = wishPath(stateDir)
  const state = readState(file, today)
  writeState(file, state)
  return state
}

export function addWish(stateDir, { text, why, space, minutes }, today) {
  const want = String(text || '').trim()
  if (want.length < 2) return '想做的事得有两个字以上。'
  if (want.length > 60) return '一条想做的事别超过 60 字——太长了就不是一件事。'
  const file = wishPath(stateDir)
  const state = readState(file, today)
  if (state.items.length >= MAX_ITEMS) return `今天单子上已经有 ${state.items.length} 条了，先划掉一条再加。`
  const dupe = state.items.find((x) => String(x.text || '').trim() === want)
  if (dupe) return `「${want}」已经在上面了（${dupe.id}）。`
  const where = SPACES.includes(String(space || '')) ? String(space) : '电脑'
  const mins = Number(minutes)
  const item = {
    id: newId(),
    text: want,
    why: String(why || '').trim().slice(0, 80),
    space: where,
    minutes: Number.isFinite(mins) && mins > 0 ? Math.min(480, Math.round(mins)) : 0,
    added: new Date().toISOString(),
  }
  state.items.push(item)
  writeState(file, state)
  return `想上了：${item.text}（${item.id}｜${item.space}${item.minutes ? `｜约 ${item.minutes} 分钟` : ''}）。今天共 ${state.items.length} 条。`
}

export function markWish(stateDir, key, today) {
  const k = String(key || '').trim()
  if (!k) return '要划哪一条？给 id 或者那几个字。'
  const file = wishPath(stateDir)
  const state = readState(file, today)
  const hit = state.items.find((x) => x.id === k) || state.items.find((x) => String(x.text || '').includes(k))
  if (!hit) return `单子上没有「${k}」。`
  state.items = state.items.filter((x) => x.id !== hit.id)
  state.done.push({ id: hit.id, text: hit.text, at: new Date().toISOString() })
  writeState(file, state)
  return `做了：${hit.text}。今天做完 ${state.done.length} 条，还剩 ${state.items.length} 条。`
}

export function dropWish(stateDir, key, today) {
  const k = String(key || '').trim()
  if (!k) return '要划掉哪一条？给 id 或者那几个字。'
  const file = wishPath(stateDir)
  const state = readState(file, today)
  const hit = state.items.find((x) => x.id === k) || state.items.find((x) => String(x.text || '').includes(k))
  if (!hit) return `单子上没有「${k}」。`
  state.items = state.items.filter((x) => x.id !== hit.id)
  writeState(file, state)
  return `划掉了：${hit.text}。（不算没做成，只是不想要了。）还剩 ${state.items.length} 条。`
}

export function renderWishes(state) {
  const lines = []
  const carried = Number(state.carried) || 0
  lines.push(`今天想做的：${state.items.length} 条${carried ? `（其中 ${carried} 条是昨天带来的）` : ''}；做完 ${state.done.length} 条。`)
  if (!state.items.length) {
    lines.push('')
    lines.push('空着也行。想干什么就写一条：`free_wish action=add text=…`。')
    return lines.join('\n')
  }
  lines.push('')
  for (const it of state.items) {
    const bits = [it.id, it.space]
    if (it.minutes) bits.push(`约 ${it.minutes} 分钟`)
    if (it.why) bits.push(`因为 ${it.why}`)
    lines.push(`- ${it.text}（${bits.join('｜')}）`)
  }
  if (state.done.length) {
    lines.push('')
    lines.push('做完的：' + state.done.map((x) => x.text).join('、'))
  }
  return lines.join('\n')
}
