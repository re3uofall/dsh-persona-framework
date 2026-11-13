// 上下文：一切被自己读进来的信息——自己的也好，外部的也好。
// 一句话：**读过不等于记住**。上下文可以不进记忆，哪怕它看起来像「读过了」。

import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const CTX = {
  dir: '.persona-framework',
  ledger: '上下文账.jsonl',
  order: 49,
  maxRows: 2000,
  maxSource: 240,
}

export const KINDS = ['dialog', 'file', 'tool', 'memory', 'web', 'other']
export const KIND_LABEL = {
  dialog: '会话原文',
  file: '文件',
  tool: '工具回执',
  memory: '记忆段',
  web: '网页',
  other: '别的',
}
export const SIDES = ['own', 'external']
export const SIDE_LABEL = { own: '自己的', external: '外部的' }

export function ctxDir(ws, opts = {}) {
  return join(ws || '.', opts.dir || CTX.dir)
}

export function ledgerPath(ws, opts = {}) {
  return join(ctxDir(ws, opts), opts.ledger || CTX.ledger)
}

/** 一条读过的信息。side 不给时按 pointer 推：有指针=自己的，没指针=外部的。 */
export function noteRead(ws, { source, kind = 'other', pointer = '', chars = 0, side, entered = false, note = '' } = {}, opts = {}) {
  const src = String(source || '').trim()
  if (!src) return { ok: false, error: 'source 必填：读的是什么' }
  const k = KINDS.includes(kind) ? kind : 'other'
  const p = String(pointer || '').trim()
  const s = side === 'own' || side === 'external' ? side : (p ? 'own' : 'external')
  const row = {
    at: new Date().toISOString(),
    source: src.slice(0, opts.maxSource || CTX.maxSource),
    kind: k,
    side: s,
    pointer: p,
    chars: Math.max(0, chars | 0),
    entered: entered === true,
    note: String(note || ''),
  }
  mkdirSync(ctxDir(ws, opts), { recursive: true })
  appendFileSync(ledgerPath(ws, opts), JSON.stringify(row) + '\n', 'utf8')
  return { ok: true, row }
}

export function readLedger(ws, opts = {}) {
  const p = ledgerPath(ws, opts)
  if (!existsSync(p)) return []
  const out = []
  const lines = readFileSync(p, 'utf8').split(/\r?\n/)
  for (const l of lines) {
    const t = l.trim()
    if (!t) continue
    try {
      out.push(JSON.parse(t))
    } catch {
      out.push({ at: '', source: t.slice(0, 80), kind: 'other', side: 'external', pointer: '', chars: t.length, entered: false, note: '坏行' })
    }
  }
  return out
}

function liveRows(ws, opts) {
  return readLedger(ws, opts).filter((r) => !r.dismissed)
}

/** 把来源里含 word 的条目标成「不再算上下文」。账留着，记忆不动。 */
export function dismiss(ws, word, note = '', opts = {}) {
  const q = String(word || '').trim()
  if (!q) return { ok: false, error: '要标的词不能空' }
  const rows = readLedger(ws, opts)
  let n = 0
  const next = rows.map((r) => {
    if (r.dismissed || !String(r.source || '').includes(q)) return r
    n += 1
    return { ...r, dismissed: true, note: String(note || r.note || '读过，不留') }
  })
  if (!n) return { ok: false, error: `账上没有含「${q}」的条目` }
  mkdirSync(ctxDir(ws, opts), { recursive: true })
  writeFileSync(ledgerPath(ws, opts), next.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
  return { ok: true, n }
}

export function stats(ws, opts = {}) {
  const rows = liveRows(ws, opts)
  const bySide = { own: 0, external: 0 }
  const byKind = {}
  let entered = 0
  let chars = 0
  for (const r of rows) {
    bySide[r.side === 'own' ? 'own' : 'external'] += 1
    byKind[r.kind] = (byKind[r.kind] || 0) + 1
    if (r.entered) entered += 1
    chars += r.chars | 0
  }
  return {
    rows: rows.length,
    bySide,
    byKind,
    entered,
    chars,
    last: rows.length ? rows[rows.length - 1].at : null,
    sectionChars: 0,
  }
}

export function renderStats(ws, opts = {}) {
  const s = stats(ws, opts)
  const kinds = Object.keys(s.byKind)
    .map((k) => `${KIND_LABEL[k] || k} ${s.byKind[k]}`)
    .join('｜')
  return [
    `# 上下文账（读过 ${s.rows} 条）`,
    `- 自己的 ${s.bySide.own}｜外部的 ${s.bySide.external}｜已进记忆 ${s.entered}`,
    `- 字：${s.chars}${kinds ? '；' + kinds : ''}`,
    `- 最近一次：${s.last || '还没记过'}`,
    '- 判据：读过不等于记住——进没进记忆看「已进记忆」那一格。',
  ].join('\n')
}

/** 读过但没进记忆的条目（这是「上下文可以不进记忆」的可查证据）。 */
export function unremembered(ws, opts = {}) {
  return liveRows(ws, opts).filter((r) => !r.entered)
}

/** 按词找：这条是在上下文里，还是已经进了记忆。 */
export function check(ws, word, opts = {}) {
  const q = String(word || '').trim()
  if (!q) return { ok: false, error: '要查的词不能空' }
  const rows = liveRows(ws, opts).filter(
    (r) => r.source.includes(q) || r.pointer.includes(q) || r.note.includes(q),
  )
  const inCtx = rows.length
  const inMem = rows.filter((r) => r.entered).length
  return {
    ok: true,
    word: q,
    inCtx,
    inMem,
    verdict: inCtx === 0 ? '不在上下文里' : inMem === 0 ? '只在上下文里，没进记忆' : '进过记忆',
    rows: rows.slice(-5),
  }
}

export function renderCheck(r) {
  if (!r.ok) return r.error
  const tail = r.rows.length
    ? '\n' + r.rows.map((x) => `- ${x.at}｜${KIND_LABEL[x.kind] || x.kind}｜${SIDE_LABEL[x.side]}｜${x.entered ? '已进记忆' : '仅上下文'}`).join('\n')
    : ''
  return `「${r.word}」：上下文 ${r.inCtx} 条｜进记忆 ${r.inMem} 条\n判：${r.verdict}${tail}`
}

export function renderSection(ws, opts = {}) {
  const s = stats(ws, opts)
  return [
    '## 上下文（读过 ≠ 记住）',
    '- 上下文＝这一轮我真读进来的东西：会话原文、文件、工具回执、记忆段、网页。自己的与外部的混在一处，判据只看有没有出处。',
    '- **读过不等于记住**：上下文可以不进记忆——那些字只在这一次的窗口里，翻不到账上就是没记住；要记住的，得单独落一条记忆。',
    `- 账上：读过 ${s.rows} 条（自己的 ${s.bySide.own}｜外部的 ${s.bySide.external}｜已进记忆 ${s.entered}）。工具：context_note / context_status / context_check。`,
  ].join('\n')
}

export function cardOf(text, budget = 600) {
  const src = String(text || '')
  if (src.length <= budget) return src
  const lines = src.split('\n')
  const keep = []
  let n = 0
  for (const line of lines) {
    if (n + line.length + 1 > budget) break
    keep.push(line)
    n += line.length + 1
  }
  return keep.join('\n') + `\n…（余下 ${src.length - n} 字在本地）`
}

export const __internal = { join, CTX }
