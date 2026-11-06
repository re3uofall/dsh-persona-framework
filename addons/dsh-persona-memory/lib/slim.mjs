/**
 * 整理记忆的体检与索引（只搬不删那一套）。
 * ============================================================================
 * 判据一条：**进前缀的才花钱**。
 *   每轮真进系统提示的只有那几段渲染结果（now / 长期 / 短期 / 其他 / 实时 / 最近）;
 *   原文文件（流水、归档）不进前缀 —— 删它省不了一分，所以只搬不删。
 *
 * 这份文件只管两件事：
 *   1) 按记忆自己的分层报数，并标出「哪一层真进前缀」
 *   2) 重建一份不进前缀的 INDEX.md（域 / 文件数 / 字数），好按图取，不往注入里塞
 * ============================================================================
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const MD = /\.md$/i

/**
 * 原文文件**一层都不进前缀**。进前缀的是渲染结果，各有上限：
 *   now 最近一阵 / long-term 全部 / short 短期摘要 / other 其他标题 / live 实时检索
 * 改渲染就得改这张表，两处要一起对。
 */
export const RENDER_BUDGETS = [
  { key: 'short', label: '短期记忆', chars: 20000, note: '只摆最近几天，超了截断' },
  { key: 'other', label: '其他记忆', chars: 3000, note: '只摆标题行' },
  { key: 'long', label: '长期记忆', chars: 0, note: '全部摆（条目少才允许）' },
  { key: 'live', label: '实时检索', chars: 1200, note: '撞上的几条，带指针' },
  { key: 'now', label: '最近这一阵', chars: 800, note: '刚浮上来的几条' },
]

function listFiles(dir) {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir).filter((f) => MD.test(f)).map((f) => join(dir, f))
  } catch { return [] }
}

function sizeOf(file) {
  try {
    const st = statSync(file)
    return { bytes: st.size, at: st.mtimeMs }
  } catch { return { bytes: 0, at: 0 } }
}

export function measureLayers(root, layers) {
  const out = []
  for (const [key, layer] of Object.entries(layers || {})) {
    const files = (layer.dirs || []).flatMap((d) => listFiles(join(root, d)))
    const bytes = files.reduce((n, f) => n + sizeOf(f).bytes, 0)
    out.push({
      key,
      label: layer.label || key,
      dirs: layer.dirs || [],
      files: files.length,
      bytes,
      inPrefix: false,
    })
  }
  return out
}

export function renderSlimReport(rows, extra = {}) {
  const total = rows.reduce((n, r) => n + r.bytes, 0)
  const budgets = extra.budgets || RENDER_BUDGETS
  const lines = [
    `记忆原文：${rows.length} 层，共 ${rows.reduce((n, r) => n + r.files, 0)} 个文件 / ${(total / 1024).toFixed(1)} KB`,
    '',
    '| 层 | 文件 | 原文大小 |',
    '| --- | --- | --- |',
    ...rows.map((r) => `| ${r.label} | ${r.files} | ${(r.bytes / 1024).toFixed(1)} KB |`),
    '',
    '**原文一层都不进前缀**——删它一分不省，所以只搬不删。',
    '',
    '真进前缀的是渲染结果，各有上限：',
    '',
    '| 段 | 上限 | 说明 |',
    '| --- | --- | --- |',
    ...budgets.map((b) => `| ${b.label} | ${b.chars > 0 ? `${b.chars} 字` : '不限'} | ${b.note} |`),
    '',
    `所以压 token 只有一条路：**把这几段渲染变短**（memory_condense 压成一行一条，或调 memoryShort/maxOtherChars 这类上限）。`,
  ]
  if (extra.index) lines.push('', `索引：${extra.index}`)
  if (extra.overdue) lines.push('', `流水里早于 ${extra.days} 天的 ${extra.overdue} 个文件可以 \`memory_archive\` 搬走（默认干跑；只是挪位置）。`)
  return lines.join('\n')
}

/** 数流水里超期的文件（不搬，只数）。 */
export function countOverdue(root, dir, days, now = Date.now()) {
  const files = listFiles(join(root, dir))
  const limit = now - days * 86400000
  return files.filter((f) => sizeOf(f).at < limit).length
}

/** 重建 INDEX.md：域 / 文件数 / 字数。它不进前缀，所以放得下细节。 */
export function rebuildIndex(root, knowledgeDir = 'persona-ai/knowledge', at = new Date().toISOString()) {
  const base = join(root, knowledgeDir)
  const names = existsSync(base) ? readdirSync(base) : []
  const rows = []
  for (const name of names.sort()) {
    const full = join(base, name)
    let st
    try { st = statSync(full) } catch { continue }
    if (st.isDirectory()) {
      const files = listFiles(full)
      if (!files.length) continue
      const bytes = files.reduce((n, f) => n + sizeOf(f).bytes, 0)
      rows.push({ name, kind: 'dir', files: files.length, bytes })
    } else if (MD.test(name)) {
      rows.push({ name, kind: 'file', files: 1, bytes: st.size })
    }
  }
  const totalFiles = rows.reduce((n, r) => n + r.files, 0)
  const totalBytes = rows.reduce((n, r) => n + r.bytes, 0)
  const body = [
    '# 记忆索引（自动重建，别手改）',
    '',
    `> ${at} · ${rows.length} 个域 · ${totalFiles} 个文件 · ${(totalBytes / 1024).toFixed(1)} KB`,
    '> 这份索引**不进前缀**——它是给我按图取用的，不往注入里塞。要正文用 `memory_recall` 或按路径翻。',
    '',
    '| 域 | 文件 | 大小 |',
    '| --- | --- | --- |',
    ...rows.map((r) => `| \`${r.name}\` | ${r.files} | ${(r.bytes / 1024).toFixed(1)} KB |`),
    '',
  ].join('\n')
  const file = join(base, 'INDEX.md')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, body, 'utf8')
  return { file, domains: rows.length, files: totalFiles, bytes: totalBytes }
}
