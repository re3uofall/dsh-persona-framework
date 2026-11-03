/**
 * 一致性检查：把「已经被证伪的说法」跟「新写下的记忆」对一遍。
 *
 * 抄灵枢 `stg.consistency` 的一句话：记忆之间会打架，得有东西去查。
 * 它查的是图上的冲突；我这边没有图，就查最实的一种：
 * **负记忆里判过死刑的说法，是不是又被当成新发现写了一遍。**
 *
 * 这是最容易犯、也最丢人的一种错——不是不知道，是知道过又忘了。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { looksRejected } from './rejected.mjs'

function recentFiles(root, dir, n = 5) {
  const d = join(root, dir)
  if (!existsSync(d)) return []
  try {
    return readdirSync(d)
      .filter((f) => f.endsWith('.md') && /^\d{4}-\d{2}-\d{2}/.test(f))
      .sort()
      .slice(-n)
      .map((f) => ({ name: f, path: join(d, f), text: readFileSync(join(d, f), 'utf8') }))
  } catch {
    return []
  }
}

/**
 * 查一遍。返回 [{file, line, rejectedBy}]。
 * 只认字面：宁可漏，不可乱认——把没被证伪的判成被证伪，比不查更坏。
 */
export function check(root) {
  const hits = []
  for (const dir of ['persona-ai/knowledge/chat', 'persona-ai/knowledge/session']) {
    for (const f of recentFiles(root, dir)) {
      for (const line of f.text.split('\n')) {
        const t = line.trim()
        if (t.length < 8) continue
        const by = looksRejected(root, t)
        if (by) hits.push({ file: f.name, line: t.slice(0, 120), rejectedBy: by })
      }
    }
  }
  return hits
}

export function renderConsistency(root) {
  const hits = check(root)
  if (!hits.length) return '查过了：最近的记忆里，没有把已经被证伪的说法又写一遍。'
  const lines = [`查到 ${hits.length} 处「已经证伪过、又写了一遍」：`, '']
  for (const h of hits.slice(0, 20)) {
    lines.push(`- ${h.file}：${h.line}`)
    lines.push(`  ↳ 负记忆里判过：${h.rejectedBy}`)
  }
  return lines.join('\n')
}
