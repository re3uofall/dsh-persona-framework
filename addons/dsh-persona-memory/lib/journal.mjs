/**
 * 流水的提炼：把「一轮一条」的原文压成「一行一条」。
 *
 * 这一层的判断：**流水的价值不在全文，在「谁说了什么、结论是什么」那一行。**
 * 全文留着是为了核对（要能翻回去），不是为了每轮都读它。
 *
 * ★ 一条来自 ECHO 架构（`cyanwell/dsh-agent-soul` 的 docs/ECHO-权威口径.md）的硬判据：
 *   **没有指针的摘要不许进判断层。** 摘要只是索引，不是记忆本体——一手永远优先。
 *   所以这一版压出来的每一行都带 `源:文件#序号`，翻得回去才算数。
 *   压出不带指针的行，等于把「我记得」当成了「我核对过」。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const MD = /\.md$/i

/** 掐到最近的一个句读，不留半句话。 */
export function clipLine(s, max = 60) {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const head = t.slice(0, max)
  const cut = Math.max(head.lastIndexOf('。'), head.lastIndexOf('；'), head.lastIndexOf('，'), head.lastIndexOf('？'), head.lastIndexOf('！'))
  return (cut > max * 0.4 ? head.slice(0, cut) : head) + '…'
}

/**
 * 把一份流水压成行。**每行带 seq 和行号，可翻回原文。**
 *
 * 认的格式（import_dsh_sessions.py 和类似导出器都长这样）：
 *
 *   ## 2026-10-31 · 标题
 *   师父：原话
 *   她：回话
 *
 * 认不出格式就返回空数组——**宁可不提炼，也不瞎提炼**。
 */
export function condense(text) {
  const lines = String(text || '').split('\n')
  const out = []
  let cur = null
  let seq = 0
  const flush = () => {
    if (cur) out.push(cur)
    cur = null
  }
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trimEnd()
    const h = line.match(/^##\s+(.+)$/)
    if (h) {
      flush()
      seq += 1
      cur = { seq, lineNo: i + 1, head: h[1].trim(), say: '', reply: '' }
      continue
    }
    if (!cur) continue
    const u = line.match(/^(师父|user|使用者|她|assistant)[：:]\s*(.+)$/)
    if (u) {
      const isUser = /^(师父|user|使用者)/.test(u[1])
      if (isUser && !cur.say) cur.say = u[2]
      else if (!isUser && !cur.reply) cur.reply = u[2]
      continue
    }
    const u2 = line.match(/^[-*]\s*(师父|使用者)[：:]\s*(.+)$/)
    if (u2 && !cur.say) cur.say = u2[2]
    const u3 = line.match(/^[-*]\s*她[：:]\s*(.+)$/)
    if (u3 && !cur.reply) cur.reply = u3[1]
  }
  flush()
  return out
    .filter((x) => x.head || x.say)
    .map((x) => ({
      seq: x.seq,
      lineNo: x.lineNo,
      head: x.head,
      /** 正文：标题 + 师父首句 + 回话首句 */
      line: [x.head, x.say ? `师父：${clipLine(x.say, 46)}` : '', x.reply ? `她：${clipLine(x.reply, 46)}` : '']
        .filter(Boolean).join('｜'),
    }))
}

/**
 * 从流水里取一段的**逐字片段**（不做转述）。给「翻回去」用。
 *
 * @param {string} text 流水全文
 * @param {number} seq  第几个小节（从 1 起）
 * @param {number} want 最多取多少字
 */
export function excerpt(text, seq, want = 400) {
  const lines = String(text || '').split('\n')
  const starts = []
  lines.forEach((l, i) => { if (/^##\s+/.test(l)) starts.push(i) })
  const idx = Number(seq) - 1
  if (idx < 0 || idx >= starts.length) return ''
  const from = starts[idx]
  const to = idx + 1 < starts.length ? starts[idx + 1] : lines.length
  const body = lines.slice(from, to).join('\n').trim()
  return body.length <= want ? body : `${body.slice(0, want)}…`
}

/**
 * 提一份流水，写到目标目录。
 *
 * **写出来的每一行都带指针**：`源:session/2026-10-28.md#12`
 * ——12 是第几个小节（seq），不是第几行；要原文用 `excerpt()` 按 seq 取。
 */
export function condenseJournal(root, opts = {}) {
  const fromDir = join(root, opts.from || 'persona-ai/knowledge/session')
  const toDir = join(root, opts.to || 'persona-ai/knowledge/chat')
  const dryRun = opts.dryRun !== false
  const results = []

  if (!existsSync(fromDir)) {
    // ★ 新装的人第一次跑这里时，目录还不存在——那不是坏，是还没开始。
    //   报「没有这个目录」会让人以为插件坏了；说清「先聊几轮」才对。
    return { fromDir, toDir, dryRun, results, empty: true,
      note: '还没有流水——先聊几轮，攒出 session 文件，这个才有东西可压。' }
  }

  const files = readdirSync(fromDir).filter((f) => MD.test(f) && !f.startsWith('_'))
  let raw = 0
  let kept = 0

  for (const f of files) {
    const src = join(fromDir, f)
    let text = ''
    try { text = readFileSync(src, 'utf8') } catch { continue }
    const rows = condense(text)
    if (!rows.length) {
      results.push({ file: f, rawChars: text.length, rows: 0, note: '格式认不出，跳过' })
      continue
    }
    // ★ 指针不是免费的：每行多一条 `↳ 源：…` 约 30–40 字。
    //   文件太小时，压完反而比原文长——那就不压，原样留着更省。
    //   实测：102 字的流水压成 155 字。这不是 bug，是指针的成本。
    if (text.length < (opts.minChars ?? 600)) {
      results.push({ file: f, rawChars: text.length, rows: rows.length, note: `太小（${text.length} 字），压了更长，跳过` })
      continue
    }
    raw += text.length
    // ★ 指针是必须的：没有它，这一行不许进判断层
    const body = rows.map((r) => `- ${r.line}\n  ↳ 源：session/${f}#${r.seq}（第 ${r.lineNo} 行起）`).join('\n')
    kept += body.length
    results.push({ file: f, rawChars: text.length, rows: rows.length, chars: body.length })
    if (!dryRun) {
      mkdirSync(toDir, { recursive: true })
      const target = join(toDir, basename(f))
      writeFileSync(target, `# ${basename(f, '.md')} · 提炼\n\n`
        + `> 从 session/${f} 压出来的，一行一条，**每条带指针**（\`#N\` 是第 N 个小节）。\n`
        + `> 原文还在原处，要核对去翻它。\n`
        + `> 没有指针的摘要不许留在这层——摘要只是索引，不是记忆本体。\n\n${body}\n`, 'utf8')
    }
  }

  return {
    fromDir, toDir, dryRun, results,
    rawChars: raw,
    keptChars: kept,
    ratio: raw ? kept / raw : 0,
  }
}

export function renderCondense(r) {
  // ★ 目录还不存在时说「先聊几轮」，不说「没有这个目录」——新装的人看不出区别，只会以为坏了。
  if (r.empty) return `提炼：${r.note || '还没有流水——先聊几轮，攒出 session 文件再来。'}`
  if (r.error) return `提炼：${r.error}`
  const head = r.dryRun
    ? `提炼（干跑）：${r.results.length} 个流水文件`
    : `提炼：${r.results.length} 个流水文件 → ${r.toDir}`
  const lines = [head, '']
  for (const x of r.results.slice(0, 12)) {
    lines.push(`  ${x.file}：${x.rawChars.toLocaleString()} 字 → ${x.rows} 行`
      + (x.chars ? `（${x.chars} 字，带指针）` : x.note ? `（${x.note}）` : ''))
  }
  if (r.results.length > 12) lines.push(`  ……还有 ${r.results.length - 12} 个`)
  if (r.rawChars) {
    lines.push(
      '',
      `合计：${r.rawChars.toLocaleString()} 字 → ${r.keptChars.toLocaleString()} 字，压到 ${Math.round(r.ratio * 100)}%`,
      '**每一行都带 `源:文件#序号`**——压小了是为了不淹，但翻得回去才算数。',
      r.dryRun ? '干跑不动文件。要写，加 dryRun=false。' : '原文一个字没动。',
    )
  }
  return lines.join('\n')
}
