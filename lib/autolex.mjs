/**
 * 自动写字典：插件自己从池子里收说法，不等人喊。
 *
 * 只收「人说过的说法」，不收编出来的词：
 * 从经验池／外部整合池／理论池里抓引号里的短句（「」『』""），2 到 8 个字，
 * 出现过两次以上，而且不在现有字典里——这种才算候选。
 *
 * 候选不直接进字典主池：写进 lexicon/_待定.md（`_` 开头，readLexicon 不解析）。
 * 审过、确认是同一个含义的，再挪成正式的含义文件。这是「自动收」，不是「自动定」。
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 四个写入对象，按身体尺分：
 * - self 自我（本体）：经验池、记忆池——改了就变成另一个我
 * - nonSelf 非我：外部整合池、联网池——外面读到的东西，不是我的记忆
 * - extension 延伸：理论池、内部整合——工具与框架，可换可还
 * - lexicon 字典：含义映射，也是延伸，但单独拎出来管
 */
export const WRITE_SUBJECTS = {
  self: { label: '自我池子（本体）', pools: ['persona-ai/knowledge/session', 'knowledge'] },
  nonSelf: { label: '非我池子', pools: ['persona-ai/knowledge/web', '.persona-framework/net'] },
  extension: { label: '延伸池子', pools: ['persona-ai/knowledge/world', 'persona-ai/modules'] },
  lexicon: { label: '字典池子', pools: ['.persona-framework/lexicon'] },
}
const QUOTE = /[「『"“]([^」』"”]{2,8})[」』"”]/g

const norm = (s) => String(s || '').replace(/\s+/g, '')

/** 从池子里收候选说法。 */
export function harvestCandidates(root, lexicon, subjects) {
  const known = new Set()
  for (const e of lexicon) {
    known.add(norm(e.meaning))
    for (const s of e.surfaces) known.add(norm(s))
  }

  // 只扫选中的那几类；没给就扫全部（兼容旧调用）
  const chosen = Array.isArray(subjects) && subjects.length ? subjects : Object.keys(WRITE_SUBJECTS)
  const pools = [...new Set(chosen.flatMap((k) => (WRITE_SUBJECTS[k] ? WRITE_SUBJECTS[k].pools : [])))]
  const counts = new Map()
  for (const rel of pools) {
    const dir = join(root, rel)
    let names = []
    try { names = existsSync(dir) ? readdirSync(dir).filter((n) => /\.(md|txt)$/i.test(n) && !n.startsWith('_')) : [] } catch { continue }
    // 只看最近改的八个文件，别把整库翻一遍
    names = names
      .map((n) => { try { return { n, t: statSync(join(dir, n)).mtimeMs } } catch { return null } })
      .filter(Boolean).sort((a, b) => b.t - a.t).slice(0, 8).map((x) => x.n)
    for (const n of names) {
      let text = ''
      try { text = readFileSync(join(dir, n), 'utf8') } catch { continue }
      for (const m of text.matchAll(QUOTE)) {
        const w = norm(m[1])
        if (w.length < 2 || w.length > 8) continue
        if (known.has(w)) continue
        if (/^\d+$/.test(w)) continue
        counts.set(w, (counts.get(w) || 0) + 1)
      }
    }
  }

  // 别在这里卡上限：池子里能收的说法远不止二十条，
  // 早先 slice(0, 20) 再被 autoPerRun 砍一刀，等于只看前五条。
  return [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2000)
    .map(([word, count]) => ({ word, count }))
}

/** 写进 _待定.md：已有的不重复写。 */
export function writeCandidates(root, list, now = new Date(), limit = 0) {
  if (!list.length) return { ok: true, added: 0, file: '' }
  const dir = join(root, '.persona-framework', 'lexicon')
  try { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }) } catch { return { ok: false, why: '建不了目录' } }
  const file = join(dir, '_待定.md')
  let old = ''
  try { if (existsSync(file)) old = readFileSync(file, 'utf8') } catch { old = '' }
  // 去重按「词」，不按整行——整行带次数和时间，永远撞不上
  const has = new Set(old.split('\n').filter((l) => /^[-*]\s+/.test(l)).map((l) => norm(l.replace(/^[-*]\s*/, '').replace(/（.*$/, ''))))

  const pad = (v) => String(v).padStart(2, '0')
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  // 先去掉已有的，再按 limit 截。反过来的话，前几条恰好都重复，就会一条都不写。
  let fresh = list.filter((x) => !has.has(norm(x.word)))
  const skipped = list.length - fresh.length
  if (limit > 0) fresh = fresh.slice(0, limit)
  if (!fresh.length) return { ok: true, added: 0, file, skipped }

  const head = old ? '' : '# 待定说法（自动收的，还没定成含义）\n\n> 这里的词是从池子里的引号原话收来的，出现过两次以上、字典里还没有。\n> 确认它属于哪个含义，就把它挪进那个含义文件；不属于任何含义，删掉。\n\n'
  const lines = fresh.map((x) => `- ${x.word}（${x.count} 次，${stamp} 收）`).join('\n')
  try {
    appendFileSync(file, head + lines + '\n', 'utf8')
    return { ok: true, added: fresh.length, file, skipped }
  } catch (e) {
    return { ok: false, why: String(e && e.message) }
  }
}
