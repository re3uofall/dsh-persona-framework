/**
 * 真动手：跑一条命令，把回执拿回来。
 * 不猜、不重试、不吞错——超时与失败原样往上交。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'

export const DEFAULT_TIMEOUT = 60_000
const MAX_OUT = 4000

const isWin = process.platform === 'win32'

/**
 * powershell 的绝对路径。宿主进程的 PATH 不一定有 System32
 * （从 bash 里起的 node 就没有），所以先找绝对路径，找不到才退回裸名。
 */
export function powershellPath() {
  if (!isWin) return '/bin/sh'
  const win = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
  const abs = `${win}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
  return existsSync(abs) ? abs : 'powershell.exe'
}

export function runCommand(command, { timeoutMs = DEFAULT_TIMEOUT, cwd } = {}) {
  const cmd = String(command || '').trim()
  if (!cmd) return Promise.resolve({ ok: false, why: '没给命令。' })
  const bin = powershellPath()
  const args = isWin
    ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${cmd}`]
    : ['-c', cmd]
  // spawn 的 ENOENT 有两种：命令找不到、cwd 不存在。后者先建出来。
  if (cwd && !existsSync(cwd)) {
    try { mkdirSync(cwd, { recursive: true }) } catch { /* 建不出来就让 spawn 去报 */ }
  }
  const started = Date.now()
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    let done = false
    let child
    try {
      child = spawn(bin, args, { cwd: cwd || undefined, windowsHide: true })
    } catch (e) {
      resolve({ ok: false, why: `起不来进程：${e && e.message ? e.message : String(e)}` })
      return
    }
    const timer = setTimeout(() => {
      if (done) return
      done = true
      try { child.kill() } catch { /* 已经死了 */ }
      resolve({ ok: false, timedOut: true, code: null, out: out.slice(0, MAX_OUT), err: err.slice(0, MAX_OUT), ms: Date.now() - started, why: `超时（${Math.round(timeoutMs / 1000)} 秒）` })
    }, Math.max(1000, Math.min(600_000, Number(timeoutMs) || DEFAULT_TIMEOUT)))
    child.stdout && child.stdout.on('data', (d) => { if (out.length < MAX_OUT * 2) out += d.toString('utf8') })
    child.stderr && child.stderr.on('data', (d) => { if (err.length < MAX_OUT * 2) err += d.toString('utf8') })
    child.on('error', (e) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ ok: false, why: `跑不起来：${e && e.message ? e.message : String(e)}` })
    })
    child.on('close', (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ ok: true, code: code == null ? -1 : code, out: out.slice(0, MAX_OUT), err: err.slice(0, MAX_OUT), ms: Date.now() - started })
    })
  })
}

/** 回执的第一行有内容的字——用来一句话说清「动了什么，怎么回」。 */
export function firstLine(result) {
  const text = String((result && (result.out || result.err)) || '')
  const line = text.split('\n').map((s) => s.trim()).find(Boolean) || ''
  return line
}
