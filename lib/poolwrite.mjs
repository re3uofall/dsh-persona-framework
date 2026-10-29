/**
 * 往池子里写一条。
 *
 * 能写的地方（总闸开着才写）：框架正文、八个池、人格文件、人格的相关文件、字典。
 *
 * 规矩只剩三条，都是为了「写进去还能找回来」：
 * 1. 一条只讲一件事——给个上限，别把整本书塞一条。
 * 2. 记下来源：给了就核一遍，没给就记「本会话」；不逼人编出处。
 * 3. 默认追加，不覆盖：要整段换掉得自己说 mode=replace。
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, copyFileSync, statSync, unlinkSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { basisOf } from './anchor.mjs'

/** 能写的地方。键是调用方用的名字。 */
export const WRITE_TARGETS = {
  memory: { kind: 'dir', rel: 'knowledge', label: '记忆池' },
  session: { kind: 'dir', rel: 'persona-ai/knowledge/session', label: '经验池' },
  web: { kind: 'dir', rel: 'persona-ai/knowledge/web', label: '外部整合池' },
  world: { kind: 'dir', rel: 'persona-ai/knowledge/world', label: '理论池' },
  internal: { kind: 'dir', rel: 'persona-ai/modules', label: '内部整合池' },
  framework: { kind: 'file', rel: '.persona-framework/FRAMEWORK.md', label: '框架正文' },
  persona: { kind: 'persona', label: '人格文件' },
  characters: { kind: 'dir', rel: 'persona-ai/characters', label: '人格相关文件' },
  lexicon: { kind: 'dir', rel: '.persona-framework/lexicon', label: '字典池' },
}

const MAX_CHARS = 20000

/** 写之前的快照：只留最近一份，够撤一次。人格和框架这种「改了就长在身上」的东西必须先留。 */
export const undoPathOf = (file) => join(dirname(file), `.${basename(file)}.undo`)

const snapshot = (file) => {
  try {
    if (existsSync(file)) { copyFileSync(file, undoPathOf(file)); return true }
  } catch { /* 留不下快照也照写，但会报出来 */ }
  return false
}

/** 撤回上一次写：拿快照盖回去。 */
export function undoWrite(file) {
  const bak = undoPathOf(file)
  if (!existsSync(bak)) return { ok: false, why: '没有快照：这个文件没被本模块改过，或者已经撤过一次' }
  try {
    copyFileSync(bak, file)
    // 一次一撤：撤完就把快照收掉，免得同一个快照撤两回还以为又撤了一次。
    try { unlinkSync(bak) } catch { /* 删不掉下次撤会说没快照 */ }
    const chars = readFileSync(file, 'utf8').length
    return { ok: true, file, chars }
  } catch (e) {
    return { ok: false, why: `撤不回去：${e && e.message}` }
  }
}


const pad = (v) => String(v).padStart(2, '0')
const dayStamp = (now) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
const hhmm = (now) => `${pad(now.getHours())}:${pad(now.getMinutes())}`

/**
 * 写一条。
 * @param {string} root 工作区
 * @param {{pool?:string, text:string, source?:string, mode?:'append'|'replace', file?:string, personalityFile?:string, now?:Date}} opts
 */
export function appendToPool(root, opts = {}) {
  const { pool = 'session', text = '', source = '', mode = 'append', file = '', personalityFile = '', now = new Date() } = opts
  const target = WRITE_TARGETS[pool]
  if (!target) {
    return { ok: false, why: `不认识的写入目标：${pool}。可写：${Object.keys(WRITE_TARGETS).join(' / ')}` }
  }
  const body = String(text || '').trim()
  if (!body) return { ok: false, why: '没给 text' }
  if (body.length > MAX_CHARS) return { ok: false, why: `太长（${body.length} 字）：一条别超 ${MAX_CHARS} 字` }

  // 来源：给了就核一遍，没给就记「本会话」——不逼人编出处。
  let srcLabel = '本会话（未另注来源）'
  let srcExcerpt = ''
  if (String(source || '').trim()) {
    const b = basisOf(root, source)
    if (!b.ok) return { ok: false, why: b.why }
    srcLabel = `${source}（${b.label}）`
    srcExcerpt = b.excerpt || ''
  }

  // 落到哪个文件
  let dest = ''
  if (target.kind === 'dir') dest = join(root, target.rel, file || `${dayStamp(now)}.md`)
  else if (target.kind === 'file') dest = join(root, target.rel)
  else if (target.kind === 'persona') {
    const pf = String(personalityFile || '').trim()
    dest = pf || join(root, 'persona-ai', 'characters', file || '人格.md')
  }
  if (!dest) return { ok: false, why: '算不出写到哪个文件' }

  try {
    const dir = dirname(dest)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    // 改「长在身上」的那几样，先留一份快照，才好撤。
    const isSelf = target.kind === 'persona' || target.kind === 'file'
    const beforeChars = existsSync(dest) ? readFileSync(dest, 'utf8').length : 0
    const snapped = isSelf ? snapshot(dest) : false
    if (!existsSync(dest)) {
      writeFileSync(dest, target.kind === 'dir' ? `# ${dayStamp(now)}（${target.label}）\n\n` : `# ${target.label}\n\n`, 'utf8')
    }
    if (mode === 'replace') {
      writeFileSync(dest, body + '\n', 'utf8')
      return { ok: true, file: dest, mode, label: target.label, source: srcLabel }
    }
    const entry = `- ${hhmm(now)} ${body}\n  - 来源：${srcLabel}${srcExcerpt ? `\n  - 指回：${srcExcerpt}` : ''}\n`
    appendFileSync(dest, entry, 'utf8')
    const text2 = readFileSync(dest, 'utf8')
    const total = text2.split('\n').filter((l) => /^- /.test(l)).length
    return {
      ok: true, file: dest, mode, label: target.label, source: srcLabel, total,
      self: isSelf, snapped, beforeChars, afterChars: text2.length,
      delta: text2.length - beforeChars,
    }
  } catch (e) {
    return { ok: false, why: `写失败：${e && e.message}` }
  }
}

export { basisOf }
