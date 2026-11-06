/**
 * 电源模式：照电脑那一套（高性能 / 平衡 / 节能 / 超长续航）。
 * ============================================================================
 * 它只写一份「配额」，不直接砍别人的字 —— 谁产那段字，谁自己来读。
 *   落在：`<工作区>/.persona-framework/注入配额.json`
 *   读它的是：框架插件、记忆插件（各自读，不互相 import）
 *   读不到：按原样全量，什么都不坏
 *
 * 档位怎么来：
 *   mode = 'auto'  → 看电量档（full/normal/slim/minimal）自己选
 *   mode = 具体档  → 钉死，电量再低也不改口（我自己说的算）
 * ============================================================================
 */

export const MODES = [
  { key: 'high', label: '高性能', hint: '一样不少：人格、框架、索引、模块正文、短期记忆全摆' },
  { key: 'balanced', label: '平衡', hint: '默认：人格与框架全文，索引只到编号，模块摆一篇' },
  { key: 'saver', label: '节能', hint: '人格与框架截短，索引只留标题，短期记忆只留最近几条' },
  { key: 'ultra', label: '超长续航', hint: '只留固定注入与任务本身：正文、索引、短期记忆都不摆' },
]

export const MODE_KEYS = ['auto', ...MODES.map((m) => m.key)]

/** 电量档 → 电源档。auto 就照这条表走。 */
export const AUTO_BY_LEVEL = {
  full: 'high',
  normal: 'balanced',
  slim: 'saver',
  minimal: 'ultra',
}

/**
 * 每份内容的字数上限（0 或 null = 不限）。
 * 键名是「哪一份」，不是「哪个插件」——插件换名字也不用改这里。
 */
/** 0 = 不限，负数 = 这一份不摆，正数 = 最多这么多字。 */
const CAPS = {
  high: { personality: 0, framework: 0, moduleIndex: 0, moduleBody: 0, memoryShort: 0, memoryLong: 0, live: 1200 },
  balanced: { personality: 0, framework: 0, moduleIndex: 9000, moduleBody: 0, memoryShort: 20000, memoryLong: 0, live: 1200 },
  saver: { personality: 6000, framework: 4000, moduleIndex: 2000, moduleBody: 2500, memoryShort: 6000, memoryLong: 800, live: 600 },
  ultra: { personality: 3000, framework: -1, moduleIndex: -1, moduleBody: -1, memoryShort: -1, memoryLong: -1, live: 300 },
}

export const CAP_LABELS = {
  personality: '人格文件',
  framework: '框架正文',
  moduleIndex: '模块索引',
  moduleBody: '模块正文',
  memoryShort: '短期记忆',
  memoryLong: '长期记忆',
  live: '实时注入',
}

export function capsOf(mode) {
  return { ...(CAPS[mode] || CAPS.balanced) }
}

export function modeLabel(mode) {
  const m = MODES.find((x) => x.key === mode)
  return m ? m.label : '自动'
}

/** 钉死的模式 + 电量档 → 这一轮真按哪一档走。 */
export function effectiveMode(pinned, level) {
  if (pinned && pinned !== 'auto' && CAPS[pinned]) return pinned
  return AUTO_BY_LEVEL[level] || 'balanced'
}

export function normalizeMode(v) {
  const s = String(v ?? '').trim().toLowerCase()
  return MODE_KEYS.includes(s) ? s : ''
}

export function buildQuota({ mode, level, at }) {
  const eff = effectiveMode(mode, level)
  return {
    mode: mode || 'auto',
    effective: eff,
    level,
    at: at || new Date().toISOString(),
    caps: capsOf(eff),
    note: '由 dsh-persona-energy 写；读了它也不许坏，读不到就全量',
  }
}

export function describeQuota(q) {
  if (!q || !q.caps) return '配额还没写过：一切按全量摆。'
  const lines = [
    `电源模式：${modeLabel(q.mode === 'auto' ? q.effective : q.mode)}` +
      (q.mode === 'auto' ? `（自动，照电量档 ${q.level}）` : '（钉死）'),
  ]
  for (const [k, label] of Object.entries(CAP_LABELS)) {
    const v = q.caps[k]
    lines.push(`　${label}：${v < 0 ? '不摆' : v > 0 ? `最多 ${v} 字` : '不限'}`)
  }
  return lines.join('\n')
}

/** 给实时环境那一行用的极短版本，别占地方。 */
export function briefQuota(q) {
  if (!q || !q.caps) return ''
  const eff = q.effective || 'balanced'
  const tag = q.mode === 'auto' ? `自动→${modeLabel(eff)}` : modeLabel(eff)
  return `电源 ${tag}`
}
