/**
 * 探索模块的账本 / 队列 / 知识落盘。
 *
 * 知识格式跟 persona-ai/kb.py 完全一致：一个 `## 标题` 段，段首几行
 * `- tags:` / `- kind:` / `- source:` / `- updated:` 是元数据。
 * 这样 explore 写下来的东西，chat.py 的检索立刻能吃到。
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const ENTRY_TITLE = /^##[ \t]+(.+?)[ \t]*$/gm

export function localDate(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function nowIso() {
  return new Date().toISOString()
}

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function writeJson(file, value) {
  ensureDir(dirname(file))
  const tmp = file + '.tmp-' + process.pid
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, file)
}

export function normalizeTitle(title) {
  return String(title || '')
    .trim()
    .replace(/^#+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function cleanTitle(title) {
  return String(title || '')
    .trim()
    .replace(/^#+\s*/, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

/** 正文里如果有整行像元数据 / 标题，会被 kb.py 误读，先压住。 */
export function cleanBody(body) {
  const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n')
  const out = []
  let first = true
  for (const raw of lines) {
    let line = raw.replace(/[ \t]+$/, '')
    if (first && line.trim()) {
      first = false
      if (/^-\s+[A-Za-z][\w-]*\s*[:：]/.test(line.trim())) line = '— ' + line.trim()
      else if (/^#{1,6}\s/.test(line.trim())) line = '— ' + line.trim()
    }
    // 正文中途的 `## ` 会被当成新条目
    if (/^#{1,6}\s/.test(line.trim())) line = '\\' + line.trim()
    out.push(line)
  }
  return out.join('\n').trim()
}

/** 所有知识文件（排除 README）。 */
export function knowledgeFiles(knowledgeDir) {
  const out = []
  const walk = (dir) => {
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const ent of entries) {
      const p = join(dir, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md') && ent.name.toLowerCase() !== 'readme.md') out.push(p)
    }
  }
  walk(knowledgeDir)
  return out
}

/** 找一条同名知识：返回 { file, title } 或 null。 */
export function findEntry(knowledgeDir, title) {
  const key = normalizeTitle(title)
  if (!key) return null
  for (const file of knowledgeFiles(knowledgeDir)) {
    let text = ''
    try { text = readFileSync(file, 'utf8') } catch { continue }
    for (const m of text.matchAll(ENTRY_TITLE)) {
      if (normalizeTitle(m[1]) === key) return { file, title: m[1].trim() }
    }
  }
  return null
}

/** 按 kb.py 的格式追加一条；返回落盘文件。 */
export function appendEntry(webDir, { date, title, body, tags = [], source = '网上' }) {
  ensureDir(webDir)
  const file = join(webDir, `${date}.md`)
  if (!existsSync(file)) {
    writeFileSync(file, `# ${date} · 碗外见闻\n\n> 自己上网捞的。一条一个判断，不是摘要；来源在每条里。\n`, 'utf8')
  }
  const head = [
    '',
    `## ${title}`,
    `- tags: ${tags.join(', ')}`,
    '- kind: web',
    `- source: ${source}`,
    `- updated: ${date}`,
  ]
  appendFileSync(file, '\n' + head.join('\n') + '\n\n' + body + '\n', 'utf8')
  return file
}

/** 从某个文件里读出所有条目（标题 + 来源），给 status 用。 */
export function parseEntries(file) {
  let text = ''
  try { text = readFileSync(file, 'utf8') } catch { return [] }
  const hits = [...text.matchAll(ENTRY_TITLE)]
  return hits.map((m, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].index : text.length
    const chunk = text.slice(m.index, end)
    const source = /^-[ \t]*source[ \t]*[:：][ \t]*(.+)$/im.exec(chunk)
    return { title: m[1].trim(), source: source ? source[1].trim() : '' }
  })
}

export function todayEntries(webDir, date = localDate()) {
  return parseEntries(join(webDir, `${date}.md`))
}

/** 最近几天捞到的标题（新的在前）。 */
export function recentEntries(webDir, limit = 4) {
  let files = []
  try {
    files = readdirSync(webDir)
      .filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n))
      .sort()
      .reverse()
  } catch { return [] }
  const out = []
  for (const name of files) {
    const items = parseEntries(join(webDir, name))
    for (let i = items.length - 1; i >= 0; i -= 1) {
      out.push({ ...items[i], date: name.slice(0, 10) })
      if (out.length >= limit) return out
    }
  }
  return out
}

export function countEntries(webDir) {
  let files = []
  try { files = readdirSync(webDir).filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n)) } catch { return 0 }
  return files.reduce((n, name) => n + parseEntries(join(webDir, name)).length, 0)
}

export function mtime(file) {
  try { return statSync(file).mtimeMs } catch { return 0 }
}
