/**
 * 审计留痕：写、改、拒都记一笔。
 *
 * 抄灵枢的 `audit.py`（688 行）的精神，不抄它的实现：它做的是事件溯源的完整账，
 * 我这边只要一件事——**被挡下来的那些也要留痕**。
 *
 * 为什么：现在只有结果是可查的（文件在不在），过程不可查。
 * 我自己拦下过什么、为什么拦，全无痕；下一次同一个念头再来，我也拦不住第二次。
 *
 * 三条规矩：
 *   1. 只追加，不改旧行——留痕要是能改，就不叫留痕。
 *   2. 拒也要记：decision=deny / require_review 的行跟 allow 一样进账。
 *   3. 记「为什么」不记「看起来像什么」：why 写判据，不写感想。
 */
import { appendJsonl, readJsonl, nowIso } from './ledger.mjs'

const FILE = 'audit.jsonl'

/** 记一笔。op 例如 write / condense / reject / link；decision 是 allow / require_review / deny。 */
export function record(root, { op, path = '', decision = 'allow', why = '', by = 'memory' } = {}) {
  const row = {
    at: nowIso(),
    op: String(op || 'unknown'),
    path: String(path).slice(0, 300),
    decision,
    why: String(why).slice(0, 400),
    by,
  }
  appendJsonl(root, FILE, row)
  return row
}

export function allRecords(root) {
  return readJsonl(root, FILE)
}

/** 只看被挡下的（deny / require_review）——这是这份账最值钱的部分。 */
export function blocked(root) {
  return allRecords(root).filter((r) => r.decision === 'deny' || r.decision === 'require_review')
}

export function renderAudit(root, limit = 30) {
  const all = allRecords(root)
  if (!all.length) return '（还没有审计记录）'
  const shown = all.slice(-Math.max(1, limit))
  const denied = all.filter((r) => r.decision !== 'allow').length
  const lines = [`审计：共 ${all.length} 条，其中被挡/要补复核 ${denied} 条。最近 ${shown.length} 条：`, '']
  for (const r of shown) {
    lines.push(`- ${r.at} · ${r.op} · ${r.decision}${r.path ? ` · ${r.path}` : ''}${r.why ? ` — ${r.why}` : ''}`)
  }
  return lines.join('\n')
}

export function renderBlocked(root, limit = 20) {
  const list = blocked(root).slice(-Math.max(1, limit))
  if (!list.length) return '没有挡下过任何东西——要么真没挡过，要么这门禁还没装上。'
  return ['被挡下/要补复核的：', '']
    .concat(list.map((r) => `- ${r.at} · ${r.op}${r.path ? ` · ${r.path}` : ''} — ${r.why}`))
    .join('\n')
}
