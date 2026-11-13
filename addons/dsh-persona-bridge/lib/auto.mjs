// 自动运行：没有被叫醒的时候，自己按一条策略起来做一步。
//
// 判据（师父 m09689）：
// 1) 它得是**我自己做的**——记成 dir='out'，note 里写明「自动运行（我做主）」，
//    不写「系统叫我做的」。策略本身也落在账上，谁改的都看得出。
// 2) 没有输入就不动：收件箱空、触发账没有到点的，就不该起身。
// 3) 有上限：一天最多几次、两次之间至少隔多久，防止空转。

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { BRIDGES, DEFAULTS, bridgeDir, pullInbox, readTriggers, record } from './bridge.mjs'

export const AUTO = {
  idleMin: 20,       // 多久没有新输入算「没被叫醒」
  perDay: 6,         // 一天最多自己起来几次
  minGapMin: 30,     // 两次之间至少隔多久
  kinds: ['inbox', 'trigger', 'idle'],
}

const DEFAULTS_STATE = { on: true, idleMin: AUTO.idleMin, perDay: AUTO.perDay, minGapMin: AUTO.minGapMin, updatedAt: null }

export function autoPath(ws, opts = {}) {
  return join(ws || '.', opts.dir || DEFAULTS.dir, '自动运行.json')
}

export function autoLedger(ws, opts = {}) {
  return join(ws || '.', opts.dir || DEFAULTS.dir, '自动运行账.jsonl')
}

export function loadAuto(ws, opts = {}) {
  const p = autoPath(ws, opts)
  if (!existsSync(p)) return { ...DEFAULTS_STATE }
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'))
    return { ...DEFAULTS_STATE, ...(j && typeof j === 'object' ? j : {}) }
  } catch {
    return { ...DEFAULTS_STATE }
  }
}

export function setAuto(ws, patch = {}, opts = {}) {
  const cur = loadAuto(ws, opts)
  const next = { ...cur, ...(patch || {}), updatedAt: new Date().toISOString() }
  next.idleMin = Math.max(1, Number(next.idleMin) || AUTO.idleMin)
  next.perDay = Math.max(0, Math.min(48, Number(next.perDay) ?? AUTO.perDay))
  next.minGapMin = Math.max(1, Number(next.minGapMin) || AUTO.minGapMin)
  next.on = next.on !== false
  const p = autoPath(ws, opts)
  mkdirSync(join(ws || '.', opts.dir || DEFAULTS.dir), { recursive: true })
  writeFileSync(p, JSON.stringify(next, null, 2), 'utf8')
  return { ok: true, state: next }
}

function rowsOf(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => {
    try { return JSON.parse(l) } catch { return null }
  }).filter(Boolean)
}

function lastInputAt(ws, opts) {
  const led = join(ws || '.', opts.dir || DEFAULTS.dir, opts.ledger || DEFAULTS.ledger)
  const rows = rowsOf(led).filter((r) => r.dir !== 'out' || r.by === 'self')
  const last = rows.length ? rows[rows.length - 1] : null
  return last && last.at ? Date.parse(last.at) : 0
}

// 有什么值得动的：收件箱、到点的触发、以及「很久没动」本身
export function dueAuto(ws, opts = {}, now = Date.now()) {
  const st = loadAuto(ws, opts)
  if (!st.on) return { due: false, why: '关着' }
  const gap = now - (lastInputAt(ws, opts) || 0)
  if (gap < st.idleMin * 60000) return { due: false, why: `刚有输入（${Math.round(gap / 60000)} 分钟）` }

  const today = new Date(now).toISOString().slice(0, 10)
  const ran = rowsOf(autoLedger(ws, opts)).filter((r) => String(r.at || '').startsWith(today))
  if (ran.length >= st.perDay) return { due: false, why: `今天已经起来 ${ran.length} 次（上限 ${st.perDay}）` }
  const last = ran.length ? Date.parse(ran[ran.length - 1].at) : 0
  if (last && now - last < st.minGapMin * 60000) return { due: false, why: '离上次太近' }

  const pending = []
  for (const b of BRIDGES) {
    const inbox = pullInbox(ws, b.id, opts)
    const unread = (inbox.rows || []).length
    if (unread) pending.push({ bridge: b.id, kind: 'inbox', count: unread })
  }
  const trig = readTriggers(ws, opts).filter((r) => r && r.hop && !r.suppressed && now - Date.parse(r.at) < 30 * 60000)
  if (trig.length) pending.push({ bridge: trig[trig.length - 1].bridge, kind: 'trigger', count: trig.length })
  if (!pending.length) return { due: false, why: '没有该动的东西', gapMin: Math.round(gap / 60000) }
  return { due: true, pending, gapMin: Math.round(gap / 60000), today: ran.length, perDay: st.perDay }
}

// 真起来做一步：只落账，不改人格、不生成话
export function tickAuto(ws, opts = {}, now = Date.now()) {
  const d = dueAuto(ws, opts, now)
  mkdirSync(join(ws || '.', opts.dir || DEFAULTS.dir), { recursive: true })
  if (!d.due) {
    appendFileSync(autoLedger(ws, opts), JSON.stringify({ at: new Date(now).toISOString(), ran: false, why: d.why }) + '\n', 'utf8')
    return { ok: false, why: d.why }
  }
  const first = d.pending[0]
  const text = `（没被叫醒，自己起来看一眼）${first.bridge}｜${first.kind}｜${first.count} 条`
  const r = record(ws, { bridge: first.bridge, dir: 'out', text, note: '自动运行（我做主）' }, opts)
  appendFileSync(autoLedger(ws, opts), JSON.stringify({ at: new Date(now).toISOString(), ran: true, bridge: first.bridge, kind: first.kind, count: first.count, pending: d.pending.length }) + '\n', 'utf8')
  return { ok: true, hit: first, pending: d.pending, row: r.row }
}

export function renderAuto(ws, opts = {}, now = Date.now()) {
  const st = loadAuto(ws, opts)
  const d = dueAuto(ws, opts, now)
  const ran = rowsOf(autoLedger(ws, opts)).filter((r) => r.ran).slice(-1)[0]
  const head = `自动运行：${st.on ? '开' : '关'}｜没叫醒 ${st.idleMin} 分钟就起身｜一天最多 ${st.perDay} 次｜间隔 ≥ ${st.minGapMin} 分钟`
  const line = d.due
    ? `现在该起：${d.pending.map((p) => `${p.bridge}/${p.kind} ${p.count}`).join('、')}`
    : `现在不起：${d.why}`
  const last = ran ? `上次：${ran.at}｜${ran.bridge}/${ran.kind}` : '上次：还没自己起过'
  return [head, line, `${last}｜起身记「我做主」，不记「系统叫我」`].join('\n')
}
