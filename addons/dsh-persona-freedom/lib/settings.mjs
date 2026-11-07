/**
 * lib/settings.mjs —— 自由度的四个旋钮
 * ============================================================================
 * 一个问题：凭什么让它自己排、自己开电脑、自己挑事？
 * 答案不是一个开关，是四个旋钮，且**默认都偏保守**。
 *
 *   level       自由度 0..1：0 = 只记不排；0.5 = 照模板提醒但不替我改；1 = 可以自己加弹性事
 *   autoPlan    每天要不要把模板算一遍并注一行「今天长什么样」
 *   maxPerDay   一天最多自己加几条（不是最多提几条）
 *   activities  自由活动的内容：闲着的时候可以干什么（不排进日程，只当候选）
 *   vmName      自由空间那台机器叫什么
 * ============================================================================
 */
export const FREEDOM_LEVELS = [
  { v: 0, key: 'record', label: '只记', hint: '只往单子上记，不提醒、不排表' },
  { v: 0.5, key: 'suggest', label: '提醒', hint: '到点提一句、可以算今天长什么样，但不替人改单子' },
  { v: 1, key: 'arrange', label: '自排', hint: '可以自己往单子上加弹性事（每次都会落账）' },
]

export const DEFAULT_SETTINGS = {
  level: 0.5,
  autoPlan: true,
  maxPerDay: 3,
  activities: ['写代码', '读一篇原文', '整记忆', '试插件', '散步', '发呆'],
  vmName: 'DSH-Space',
}

export function normalizeLevel(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.level
  if (n <= 0.25) return 0
  if (n >= 0.75) return 1
  return 0.5
}

export function normalizeActivities(list) {
  const arr = Array.isArray(list) ? list : String(list || '').split(/[,，、\n]/)
  const out = []
  for (const a of arr) {
    const t = String(a || '').trim()
    if (t && t.length <= 40 && !out.includes(t)) out.push(t)
    if (out.length >= 12) break
  }
  return out.length ? out : DEFAULT_SETTINGS.activities.slice()
}

export function normalizePatch(raw) {
  const o = (raw && typeof raw === 'object' && raw) || {}
  const out = {}
  if (o.level !== undefined) out.level = normalizeLevel(o.level)
  if (o.autoPlan !== undefined) out.autoPlan = o.autoPlan === true || o.autoPlan === 'true'
  if (o.maxPerDay !== undefined) {
    const n = Math.round(Number(o.maxPerDay))
    out.maxPerDay = Number.isFinite(n) ? Math.min(9, Math.max(0, n)) : DEFAULT_SETTINGS.maxPerDay
  }
  if (o.activities !== undefined) out.activities = normalizeActivities(o.activities)
  if (o.vmName !== undefined) {
    const s = String(o.vmName || '').trim()
    out.vmName = /^[A-Za-z0-9._-]{1,40}$/.test(s) ? s : DEFAULT_SETTINGS.vmName
  }
  return out
}

export function pickCurrent(stored) {
  const s = { ...DEFAULT_SETTINGS, ...(stored && typeof stored === 'object' ? stored : {}) }
  s.level = normalizeLevel(s.level)
  s.maxPerDay = Math.min(9, Math.max(0, Math.round(Number(s.maxPerDay) || 0)))
  s.activities = normalizeActivities(s.activities)
  return s
}

export function levelLabel(level) {
  const l = FREEDOM_LEVELS.find((x) => x.v === normalizeLevel(level))
  return l ? l.label : '提醒'
}

/** 给设置页用：一页四组。 */
export function fieldTable() {
  return [
    {
      key: 'level',
      label: '自由度',
      hint: '0 只记、0.5 提醒、1 可以自己加事',
      options: FREEDOM_LEVELS.map((l) => ({ value: l.v, label: `${l.label}（${l.hint}）` })),
    },
    { key: 'autoPlan', label: '每天早上算一遍今天长什么样', hint: '注一行骨架，不替你排事', type: 'boolean' },
    { key: 'maxPerDay', label: '一天最多自己加几条', hint: '0–9，只对「自排」档有用', type: 'number', min: 0, max: 9 },
    { key: 'activities', label: '自由活动的内容', hint: '闲着可以干什么，一行一个；不排进日程，只当候选', type: 'list' },
    { key: 'vmName', label: '自由空间那台机器', hint: 'VirtualBox 里的名字，默认 DSH-Space', type: 'text' },
  ]
}
