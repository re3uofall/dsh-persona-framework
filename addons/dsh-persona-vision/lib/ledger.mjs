/**
 * 记：把「这一轮看见了什么」落成记忆池里的一条。
 *
 * 格式必须和 `dsh-persona-memory` 的池子同构——`## 标题` 加四行元数据，
 * 不然 memory_recall / memory_source / memory_trace 一个都吃不到，
 * 那就等于写进了一个没人会翻的角落。
 *
 * 正文由调用方给，这里**一个字都不拼**。怎么描述「变了什么」是 index.js 的事；
 * 两头各拼一份，拼出来就是两套话，翻回去对不上。
 *
 * 指针 `vision/YYYY-MM-DD.md#N` 和 memory_source 是同一个坐标系：
 * N 是文件里第几个 `##` 节，从 1 数。**写完要重新数一遍**，
 * 别拿「上一条是 N-1」去推——推出来的数看着对，一旦有人手改过文件就错了，
 * 而错的指针比没有指针更坏：它会安静地指到别的条目上。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 默认落到哪个池子。pointer 也按这个目录算。 */
const DEFAULT_DIR = 'persona-ai/knowledge/vision'

const pad = (n) => String(n).padStart(2, '0')

function offsetOf(d) {
  const off = -d.getTimezoneOffset()
  const abs = Math.abs(off)
  return `${off >= 0 ? '+' : '-'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

/** 从 Date 拆出这一条要用到的几个时间形状。 */
function stampOf(d) {
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const updated = `${date}T${hhmm}:${pad(d.getSeconds())}${offsetOf(d)}`
  return { date, hhmm, updated }
}

/**
 * `record.at` 认三种形状：Date / 毫秒数 / ISO 串。
 *
 * ISO 串优先按它自己带的日期和时间取，不转成 UTC 再转回来——
 * 一张 14:03 的截图，账上就该写 14:03，不该因为跑在别的时区变成 06:03。
 * 没带时区的串，按本机时区补一个。
 */
function resolveAt(at) {
  if (at === undefined || at === null || at === '') return stampOf(new Date())

  if (at instanceof Date) {
    if (Number.isNaN(at.getTime())) throw new Error('appendVisionRecord 的 record.at 不是有效时间')
    return stampOf(at)
  }
  if (typeof at === 'number') {
    const d = new Date(at)
    if (Number.isNaN(d.getTime())) throw new Error(`appendVisionRecord 的 record.at 不是有效时间：${at}`)
    return stampOf(d)
  }

  const s = String(at).trim()
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?$/.exec(s)
  if (m) {
    const date = m[1]
    const hhmm = m[2]
    const ss = m[3] || '00'
    let tz = m[4] || offsetOf(new Date())
    if (tz !== 'Z' && !tz.includes(':')) tz = `${tz.slice(0, 3)}:${tz.slice(3)}`
    return { date, hhmm, updated: `${date}T${hhmm}:${ss}${tz}` }
  }

  const d = new Date(s)
  if (Number.isNaN(d.getTime())) throw new Error(`appendVisionRecord 认不出 record.at：${s}`)
  return stampOf(d)
}

/** 标题只占一行——换行是正文的事。 */
function oneLine(s) {
  return String(s || '').replace(/\s+/g, ' ').trim()
}

/** `dir` 是相对工作区根的路径；掐掉开头的斜杠，别让它跳出 root。 */
function normalizeDir(dir) {
  const raw = String(dir || DEFAULT_DIR).trim().replace(/\\/g, '/')
  const rel = raw.replace(/^\/+/, '').replace(/[A-Za-z]:/, '').replace(/^\/+/, '')
  return rel || DEFAULT_DIR
}

/**
 * pointer 的前半段：去掉 `persona-ai/knowledge/` 那一段，
 * 出来的就是 `vision`——喂回 memory_source 时它是这么拼的。
 */
function pointerBase(dir) {
  const rel = normalizeDir(dir)
  return rel.replace(/^persona-ai\/knowledge\//, '').replace(/\/+$/, '') || 'vision'
}

/** 数文件里有几个 `##` 节——指针的 N 就从这儿来。 */
function countSections(text) {
  let n = 0
  for (const line of text.split('\n')) {
    if (/^##\s+\S/.test(line)) n += 1
  }
  return n
}

/**
 * 往池子里追加一条视觉记录。
 *
 * @param {string} root 工作区根
 * @param {{
 *   at?: string|number|Date,  // ISO 时间串；缺省用现在
 *   source?: string,          // 出处，如 capture/2026-11-02/140312
 *   title?: string,           // 节标题，不含时间前缀
 *   tags?: string[],          // 写进 `- tags:`，逗号分隔
 *   body?: string,            // 正文，多行用 \n；ledger 不拼不改
 *   dir?: string,             // 默认 persona-ai/knowledge/vision
 * }} record
 * @returns {{file:string, pointer:string}}
 */
export function appendVisionRecord(root, record = {}) {
  if (!root || typeof root !== 'string') {
    throw new Error('appendVisionRecord 要 root（工作区根目录），拿到的是空的')
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('appendVisionRecord 要 record 对象')
  }

  const t = resolveAt(record.at)
  const dir = normalizeDir(record.dir)
  const file = join(root, dir, `${t.date}.md`)

  try {
    mkdirSync(join(root, dir), { recursive: true })
  } catch (e) {
    throw new Error(`appendVisionRecord 建不了目录 ${join(root, dir)}：${e?.message || e}`)
  }

  let text = ''
  if (existsSync(file)) {
    try {
      text = readFileSync(file, 'utf8')
    } catch (e) {
      throw new Error(`appendVisionRecord 读不出旧账 ${file}：${e?.message || e}`)
    }
  }
  // 统一换行、砍掉结尾多余空行：文件结尾只留一个换行，多一个都算脏。
  text = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')

  // 第一次写这天：补文件头。补过就不再补，靠正文空不空判。
  if (!text) text = `# ${t.date} · 看到的`

  const tags = (Array.isArray(record.tags) ? record.tags : [])
    .map((x) => oneLine(x))
    .filter(Boolean)
  // 池子里的每一条都该翻得到——tags 空着就至少留一个能检索的词。
  if (!tags.length) tags.push('视觉')

  const title = oneLine(record.title) || '看屏记录'
  const body = String(record.body ?? '').replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  const source = oneLine(record.source) || 'vision'

  const section = [
    `## ${t.hhmm} ${title}`,
    `- tags: ${tags.join(', ')}`,
    '- kind: vision',
    `- source: ${source}`,
    `- updated: ${t.updated}`,
    '',
    body,
    '',
  ].join('\n')

  const out = `${text}\n\n${section}`.replace(/\n+$/, '') + '\n'

  try {
    writeFileSync(file, out, 'utf8')
  } catch (e) {
    throw new Error(`appendVisionRecord 写不进 ${file}：${e?.message || e}`)
  }

  // ★ 写完重数，不用旧计数 +1。
  const n = countSections(out)
  return { file, pointer: `${pointerBase(dir)}/${t.date}.md#${n}` }
}
