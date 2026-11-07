/**
 * 真动手：跑一条命令，把回执拿回来。
 * 不猜、不重试、不吞错——超时与失败原样往上交。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'

export const DEFAULT_TIMEOUT = 60_000
const MAX_OUT = 4000
const MAX_BYTES = MAX_OUT * 8

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

/**
 * 原生工具吐的不一定是 UTF-8：`ipconfig`、进了 `chcp 936` 的会话是 GBK，
 * 有的转储是带 BOM 的 UTF-16。一股脑按 utf8 解，中文全成问号。
 * 判法与 dsh-win32（MIT）的 sniff 同一套，这里自己写一份，不引它的包。
 */
export function sniffEncoding(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || [])
  if (buf.length === 0) return 'utf8'
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 'utf16le'
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return 'utf16be'
  const win = buf.subarray(0, Math.min(buf.length, 4096))
  // NUL 在 UTF-8 里合法（U+0000），但正常文本不会带；先挡掉，否则无 BOM 的 UTF-16LE 会从 UTF-8 那道门混过去
  if (!win.includes(0)) {
    if (utf8Clean(win)) return 'utf8'
    // GBK 候选：解出来不该有替换字符；窗口可能把两字节字符切一半，退一位再试
    const clean = (end) => end > 0 && !decodeWith(win.subarray(0, end), 'gbk').includes('\uFFFD')
    if (clean(win.length) || clean(win.length - 1)) return 'gbk'
    return 'unknown'
  }
  let odd = 0
  for (let i = 1; i < win.length; i += 2) if (win[i] === 0) odd += 1
  if (win.length >= 8 && odd / (win.length / 2) > 0.4) return 'utf16le'
  return 'unknown'
}

function decodeWith(bytes, enc) {
  try { return new TextDecoder(enc).decode(Buffer.from(bytes)) } catch { return Buffer.from(bytes).toString('utf8') }
}

function utf8Clean(bytes) {
  try { return !new TextDecoder('utf-8', { fatal: true }).decode(bytes).includes('\uFFFD') } catch { return false }
}

/** 按判出来的编码解码；判不出就照旧走 utf8。 */
export function decodeOutput(bytes) {
  const verdict = sniffEncoding(bytes)
  if (verdict === 'utf16be') return decodeWith(bytes, 'utf-16be')
  if (verdict === 'gbk') return decodeWith(bytes, 'gbk')
  if (verdict === 'utf16le') return decodeWith(bytes, 'utf-16le')
  return Buffer.from(bytes || []).toString('utf8')
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
    // 先攒原始字节，跑完再按判出来的编码解一次——GBK / UTF-16 都是一次性解才准
    const outChunks = []
    const errChunks = []
    let outBytes = 0
    let errBytes = 0
    const take = (chunks, bytes, d) => (d.length + bytes <= MAX_BYTES ? (chunks.push(d), bytes + d.length) : bytes)
    const outText = () => decodeOutput(Buffer.concat(outChunks)).slice(0, MAX_OUT)
    const errText = () => decodeOutput(Buffer.concat(errChunks)).slice(0, MAX_OUT)
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
      resolve({ ok: false, timedOut: true, code: null, out: outText(), err: errText(), ms: Date.now() - started, why: `超时（${Math.round(timeoutMs / 1000)} 秒）` })
    }, Math.max(1000, Math.min(600_000, Number(timeoutMs) || DEFAULT_TIMEOUT)))
    child.stdout && child.stdout.on('data', (d) => { outBytes = take(outChunks, outBytes, d) })
    child.stderr && child.stderr.on('data', (d) => { errBytes = take(errChunks, errBytes, d) })
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
      resolve({ ok: true, code: code == null ? -1 : code, out: outText(), err: errText(), ms: Date.now() - started })
    })
  })
}

/** 回执的第一行有内容的字——用来一句话说清「动了什么，怎么回」。 */
export function firstLine(result) {
  const text = String((result && (result.out || result.err)) || '')
  const line = text.split('\n').map((s) => s.trim()).find(Boolean) || ''
  return line
}
