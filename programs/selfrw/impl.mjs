/**
 * 程序模块「自读写」的程序功能实现。
 * 一个程序模块 = program.json（它是谁）+ module.md（它讲什么）+ 这个文件（它怎么做）。
 * 判据：读要报位置与大小；写要留原件；退得回去。
 */
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'

export function readText(file) {
  try {
    const size = statSync(file).size
    return { ok: true, file, size, text: readFileSync(file, 'utf8') }
  } catch (err) {
    return { ok: false, file, reason: `读不到：${err && err.message ? err.message : err}` }
  }
}

export function backupCopy(file, dir) {
  if (!existsSync(file)) return null
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const to = join(dir || dirname(file), `${file.split(/[\\/]/).pop()}.${stamp}.bak`)
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(file, to)
    return to
  } catch {
    return null
  }
}

export function writeText(file, text, { backupDir } = {}) {
  const before = existsSync(file) ? statSync(file).size : 0
  const bak = backupCopy(file, backupDir)
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text, 'utf8')
  } catch (err) {
    return { ok: false, file, reason: `写不进：${err && err.message ? err.message : err}`, backup: bak }
  }
  const after = statSync(file).size
  return { ok: true, file, backup: bak, before, after, delta: after - before }
}

export function diffCounts(beforeText, afterText) {
  const a = String(beforeText || '').split(/\r?\n/)
  const b = String(afterText || '').split(/\r?\n/)
  let same = 0
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i] === b[i]) same += 1
  return { linesBefore: a.length, linesAfter: b.length, sameHead: same, delta: b.length - a.length }
}
