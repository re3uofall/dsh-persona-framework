/**
 * lib/busy.mjs —— 免打扰里那一半「别人在用电脑时别抢」
 * ============================================================================
 * 判据不是「我觉得他在忙」，是系统自己记的：距上一次真实键鼠输入多久。
 * 从 `lib/idle.ps1` 读（GetLastInputInfo），查一次缓存 20 秒——每步都起一个
 * PowerShell 太贵，而 20 秒对「有没有人在用」这件事足够准。
 *
 * 这一层只回答「现在有没有人在用」，**不改任何输入通道**：
 * 真要不抢光标，靠的是走 background / 窗口消息那条路（wincu 的 dispatch、
 * 或独立的输入插件）。这里只是那个决定之前的门。
 * ============================================================================
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 这么久没有输入，就当没人在用。 */
export const ACTIVE_MS = 60_000

/** 缓存多久。 */
export const CACHE_MS = 20_000

let cache = { at: 0, value: null }

function psExe() {
  const root = process.env.SystemRoot || 'C:\\Windows'
  return join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function scriptPath() {
  try {
    return join(dirname(fileURLToPath(import.meta.url)), 'idle.ps1')
  } catch {
    return ''
  }
}

/**
 * 距上一次输入多少毫秒。拿不到就 `{ ok: false }`——**不拿 0 冒充「刚有人用」**，
 * 那种假数据会让我在没人的时候也不敢动手。
 */
export function idleMs({ force = false, now = Date.now() } = {}) {
  if (!force && cache.value && now - cache.at < CACHE_MS) return cache.value
  const ps = psExe()
  const script = scriptPath()
  if (!existsSync(ps) || !script || !existsSync(script)) {
    const v = { ok: false, idleMs: -1, why: '找不到 powershell 或 idle.ps1' }
    cache = { at: now, value: v }
    return v
  }
  let out = ''
  try {
    out = execFileSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
    })
  } catch (e) {
    const v = { ok: false, idleMs: -1, why: `查询失败：${e && e.message ? e.message : String(e)}` }
    cache = { at: now, value: v }
    return v
  }
  try {
    const line = String(out).trim().split(/\r?\n/).filter(Boolean).pop() || '{}'
    const j = JSON.parse(line)
    const v = { ok: j.ok === true, idleMs: Number(j.idleMs) || 0 }
    cache = { at: now, value: v }
    return v
  } catch {
    const v = { ok: false, idleMs: -1, why: '输出读不出来' }
    cache = { at: now, value: v }
    return v
  }
}

/** 现在有没有人在用。`active` 为真时，动手别抢光标焦点。 */
export function busyState({ now = Date.now(), force = false } = {}) {
  const r = idleMs({ force, now })
  if (!r.ok) {
    return { ok: false, active: null, seconds: null, why: r.why || '读不到输入时间', hint: '' }
  }
  const seconds = Math.round(r.idleMs / 1000)
  const active = r.idleMs < ACTIVE_MS
  const hint = active
    ? `有人在用（${seconds} 秒前还有输入）。要动手就只走后台那条路（wincu 的 dispatch:background / method:background）；物理点击会动光标、抢焦点，先别。`
    : `没人用（${seconds} 秒没输入）。可以动手，但动完把窗口收拾回去。`
  return { ok: true, active, seconds, hint }
}
