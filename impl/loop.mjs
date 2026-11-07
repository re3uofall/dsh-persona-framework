/**
 * 循环：不等谁开口，自己按节奏转。
 *
 * 为什么要有它——现在的 tick 是「注入时才跑一次」。
 * 那叫被叫，不叫循环。Neuro-sama 一直在跑：读弹幕 → 生成 → 说话 → 回到读弹幕，
 * 没人叫它，它自己转。
 *
 * 差别不在「跑得快」，在**谁起头**：
 *   被叫的：你不说话，它就停着，账永远停在上一轮。
 *   循环的：你睡着它也在转，醒来读到的是它刚写过的东西。
 *
 * 三条硬约束：
 *   1. **一次一件，不抢**——上一轮没跑完，这一轮跳过，不排队。
 *   2. **跑崩了不许把整个进程拖死**——出错就记下来，接着转。
 *   3. **结果只落账，不注入**——注入时读的是它刚写下的，不是现场算的。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tick, renderTick } from './tick.mjs'

/* ═════════ 循环自己的账 ═════════ */

export function loopPath(ws) {
  return join(String(ws || process.cwd()), '.persona-framework', 'loop.json')
}

function readLoop(ws) {
  const f = loopPath(ws)
  if (!existsSync(f)) return { cycles: [], last: null, startedAt: null, stops: 0 }
  try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return { cycles: [], last: null, startedAt: null, stops: 0 } }
}

function writeLoop(ws, v) {
  const f = loopPath(ws)
  const d = dirname(f)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  // 只留最近 50 轮，别把文件撑大
  if (Array.isArray(v.cycles)) v.cycles = v.cycles.slice(-50)
  writeFileSync(f, JSON.stringify(v, null, 2), 'utf8')
}

/* ═════════ 循环本体 ═════════ */

let _timer = null
let _running = false
let _ws = null
let _opts = {}

/**
 * 起一个循环。
 *
 * @param ws   工作区
 * @param opts { every 毫秒，默认 30000；level 档位；onCycle 每轮回调 }
 */
export function startLoop(ws, opts = {}) {
  stopLoop(ws) // 先停旧的，不许两个循环叠着

  const every = Math.max(5000, Number(opts.every) || 30000)
  _ws = ws
  _opts = opts

  const L = readLoop(ws)
  L.startedAt = new Date().toISOString()
  writeLoop(ws, L)

  _running = true
  _timer = setInterval(() => {
    if (!_running) return
    runOneCycle(ws, opts)
  }, every)
  // 让进程能退出——不然这个定时器会拖住整个人
  if (typeof _timer.unref === 'function') _timer.unref()

  return { every, startedAt: L.startedAt }
}

/** 停。 */
export function stopLoop(ws) {
  if (_timer) { clearInterval(_timer); _timer = null }
  _running = false
  if (ws) {
    const L = readLoop(ws)
    L.stops = (L.stops || 0) + 1
    L.stoppedAt = new Date().toISOString()
    writeLoop(ws, L)
  }
  return { stopped: true }
}

/** 在不在转。 */
export function loopStatus(ws) {
  const L = readLoop(ws)
  return {
    running: _running,
    every: _opts.every || 30000,
    cycles: L.cycles.length,
    last: L.last,
    startedAt: L.startedAt,
  }
}

/* ═════════ 跑一轮 ═════════ */

let _busy = false

/**
 * 跑一轮：**上一轮没跑完就跳过这一轮，不排队**。
 * 排队会越积越多，最后一起涌出来，比不跑还坏。
 */
function runOneCycle(ws, opts = {}) {
  if (_busy) return { skipped: true, why: '上一轮还没跑完' }
  _busy = true
  const t0 = Date.now()
  try {
    const r = tick(ws, new Date(), { level: opts.level || 'mid', hint: opts.hint })
    const ms = Date.now() - t0
    const L = readLoop(ws)
    const rec = {
      at: new Date().toISOString(),
      ms,
      gaps: r.world?.gaps?.length || 0,
      chose: r.world?.choose?.top?.source || null,
      done: r.world?.done ?? null,
      systems: r.results.length,
      blocked: (r.world?.blocked || []).length,
    }
    L.cycles.push(rec)
    L.last = rec
    writeLoop(ws, L)
    if (typeof opts.onCycle === 'function') opts.onCycle(r, rec)
    return { ok: true, rec }
  } catch (e) {
    // **跑崩了记下来，接着转**——不许把整个进程拖死
    const L = readLoop(ws)
    L.cycles.push({ at: new Date().toISOString(), error: String(e.message || e) })
    L.last = { at: new Date().toISOString(), error: String(e.message || e) }
    writeLoop(ws, L)
    return { ok: false, error: String(e.message || e) }
  } finally {
    _busy = false
  }
}

/* ═════════ 注入时读什么 ═════════ */

/**
 * 注入时**不重跑**，读循环刚写下的那一轮。
 *
 * 为什么：循环和注入是两件事。
 * 循环一直在转，注入只是在问「你刚才转到哪了」。
 * 现场再算一遍等于把同一个活干两次——**那叫重复，不叫实时**。
 */
export function lastCycle(ws) {
  const L = readLoop(ws)
  if (!L.cycles.length) return null
  const last = L.cycles.filter((c) => !c.error).slice(-1)[0]
  if (!last) return null
  const age = Date.now() - new Date(last.at).getTime()
  return { ...last, ageMs: age, running: _running }
}

/** 注入里的那一节。没有循环过就照实说。 */
export function renderLoop(ws) {
  const L = readLoop(ws)
  const st = loopStatus(ws)
  const lines = []

  if (!st.running && !L.cycles.length) {
    return '**循环还没转过**——它不转，这个会话就只看得到人格和框架本身。'
  }

  if (st.running) {
    lines.push(`**在转**（每 ${Math.round(st.every / 1000)} 秒一轮，已转 ${L.cycles.length} 轮）`)
  } else {
    lines.push(`**停着**（转过 ${L.cycles.length} 轮，最后停于 ${L.stoppedAt || '—'}）`)
  }

  const c = L.last
  if (c?.error) {
    lines.push(`上一轮**跑崩了**：${c.error}`)
  } else if (c) {
    const ageS = Math.round((Date.now() - new Date(c.at).getTime()) / 1000)
    lines.push(`上一轮：${ageS} 秒前，${c.ms} ms，${c.systems} 个 system，缺口 ${c.gaps}，${c.chose ? '选了「' + c.chose + '」' : '没选'}`)
  }

  // 连崩两次以上要报——**那是循环在喊救命**
  const errs = L.cycles.slice(-3).filter((x) => x.error).length
  if (errs >= 2) lines.push(`**连着崩了 ${errs} 轮**——循环还在转，但转的是错`)

  return lines.join('\n')
}

/** 手动转一轮（测循环用）。 */
export function spinOnce(ws, opts = {}) {
  return runOneCycle(ws, opts)
}
