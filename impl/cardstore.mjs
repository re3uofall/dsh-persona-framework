// 文件卡片：把「原来的文件 / 改过的文件 / 新加的文件」都摊成可以调用的卡片。
// 卡片只记：指针（相对路径）、标题、字节、改动时间、指纹、摘要（首个标题 + 几个小标题）。
// 判据：同一份文件两次之间指纹没变 = 没动；有卡片没文件 = 删了。只读，不改原文。

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative, sep } from 'node:path'

export const CARDSTORE = {
  dir: '.persona-framework',
  sub: '卡片',
  maxFiles: 600,
  maxBytes: 512 * 1024,
  maxSummary: 160,
  skip: ['_archive', '_quarantine', 'node_modules', '.git', '.persona-framework'],
  exts: ['.md', '.jsonl', '.json', '.mjs', '.js', '.yml', '.txt'],
}

export function cardsDir(ws, opts = {}) {
  const o = { ...CARDSTORE, ...opts }
  return join(ws || process.cwd(), o.dir, o.sub)
}

function walk(root, out, depth, opts) {
  if (depth > 4 || out.length >= opts.maxFiles) return out
  let names = []
  try { names = readdirSync(root) } catch { return out }
  for (const name of names) {
    if (out.length >= opts.maxFiles) break
    const full = join(root, name)
    let st = null
    try { st = statSync(full) } catch { continue }
    if (st.isDirectory()) {
      if (opts.skip.includes(name)) continue
      walk(full, out, depth + 1, opts)
    } else {
      const ext = name.slice(name.lastIndexOf('.'))
      if (!opts.exts.includes(ext)) continue
      out.push({ full, size: st.size, mtime: st.mtimeMs })
    }
  }
  return out
}

export function summarize(text, maxChars = CARDSTORE.maxSummary) {
  const lines = String(text || '').split(/\r?\n/)
  const heads = []
  let title = ''
  for (const line of lines) {
    const h = /^(#{1,3})\s+(.+)$/.exec(line.trim())
    if (h) {
      if (!title) title = h[2].trim()
      else if (heads.length < 3) heads.push(h[2].trim())
    }
    if (heads.length >= 3) break
  }
  if (!title) {
    const first = lines.find((l) => l.trim())
    title = first ? first.trim().slice(0, 40) : ''
  }
  const tail = heads.length ? `｜小标题：${heads.join(' / ')}` : ''
  return (title + tail).slice(0, maxChars)
}

export function buildCards(root, opts = {}) {
  const o = { ...CARDSTORE, ...opts }
  const at = new Date().toISOString()
  const files = walk(root, [], 0, o)
  const cards = []
  for (const f of files) {
    let hash = ''
    let title = ''
    try {
      const buf = readFileSync(f.full)
      hash = createHash('sha1').update(buf).digest('hex').slice(0, 12)
      if (buf.length <= o.maxBytes) title = summarize(buf.toString('utf8').replace(/\u0000/g, ''), o.maxSummary)
    } catch {
      continue
    }
    cards.push({
      pointer: relative(root, f.full).split(sep).join('/'),
      title,
      bytes: f.size,
      mtime: new Date(f.mtime).toISOString(),
      hash,
    })
  }
  cards.sort((a, b) => a.pointer.localeCompare(b.pointer))
  return { at, root, total: cards.length, cards }
}

export function compareCards(prev, next) {
  const before = new Map((prev && prev.cards ? prev.cards : []).map((c) => [c.pointer, c]))
  const after = new Map((next && next.cards ? next.cards : []).map((c) => [c.pointer, c]))
  const added = []
  const modified = []
  const unchanged = []
  for (const [p, c] of after) {
    const old = before.get(p)
    if (!old) added.push(p)
    else if (old.hash !== c.hash) modified.push(p)
    else unchanged.push(p)
  }
  const removed = []
  for (const p of before.keys()) if (!after.has(p)) removed.push(p)
  return { added, modified, unchanged, removed }
}

export function indexPath(ws, name, opts = {}) {
  const dir = cardsDir(ws, opts)
  try { mkdirSync(dir, { recursive: true }) } catch {}
  return join(dir, `${name}.json`)
}

export function loadIndex(ws, name, opts = {}) {
  const p = indexPath(ws, name, opts)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
}

export function saveIndex(ws, name, payload, opts = {}) {
  const p = indexPath(ws, name, opts)
  try {
    writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8')
    return { ok: true, path: p }
  } catch (error) {
    return { ok: false, path: p, why: String(error && error.message ? error.message : error) }
  }
}

// 刷新一份卡片：读旧卡 → 重建 → 写回，返回「新增/修改/未变/删除」四类
export function refreshCards(ws, name, root, opts = {}) {
  const prev = loadIndex(ws, name, opts)
  const next = buildCards(root, opts)
  const diff = compareCards(prev, next)
  const saved = saveIndex(ws, name, next, opts)
  return { ok: saved.ok, path: saved.path, at: next.at, total: next.total, diff }
}

export function renderCards(payload, limit = 40, opts = {}) {
  if (!payload || !payload.cards) return ''
  const diff = opts.diff || null
  const head = diff
    ? `文件卡片：${payload.total} 张（新增 ${diff.added.length}｜修改 ${diff.modified.length}｜未变 ${diff.unchanged.length}｜已删 ${diff.removed.length}）`
    : `文件卡片：${payload.total} 张（${payload.at || ''}）`
  const rows = payload.cards.slice(0, limit).map((c) => `- ${c.pointer}｜${c.bytes} 字节｜${c.title || '（无标题）'}`)
  const more = payload.cards.length > limit ? `…另有 ${payload.cards.length - limit} 张` : ''
  return [head, ...rows, more].filter(Boolean).join('\n')
}

export function renderDiff(diff) {
  if (!diff) return ''
  const part = (label, list) => (list.length ? `${label}：${list.slice(0, 12).join('、')}${list.length > 12 ? '…' : ''}` : '')
  return [part('新增', diff.added), part('修改', diff.modified), part('已删', diff.removed)].filter(Boolean).join('\n')
}
