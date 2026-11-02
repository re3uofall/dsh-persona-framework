/**
 * dsh-persona-memory · 可调项白名单
 * ============================================================================
 * 设置页能改的字段，只有这一张表里的。
 * 表外的一律不收——防止界面写坏一个键，把插件跑挂。
 *
 * 为什么白名单不写「全部 config」：config schema 是插件启动时定死的，
 * 但里面有几项（root / judgmentDir / journalDir / longTermDir）是路径，
 * 写成界面输入框，用户改错一个字，记忆就指到空目录去了。
 * 路径归「装的人」管，归 cordis 配置；不归设置页。
 * ============================================================================
 */

export const SETTINGS_FILE = '记忆配置.json'
export const SETTINGS_DIR = '.persona-framework'

/** 设置页能改的字段：键 → 取数规则 */
export const EDITABLE = {
  budget: { kind: 'int', min: 200, max: 20000 },
  injectShortDays: { kind: 'int', min: 1, max: 60 },
  shortBudgetChars: { kind: 'int', min: 2000, max: 400000 },
  nowGapMinutes: { kind: 'int', min: 5, max: 240 },
  injectTemp: { kind: 'bool' },
  injectNow: { kind: 'bool' },
  injectOrder: { kind: 'int', min: 1, max: 999 },
  archiveAfterDays: { kind: 'int', min: 1, max: 365 },
  journalShare: { kind: 'num', min: 0, max: 1 },
  maxInjectChars: { kind: 'int', min: 2000, max: 400000 },
  dryRunDefault: { kind: 'bool' },
  hint: { kind: 'bool' },
  reinforce: { kind: 'bool' },
}

/** 界面上每一行长什么样（服务端报给前端，前端只管画） */
export const FIELDS = [
  {
    group: '短期记忆',
    rows: [
      { key: 'injectShortDays', label: '取最近几天', unit: '天', hint: '闸是天数，不是字数。' },
      { key: 'shortBudgetChars', label: '字数预算', unit: '字', hint: '按字数从最新往回切，不按条数平分。' },
      { key: 'injectTemp', label: '短期注入', toggle: true, hint: '关掉 = 短期这一格不进上下文（仍留在盘上）。' },
    ],
  },
  {
    group: '即时记忆',
    rows: [
      { key: 'nowGapMinutes', label: '分段间隔', unit: '分钟', hint: '两轮之间停这么久，算这一段结束，转给短期。' },
      { key: 'injectNow', label: '即时注入', toggle: true, hint: '关掉 = 这一段不逐字摆进来。' },
    ],
  },
  {
    group: '注入顺序',
    rows: [
      { key: 'injectOrder', label: '基准序号', hint: '即时=它，短期=它+15，其他记忆=它+20；人格原文件在 20/22。' },
      { key: 'maxInjectChars', label: '防爆上限', unit: '字', hint: '超了会截断并写明。正常天数下不该碰到。' },
      { key: 'hint', label: '「记忆池怎么用」那段', toggle: true },
    ],
  },
  {
    group: '检索与归档',
    rows: [
      { key: 'budget', label: 'recall 默认预算', unit: '字' },
      { key: 'journalShare', label: '流水层占比上限', hint: '0–1。流水不是记忆，只分到很少的预算。' },
      { key: 'archiveAfterDays', label: '超过几天归档', unit: '天' },
      { key: 'reinforce', label: '加固参与排序', toggle: true, hint: '只改先后，不动字节。' },
      { key: 'dryRunDefault', label: '提炼／归档默认干跑', toggle: true },
    ],
  },
]

function int(v, min, max) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return null
  if (n < min || n > max) return null
  return n
}

function num(v, min, max) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  if (n < min || n > max) return null
  return n
}

/**
 * 把界面递来的一团东西收成干净的一份。
 * 只收白名单里、且过得了范围的；过的留下，过的不要的不收（不报错——界面可能整份回传）。
 */
export function normalizePatch(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [key, rule] of Object.entries(EDITABLE)) {
    if (!(key in raw)) continue
    const v = raw[key]
    if (rule.kind === 'bool') {
      if (typeof v === 'boolean') out[key] = v
      else if (v === 'on' || v === 'yes' || v === 1) out[key] = true
      else if (v === 'off' || v === 'no' || v === 0) out[key] = false
      continue
    }
    const n = rule.kind === 'int' ? int(v, rule.min, rule.max) : num(v, rule.min, rule.max)
    if (n != null) out[key] = n
  }
  return out
}

/** 盘上读出来的东西可能是任何垃圾；读不动的就当没有 */
export function normalizeStored(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return normalizePatch(raw)
}

/** 只把白名单里、当前真在用的值挑出来，报给界面 */
export function pickCurrent(cfg) {
  const out = {}
  for (const key of Object.keys(EDITABLE)) {
    if (cfg && key in cfg) out[key] = cfg[key]
  }
  return out
}
