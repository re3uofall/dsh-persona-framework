/**
 * 程序模块「适配」的程序功能实现。
 * 换机器/换宿主先认差异：路径分隔符、换行、编码、名字大小写。
 * 判据：核心不许改，壳越薄越好，换回去还认得出。
 */
import { existsSync, readFileSync } from 'node:fs'

export function normPath(p) {
  return String(p || '').replace(/\//g, '\\').replace(/\\\\+/g, '\\')
}

export function eolOf(text) {
  const s = String(text || '')
  const crlf = (s.match(/\r\n/g) || []).length
  const lf = (s.match(/(?<!\r)\n/g) || []).length
  return crlf > lf ? 'CRLF' : lf > 0 ? 'LF' : 'none'
}

export function toEol(text, eol) {
  const s = String(text || '').replace(/\r\n/g, '\n')
  return eol === 'CRLF' ? s.replace(/\n/g, '\r\n') : s
}

export function encodingOf(file) {
  try {
    const buf = readFileSync(file)
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'utf-8-bom'
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 'utf-16le'
    if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return 'utf-16be'
    const nul = buf.slice(0, 64).includes(0)
    if (nul) return 'utf-16le?'
    return 'utf-8'
  } catch {
    return 'unknown'
  }
}

export function differences(a, b) {
  const out = []
  if (existsSync(a) !== existsSync(b)) out.push('存在性不同')
  const ea = existsSync(a) ? encodingOf(a) : 'unknown'
  const eb = existsSync(b) ? encodingOf(b) : 'unknown'
  if (ea !== eb) out.push(`编码 ${ea} → ${eb}`)
  const eola = existsSync(a) ? eolOf(readFileSync(a, 'utf8')) : 'none'
  const eolb = existsSync(b) ? eolOf(readFileSync(b, 'utf8')) : 'none'
  if (eola !== eolb) out.push(`换行 ${eola} → ${eolb}`)
  return out
}
