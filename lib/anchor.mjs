/**
 * 依据只有一把尺。写要用它，读也要用它。
 *
 * 上一版我把它拆成了两套：写的时候查「出处」，读的时候查「锚」。
 * 那是两把尺。真正的循环是：**读进来的每一条，就是以后写的依据来源**——
 * 所以写入的出处不只能填网址和日期，也可以直接指回池子里的某一条。
 *
 * 三种依据，同一把尺：
 * - 锚：网址 / 日期 / 多位数 / 引号原话（外面来的）
 * - 池内指针：session:2026-10-29.md#12（从自己池子里读到的第 12 条）
 * - 会话原话：使用者这一轮说的那句，原样引
 *
 * 都指不到现实，就不算依据——只算语言。
 */

import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const ANCHOR_RULES = [
  ['网址', /https?:\/\/|www\./i],
  ['日期', /\d{4}[-/年]\d{1,2}([-/月]\d{1,2})?/],
  ['多位数', /\d{3,}/],
  ['引号原话', /[「『"“][^」』"”]{2,60}[」』"”]/],
]

/** 这一段文字带几样锚。读写共用。 */
export function anchorsIn(text) {
  const t = String(text || '')
  const anchors = []
  for (const [name, re] of ANCHOR_RULES) if (re.test(t)) anchors.push(name)
  return { anchors, score: anchors.length }
}

const POOL_DIRS = {
  memory: 'knowledge',
  session: 'persona-ai/knowledge/session',
  web: 'persona-ai/knowledge/web',
  world: 'persona-ai/knowledge/world',
  lexicon: '.persona-framework/lexicon',
}

/**
 * 池内指针：`session:2026-10-29.md#12`——读的时候读到的第 12 条，写的时候可以指回它。
 * 指回去要能核对：文件在不在、第 12 条在不在。
 */
export function resolveCitation(root, citation) {
  const s = String(citation || '').trim()
  const m = s.match(/^([a-z]+):([^\s#]+)(?:#(\d+))?$/i)
  if (!m) return { ok: false }
  const pool = m[1].toLowerCase()
  const dir = POOL_DIRS[pool]
  if (!dir) return { ok: false }
  const file = join(root, dir, m[2])
  if (!existsSync(file)) return { ok: false, why: `池子里没有这个文件：${dir}/${m[2]}` }
  let text = ''
  try { text = readFileSync(file, 'utf8') } catch { return { ok: false, why: '文件读不了' } }
  if (!m[3]) return { ok: true, pool, file, line: null, label: `池内指针（${pool}/${basename(file)}）` }
  const items = text.split('\n').filter((l) => /^[-*]\s+/.test(l))
  const n = Number(m[3])
  if (!Number.isFinite(n) || n < 1 || n > items.length) {
    return { ok: false, why: `这个文件里没有第 ${m[3]} 条（它有 ${items.length} 条）` }
  }
  return {
    ok: true, pool, file, line: n,
    excerpt: items[n - 1].replace(/^[-*]\s+/, '').slice(0, 60),
    label: `池内指针（${pool}/${basename(file)} 第 ${n} 条）`,
  }
}

/**
 * 依据判定：同一把尺。
 * @returns {{ok:boolean, kind?:'锚'|'池内指针', hits?:string[], why?:string, label?:string}}
 */
export function basisOf(root, source) {
  const s = String(source || '').trim()
  if (!s) return { ok: false, why: '没给出处' }
  const cited = resolveCitation(root, s)
  if (cited.ok) return { ok: true, kind: '池内指针', label: cited.label, excerpt: cited.excerpt }
  if (/^[a-z]+:/i.test(s) && cited.why) return { ok: false, why: cited.why }
  const a = anchorsIn(s)
  if (!a.score) {
    return { ok: false, why: '出处里没有网址、日期、多位数、引号原话，也不是池内指针——这种只算想象' }
  }
  return { ok: true, kind: '锚', hits: a.anchors, label: `锚（${a.anchors.join('、')}）` }
}

/** 给一批读到的文件分档：带锚的、只有位置的。 */
export function gradeReads(files) {
  const grounded = []
  const bare = []
  for (const f of files || []) {
    const a = anchorsIn(f.text)
    const row = { path: f.path, chars: String(f.text || '').length, anchors: a.anchors }
    if (a.score > 0) grounded.push(row)
    else bare.push(row)
  }
  return {
    total: (files || []).length,
    grounded, bare,
    groundedCount: grounded.length,
    bareCount: bare.length,
    note: grounded.length
      ? `${grounded.length} 个带锚（可核对），${bare.length} 个只有位置`
      : '一个带锚的都没有：这批读进来只凭位置，内容里没有可核对的东西',
  }
}
