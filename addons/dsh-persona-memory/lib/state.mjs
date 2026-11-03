/**
 * 状态台账：记「这个信念从什么变成什么」。
 *
 * 抄灵枢的世界模型功能端（`docs/mdcg/世界模型功能端_使用与运维_v1.0.md`）：
 * 它管的东西跟名字给人的印象不一样——不是「想象一个世界」，是**记状态变化**。
 *
 * 为什么需要：审计记的是「做了什么动作」，边记的是「两条记忆什么关系」，
 * 都不回答「我现在凭什么相信这个、它改过几次」。改口说了一百遍，
 * 留下的只有改完的那一句话，中间怎么变的没人知道。
 *
 * 一行一条：
 *   {t, subject, slot, old, new, kind, evidence, actor}
 *   kind 五种：migration 迁移 / retraction 撤回 / enablement 启用 /
 *              acquisition 获得 / replacement 替换
 * 只追加，不截断——它原话是「滚动窗口不能当一手记录」，所以要单独一本。
 */
import { appendJsonl, readJsonl, nowIso } from './ledger.mjs'

const FILE = 'state_events.jsonl'

export const KINDS = ['migration', 'retraction', 'enablement', 'acquisition', 'replacement']

/** 给人看的中文名。存的是英文，显示的是中文——存的是判据，看的是人话。 */
const KIND_ZH = {
  migration: '迁移',
  retraction: '撤回',
  enablement: '启用',
  acquisition: '获得',
  replacement: '替换',
}

/** 从 old/new 推变化类型。推不出就返回 null（不猜）。 */
export function inferKind(old, next) {
  const hasOld = old !== undefined && old !== null && old !== ''
  const hasNew = next !== undefined && next !== null && next !== ''
  if (hasOld && !hasNew) return 'retraction' // 有旧无新 = 作废
  if (!hasOld && hasNew) return 'enablement' // 无旧有新 = 启用
  if (hasOld && hasNew) return 'migration' // 都有 = 迁移（replacement 要显式给）
  return null
}

/**
 * 记一次状态变化。
 * @param {object} o
 * @param {string} o.subject 变化的主体（例如「框架插件的开关」）
 * @param {string} [o.slot] 哪一个槽（同一个主体可以有多个槽，默认 default）
 * @param {*} [o.old] 旧值
 * @param {*} [o.new] 新值
 * @param {string} [o.kind] 变化类型；不给就按 old/new 推
 * @param {string} [o.evidence] 证据（原话、指针、截图路径）
 * @param {string} [o.actor] 谁改的
 */
export function recordState(root, { subject, slot = 'default', old = null, new: next = null, kind = null, evidence = '', actor = 'me' } = {}) {
  if (!subject) throw new Error('状态变化要有主体（subject）')
  const k = kind || inferKind(old, next)
  if (!k) throw new Error('推不出变化类型：old 和 new 不能都空；要 replacement 就显式给 kind')
  if (!KINDS.includes(k)) throw new Error(`kind 只能是 ${KINDS.join(' / ')}`)
  const seq = readJsonl(root, FILE).filter((e) => e.subject === subject && e.slot === slot).length + 1
  const row = {
    t: nowIso(),
    subject: String(subject),
    slot: String(slot),
    old: old === undefined ? null : old,
    new: next === undefined ? null : next,
    kind: k,
    seq,
    evidence: String(evidence || '').slice(0, 400),
    actor,
  }
  appendJsonl(root, FILE, row)
  return row
}

/** 某对象某槽现在是什么（重放所有事件，取最后一个非撤回的值）。 */
export function stateOf(root, subject, slot = 'default') {
  const list = readJsonl(root, FILE).filter((e) => e.subject === subject && e.slot === slot)
  let value = null
  for (const e of list) {
    if (e.kind === 'retraction') value = null
    else if (e.new !== null && e.new !== undefined) value = e.new
  }
  return { value, changes: list.length }
}

/** 某对象的状态链（按时间）。 */
export function chainOf(root, subject) {
  return readJsonl(root, FILE).filter((e) => e.subject === subject)
}

export function subjects(root) {
  return [...new Set(readJsonl(root, FILE).map((e) => e.subject))]
}

export function renderState(root, subject) {
  if (!subject) {
    const all = subjects(root)
    if (!all.length) return '状态台账还是空的。'
    return ['状态台账里的对象：', ''].concat(all.map((s) => `- ${s}`)).join('\n')
  }
  const list = chainOf(root, subject)
  if (!list.length) return `「${subject}」没有状态记录。`
  const lines = [`「${subject}」改了 ${list.length} 次：`, '']
  for (const e of list) {
    const o = e.old === null || e.old === '' ? '（无）' : JSON.stringify(e.old)
    const n = e.new === null || e.new === '' ? '（无）' : JSON.stringify(e.new)
    lines.push(`- 第 ${e.seq} 次 · ${KIND_ZH[e.kind] || e.kind} · ${o} → ${n}${e.evidence ? ` · 证据：${e.evidence}` : ''}`)
  }
  const now = stateOf(root, subject, list[0].slot)
  lines.push('', `现在：${now.value === null ? '（作废了）' : JSON.stringify(now.value)}`)
  return lines.join('\n')
}
