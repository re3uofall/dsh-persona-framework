/**
 * 生成 MANIFEST.txt（发布指纹清单）。
 *
 * 用途：下载方逐文件算 sha256，前 16 位对上表，就知道文件没被改过。
 * 用法：node make-manifest.mjs
 * 注意：改完任何文件都要重跑一次；否则清单和实际内容对不上，等于没有。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const PKG = path.dirname(fileURLToPath(import.meta.url))
const SELF = 'MANIFEST.txt'
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__'])
const SKIP_EXT = new Set(['.tgz', '.zip', '.mp4', '.pptx'])

const version = (() => {
  const src = fs.readFileSync(path.join(PKG, 'index.js'), 'utf8')
  const m = src.match(/const VERSION = '([^']+)'/)
  return m ? m[1] : 'unknown'
})()

const walk = (dir, out = []) => {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const abs = path.join(dir, name)
    const st = fs.statSync(abs)
    if (st.isDirectory()) { walk(abs, out); continue }
    if (SKIP_EXT.has(path.extname(name).toLowerCase())) continue
    if (path.relative(PKG, abs) === SELF) continue
    out.push(abs)
  }
  return out
}

const files = walk(PKG).sort((a, b) => path.relative(PKG, a).localeCompare(path.relative(PKG, b)))
const rows = files.map((abs) => {
  const buf = fs.readFileSync(abs)
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
  const chars = buf.toString('utf8').length
  return `${hash}  ${String(chars).padStart(7)}  ${path.relative(PKG, abs).split(path.sep).join('/')}`
})

const now = new Date()
const pad = (n) => String(n).padStart(2, '0')
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`

const text = [
  '# 发布指纹清单',
  `# 版本：${version}`,
  `# 生成时间：${stamp}`,
  '# 用法：下载后逐文件算 sha256，前 16 位应与下表一致；不一致的说明文件被改过。',
  '',
  'sha256[:16]             字数  文件',
  ...rows,
  '',
].join('\n')

fs.writeFileSync(path.join(PKG, SELF), text, 'utf8')
console.log(`MANIFEST.txt 已重写：${rows.length} 个文件，版本 ${version}`)
