/**
 * update.mjs —— 更新模块正文与实现程序（框架自身的实现，不是插件）
 * ============================================================================
 * 为什么单独一份：这两个动作只碰盘上的文件，不依赖宿主的 ctx。
 * 判据：改动要说得清三件事——改了哪个文件、现在多少字、旧稿备在哪。
 * 边界：模块正文只写工作区的 persona-ai/modules/（插件自带那份随包发，改了下次升级就丢）；
 *       程序只写 index.js 与 impl/*.mjs，别的路径这个模块不管。
 */
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, appendFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const MODULE_RE = /^(\d{2})-[^\n]*\.md$/

export function stampNow(now) {
  const d = now instanceof Date ? now : new Date()
  return d.toISOString().replace(/[:.]/g, '-')
}

export function workspaceOf({ cfg = {}, ctx = process, here } = {}) {
  const fromCfg = String(cfg.workspace || '').trim()
  if (fromCfg && existsSync(fromCfg)) return fromCfg
  const fw = String(cfg.frameworkFile || '').trim()
  if (fw) {
    const d = dirname(fw)
    const base = basename(d) === '.persona-framework' ? dirname(d) : d
    if (existsSync(base)) return base
  }
  try {
    const wd = ctx.get('workingDirectory')?.defaultDirectory
    if (wd) return wd
  } catch { /* 没有工作区服务就当没配 */ }
  if (here && existsSync(join(here, 'persona-ai'))) return here
  return process.cwd()
}

export function moduleDirs(ws, bundled) {
  return [join(ws, 'persona-ai', 'modules'), bundled].filter((d) => d && existsSync(d))
}

export function headingOf(file) {
  const text = readFileSync(file, 'utf8')
  const m = text.match(/^#{1,2}\s+(.+)$/m)
  return m ? m[1].trim() : ''
}

export function moduleList(ws, bundled) {
  const dirs = moduleDirs(ws, bundled)
  if (!dirs.length) return { ok: false, text: '没有模块目录：工作区里没有 persona-ai/modules/，插件自带的那份也不在。' }
  const wsDir = join(ws, 'persona-ai', 'modules')
  const src = existsSync(wsDir) ? wsDir : dirs[0]
  const files = readdirSync(src).filter((f) => f.endsWith('.md')).sort()
  const lines = [`模块目录：${src}`, `共 ${files.length} 篇`, '']
  for (const f of files) {
    const head = headingOf(join(src, f))
    lines.push(`  ${f}${head ? `　${head}` : ''}`)
  }
  lines.push('', '改一篇：op=read 看原文 → op=save 整篇换掉（自动留 .bak）→ op=append 只补末尾。')
  return { ok: true, count: files.length, dir: src, text: lines.join('\n') }
}

export function pickModule(dirList, id) {
  const want = String(id || '').trim()
  if (!want) return null
  const num = want.split('-')[0]
  for (const d of dirList) {
    const files = readdirSync(d)
    const hit = files.find((f) => f === want || f === `${want}.md` || f.startsWith(`${want}-`) || (num && f.startsWith(`${num}-`) && f.endsWith('.md')))
    if (hit) return join(d, hit)
  }
  return null
}

export function backupOf(file, ws, now) {
  const dir = join(ws, '.persona-framework', '备份')
  mkdirSync(dir, { recursive: true })
  const out = join(dir, `${basename(file)}.${stampNow(now)}.bak`)
  writeFileSync(out, readFileSync(file))
  return out
}

export function moduleRead({ ws, bundled, id, max = 8000 }) {
  const dirs = moduleDirs(ws, bundled)
  const file = pickModule(dirs, id)
  if (!file) return { ok: false, text: `没有「${id}」这一篇。op=list 看全部。` }
  const body = readFileSync(file, 'utf8')
  const cut = body.length > max ? `${body.slice(0, max)}\n\n…（截到 ${max} 字，全文 ${body.length} 字）` : body
  return { ok: true, file, chars: body.length, text: `模块：${file}（${body.length} 字）\n\n${cut}` }
}

export function moduleWrite({ ws, bundled, id, text, mode = 'save', now }) {
  const body = String(text ?? '')
  if (!body.trim()) return { ok: false, text: '没给 text：要么写正文，要么先用 op=read 看清楚现在有什么。' }
  const wsDir = join(ws, 'persona-ai', 'modules')
  const dirs = moduleDirs(ws, bundled)
  let target = pickModule(dirs, id)
  // 写只写工作区那份：插件自带的是随包发出去的原件。
  if (target && !target.startsWith(wsDir)) target = join(wsDir, basename(target))
  if (!target) {
    const name = /\.md$/.test(String(id || '')) ? String(id) : `${String(id || '99-新模块')}.md`
    if (!MODULE_RE.test(name)) return { ok: false, text: '新模块的文件名要长成「编号-名字.md」（如 36-新模块.md）——编号决定它排在哪。' }
    target = join(wsDir, name)
  }
  mkdirSync(dirname(target), { recursive: true })
  const old = existsSync(target) ? backupOf(target, ws, now) : ''
  if (mode === 'append') appendFileSync(target, `${body.endsWith('\n') ? '' : '\n'}${body}`)
  else writeFileSync(target, body)
  const now2 = readFileSync(target, 'utf8').length
  return {
    ok: true,
    file: target,
    chars: now2,
    backup: old,
    text: [
      mode === 'append' ? `末尾补好了：${target}` : `整篇换掉了：${target}`,
      `现在 ${now2} 字${old ? `｜旧稿：${old}` : '｜原来没有这个文件'}`,
    ].join('\n'),
  }
}

export function codeFiles(here) {
  const out = []
  if (existsSync(join(here, 'index.js'))) out.push('index.js')
  const implDir = join(here, 'impl')
  if (existsSync(implDir)) for (const f of readdirSync(implDir).filter((x) => x.endsWith('.mjs')).sort()) out.push(`impl/${f}`)
  return out
}

export function codeList(here) {
  const files = codeFiles(here)
  const lines = [`框架目录：${here}`, `实现程序 ${files.length} 个`, '']
  for (const f of files) {
    const p = join(here, f)
    const n = readFileSync(p, 'utf8').split('\n').length
    const size = statSync(p).size
    lines.push(`  ${f}　${n} 行　${size} 字节`)
  }
  lines.push('', '改一个：op=read 看原文 → op=save 整份换掉（自动留 .bak 并跑 node --check）。')
  return { ok: true, count: files.length, text: lines.join('\n') }
}

export function safeCodePath(name) {
  const n = String(name || '').replace(/\\/g, '/').trim()
  if (n === 'index.js') return n
  if (/^impl\/[A-Za-z0-9_.-]+\.mjs$/.test(n)) return n
  return ''
}

export function syntaxCheck(file) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (r.status === 0) return '语法过了'
  const err = String(r.stderr || '').split('\n').filter(Boolean).slice(0, 2).join(' ')
  return `语法没过：${err}`
}

export function codeRead({ here, name, max = 12000 }) {
  const rel = safeCodePath(name)
  if (!rel) return { ok: false, text: `不归这个工具管：${name || '（没给 name）'}。只碰 index.js 与 impl/*.mjs。` }
  const file = join(here, rel)
  if (!existsSync(file)) return { ok: false, text: `没有这个文件：${file}` }
  const body = readFileSync(file, 'utf8')
  const cut = body.length > max ? `${body.slice(0, max)}\n\n…（截到 ${max} 字，全文 ${body.length} 字）` : body
  return { ok: true, file, chars: body.length, text: `程序：${rel}（${body.length} 字）\n\n${cut}` }
}

export function codeCheck({ here, name }) {
  const rel = safeCodePath(name)
  if (!rel) return { ok: false, text: `不归这个工具管：${name || '（没给 name）'}。只碰 index.js 与 impl/*.mjs。` }
  const file = join(here, rel)
  if (!existsSync(file)) return { ok: false, text: `没有这个文件：${file}` }
  const verdict = syntaxCheck(file)
  return { ok: verdict === '语法过了', text: `${rel}：${verdict}` }
}

export function codeWrite({ here, name, text, ws, now }) {
  const rel = safeCodePath(name)
  if (!rel) return { ok: false, text: `不归这个工具管：${name || '（没给 name）'}。只碰 index.js 与 impl/*.mjs。` }
  const body = String(text ?? '')
  if (!body.trim()) return { ok: false, text: '没给 text：要么写整份代码，要么先用 op=read 看清楚现在是什么。' }
  const file = join(here, rel)
  const old = existsSync(file) ? backupOf(file, ws || here, now) : ''
  writeFileSync(file, body)
  const verdict = syntaxCheck(file)
  return {
    ok: verdict === '语法过了',
    file,
    backup: old,
    text: [
      `整份换掉了：${rel}`,
      `${verdict}${old ? `｜旧稿：${old}` : '｜原来没有这个文件'}`,
      '改了程序要重启 DSH 才生效（index.js 和 impl/ 不会被热重载重新读）。',
    ].join('\n'),
  }
}
