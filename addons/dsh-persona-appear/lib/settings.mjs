/**
 * 设置：给装的人自己调，不用改代码。
 * ============================================================================
 * 写在哪：`<工作区>/.persona-framework/出现配置.json`
 * 谁能改：设置页那一栏（白名单字段，写前留 .bak）；或直接编辑那个文件。
 *
 * ★ 只放「可调的行为」，不放路径。路径（工作区、stateDir）留在这里只会被写错——
 *   写错一个字符，闸文件和实时注入就指到空目录去了，症状是「插件在跑但什么都不发生」。
 * ============================================================================
 */

export const GROUPS = [
  {
    group: '实时注入',
    rows: [
      {
        key: 'liveOn', toggle: true, label: '开着实时注入',
        hint: '关掉以后，那三个工具还在，但盘上的字不会进上下文——等于只留一个记事本。',
      },
      {
        key: 'liveMinutes', label: '一条活多久', unit: '分钟',
        hint: '到时间自己撤，不用手动清。默认 30 分钟。',
      },
      {
        key: 'liveMaxChars', label: '单条最多多少字', unit: '字',
        hint: '超了就截，不是拒绝——写太长的实时候自己会看到截断。默认 1200。',
      },
    ],
  },
  {
    group: '省 token',
    rows: [
      {
        key: 'noteSteps', toggle: true, label: '记「这一轮第几步」',
        hint: '开着才谈得上「全量只注第一步」。关掉等于每步都从头来——省不了，但也不会因为钩子出问题。',
      },
    ],
  },
]

/** 字段表拍平，给「读当前值」和「白名单」共用一份。 */
const FLAT = GROUPS.flatMap((g) => g.rows)

export const DEFAULTS = {
  liveOn: true,
  liveMinutes: 30,
  liveMaxChars: 1200,
  noteSteps: true,
}

const RANGE = {
  liveMinutes: [1, 1440],
  liveMaxChars: [100, 8000],
}

/** 只有这几个键能写进来。写坏的字段丢掉，不让它把插件跑挂。 */
export function normalizePatch(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  for (const f of FLAT) {
    if (!(f.key in raw)) continue
    const v = raw[f.key]
    if (f.toggle) {
      if (typeof v === 'boolean') out[f.key] = v
      else if (v === 'true' || v === 'false') out[f.key] = v === 'true'
      continue
    }
    const n = Number(v)
    if (!Number.isFinite(n)) continue
    const [lo, hi] = RANGE[f.key] || [0, Number.MAX_SAFE_INTEGER]
    out[f.key] = Math.min(hi, Math.max(lo, Math.round(n)))
  }
  return out
}

/** 读回来的（可能是旧文件、可能被手改坏）也要过一遍白名单。 */
export function normalizeStored(raw) {
  return normalizePatch(raw)
}

export function pickCurrent(cfg) {
  const out = {}
  for (const f of FLAT) out[f.key] = cfg[f.key] ?? DEFAULTS[f.key]
  return out
}

/** 给设置页的字段表：分组 + 每行的说明，原样递出去。 */
export function fieldTable() {
  return GROUPS.map((g) => ({
    group: g.group,
    rows: g.rows.map((r) => ({
      key: r.key, label: r.label, hint: r.hint || '', unit: r.unit || '',
      toggle: !!r.toggle,
    })),
  }))
}
