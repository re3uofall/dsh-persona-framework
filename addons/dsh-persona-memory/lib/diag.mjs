// 账本损坏诊断：只判、不删、不修。
//
// 判据只有一条：**读得回来吗**。一条一行（jsonl）或一篇一节（md），
// 读不回来就是坏；坏在第几行，要说得出行号——「这个文件有问题」等于没说。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const SKIP_DIRS = new Set(['_archive', '_quarantine', 'node_modules', '.git'])
export const MAX_LIST = 200

function walk(dir, out = [], depth = 0) {
  if (depth > 4) return out
  let names = []
  try { names = readdirSync(dir) } catch { return out }
  for (const name of names) {
    const p = join(dir, name)
    let st = null
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue
      walk(p, out, depth + 1)
    } else if (/\.(jsonl|md)$/i.test(name)) {
      out.push({ path: p, size: st.size })
    }
  }
  return out
}

// 一个字节能读回来吗：读成立即检查替换符与 NUL。
function readText(path) {
  const buf = readFileSync(path)
  const text = buf.toString('utf8')
  const bad = text.includes('\uFFFD') || text.includes('\u0000')
  return { text, bytes: buf.length, bad }
}

export function diagnoseFile({ path, size }) {
  const issues = []
  let text = ''
  try {
    const r = readText(path)
    text = r.text
    if (r.bad) issues.push({ kind: 'encoding', why: '不是干净的 UTF-8（有替换符或 NUL）' })
    if (r.bytes === 0) issues.push({ kind: 'empty', why: '0 字节' })
  } catch (e) {
    return { path, size, ok: false, lines: 0, issues: [{ kind: 'unreadable', why: String(e?.message || e) }] }
  }
  const lines = text.split(/\r?\n/)
  const lastEmpty = lines.length && lines[lines.length - 1] === ''
  if (lastEmpty) lines.pop()

  if (/\.jsonl$/i.test(path)) {
    let badLines = 0
    const samples = []
    let dup = 0
    let prev = null
    lines.forEach((line, i) => {
      const s = line.trim()
      if (!s) { badLines += 0; return }
      try { JSON.parse(s) } catch {
        badLines += 1
        if (samples.length < 5) samples.push({ line: i + 1, head: s.slice(0, 60) })
      }
      if (prev !== null && s === prev) dup += 1
      prev = s
    })
    if (badLines) issues.push({ kind: 'json', why: `${badLines} 行不是合法 JSON`, samples })
    if (dup) issues.push({ kind: 'dup', why: `${dup} 行与上一行完全相同` })
    if (!lastEmpty && text.length) issues.push({ kind: 'truncated', why: '最后一行没有换行结尾（可能写到一半断了）' })
  } else {
    const heads = lines.filter((l) => /^#{1,3}\s/.test(l)).length
    if (text.length && !heads) issues.push({ kind: 'shape', why: '没有一个标题（不像一篇正文）' })
    if (!lastEmpty && text.length && !/\n\s*$/.test(text.slice(-2))) issues.push({ kind: 'truncated', why: '结尾没有换行（可能被截断）' })
  }
  return { path, size, ok: issues.length === 0, lines: lines.length, issues }
}

export function diagnose(root) {
  const files = walk(root)
  const rows = files.slice(0, MAX_LIST).map(diagnoseFile)
  const bad = rows.filter((r) => !r.ok)
  return { total: rows.length, bad: bad.length, rows, scannedAt: new Date().toISOString() }
}

export function renderDiag(res) {
  const lines = [`账本诊断：扫了 ${res.total} 个文件（jsonl/md），有问题的 ${res.bad} 个。`]
  if (!res.bad) {
    lines.push('', '都读得回来。这不是「没问题」的证明——只说明这一遍没扫出坏的。')
    return lines.join('\n')
  }
  lines.push('', '**只判不删**：下面每一条都给出文件、行号、坏在哪；要不要修、怎么修是你的事。')
  for (const r of res.rows.filter((x) => !x.ok).slice(0, 30)) {
    lines.push('', `- \`${r.path}\`（${r.lines} 行，${r.size} 字节）`)
    for (const it of r.issues) {
      lines.push(`  · ${it.why}`)
      for (const s of it.samples || []) lines.push(`    - 第 ${s.line} 行：\`${s.head}…\``)
    }
  }
  return lines.join('\n')
}
