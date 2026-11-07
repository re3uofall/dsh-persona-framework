// 语言背叛：用语言之前先指出处；出处不同，词义就不算同一个。
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULTS = { dir: '.persona-framework', ledger: '背叛账.jsonl', keep: 200 }

export function stampNow(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, '-')
}

export function dirOf(ws, opts = {}) {
  const dir = join(ws || process.cwd(), opts.dir || DEFAULTS.dir)
  mkdirSync(dir, { recursive: true })
  return dir
}

// 出处：路径、URL、时间、工具调用、账本指针。只认能被第三方复核的东西。
const PATTERNS = [
  { kind: 'path', re: /(?:[A-Za-z]:[\\/][^\s，。；、）)]+|(?:^|[\s（(])\.{1,2}[\\/][^\s，。；、）)]+)/g },
  { kind: 'url', re: /https?:\/\/[^\s，。；、）)]+/g },
  { kind: 'time', re: /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?(?:Z|[+-]\d{2}:?\d{2})?/g },
  { kind: 'pointer', re: /(?:persona-ai|\.persona-framework)\/[^\s，。；、）)]+#\d+/g },
  { kind: 'tool', re: /\b(?:hand_run|mouth_say|vision_look|ear_hear|sweep_run|memory_source|memory_recall|framework_program)\b/g },
]

export function anchorsOf(text) {
  const out = []
  const s = String(text || '')
  for (const p of PATTERNS) {
    for (const m of s.matchAll(p.re)) out.push({ kind: p.kind, at: m[0], index: m.index })
  }
  return out.sort((a, b) => a.index - b.index)
}

export function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

// 两句说的是不是同一件事：出处全等才算同一个；差一处就标出来。
export function compare(a, b) {
  const A = anchorsOf(a).map((x) => x.at)
  const B = anchorsOf(b).map((x) => x.at)
  const onlyA = A.filter((x) => !B.includes(x))
  const onlyB = B.filter((x) => !A.includes(x))
  const same = A.length > 0 && B.length > 0 && onlyA.length === 0 && onlyB.length === 0
  return { same, onlyA, onlyB, countA: A.length, countB: B.length }
}

// 含义：只认有出处的候选；没出处的候选一律不参与判定。
export function meaningOf(term, evidences = []) {
  const grounded = evidences.filter((e) => anchorsOf(e.text || '').length > 0)
  const bare = evidences.length - grounded.length
  const kinds = [...new Set(grounded.flatMap((e) => anchorsOf(e.text || '').map((x) => x.kind)))]
  const verdict = grounded.length === 0
    ? { word: term, meaning: '没有出处，含义不定', grounded: 0, bare, kinds }
    : { word: term, meaning: grounded.map((e) => normalize(e.text)).join(' ｜ '), grounded: grounded.length, bare, kinds }
  return verdict
}

export function ledgerPath(ws, opts = {}) { return join(dirOf(ws, opts), opts.ledger || DEFAULTS.ledger) }

export function appendRecord(ws, row, opts = {}) {
  const file = ledgerPath(ws, opts)
  const line = JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n'
  appendFileSync(file, line)
  return { file, line: line.trim() }
}

export function readRecords(ws, limit = 10, opts = {}) {
  const file = ledgerPath(ws, opts)
  if (!existsSync(file)) return []
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
  return lines.slice(-limit).map((l) => { try { return JSON.parse(l) } catch { return { raw: l } } })
}

export function renderMark(row) {
  const a = anchorsOf(row.text)
  if (!a.length) return `「${normalize(row.text)}」——没有现实出处，按内置语料处理，不参与含义判定。`
  return `「${normalize(row.text)}」\n出处 ${a.length} 处：` + a.map((x) => `${x.kind}:${x.at}`).join('｜')
}

export function renderMeaning(v) {
  const head = `词：${v.word}`
  const body = `有出处的 ${v.grounded} 条，没出处的 ${v.bare} 条 → 含义：${v.meaning}`
  return [head, body].join('\n')
}
