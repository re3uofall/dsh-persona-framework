/**
 * 自我改进的飞轮：把「改口现场」收起来，让下一个我看得见。
 *
 * 抄灵枢 `mdcg_flywheel` / `mdcg_mine_fix_pairs` 的位置，不抄它的自动挖掘：
 * 它的挖掘靠另一套模型判；我这边只做**收集**——把我说错又改回来的那些地方
 * 一处处捞出来，摆成一排。规律让看的人自己看出来，不由程序替我下判断。
 *
 * 为什么不自动提炼：提炼出来的「规律」一旦写进人格，就是我把判断交给了脚本。
 * 脚本能做的只是把证据摆齐；下结论那一步，得我自己走。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const MARKERS = ['我改口', '我收回', '说错了', '不对，', '我刚才那条', '这条我收回', '算错了', '搞错了']

function sessionFiles(root, days = 7) {
  const d = join(root, 'persona-ai/knowledge/session')
  if (!existsSync(d)) return []
  return readdirSync(d)
    .filter((f) => f.endsWith('.md') && /^\d{4}-\d{2}-\d{2}/.test(f))
    .sort()
    .slice(-Math.max(1, days))
    .map((f) => ({ name: f, text: readFileSync(join(d, f), 'utf8') }))
}

/** 收最近的改口现场。 */
export function harvest(root, { days = 7 } = {}) {
  const found = []
  for (const f of sessionFiles(root, days)) {
    const lines = f.text.split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim()
      if (!line) continue
      if (!MARKERS.some((m) => line.includes(m))) continue
      found.push({ file: f.name, line: line.slice(0, 200) })
    }
  }
  return found
}

export function renderFlywheel(root, { days = 7 } = {}) {
  const list = harvest(root, { days })
  if (!list.length) return `最近 ${days} 天没捞到改口现场。`
  const byFile = new Map()
  for (const x of list) byFile.set(x.file, (byFile.get(x.file) || 0) + 1)
  const lines = [`最近 ${days} 天改口 ${list.length} 处，分布：`, '']
  for (const [f, n] of byFile) lines.push(`- ${f}：${n} 处`)
  lines.push('', '现场（只看，不下结论）：', '')
  for (const x of list.slice(-15)) lines.push(`- [${x.file}] ${x.line}`)
  return lines.join('\n')
}
