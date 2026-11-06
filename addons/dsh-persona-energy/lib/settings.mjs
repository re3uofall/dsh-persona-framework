/**
 * 设置：给装的人自己调，不用改代码。
 * ============================================================================
 * 写在哪：`<工作区>/.persona-framework/能量配置.json`
 * 谁能改：设置页那一栏（白名单字段，写前留 .bak）；或直接编辑那个文件。
 *
 * ★ 只放「可调的行为」，不放路径。工作区与 stateDir 一旦写错一个字符，
 *   账就落到别的目录去了，症状是「插件在跑，但电量和 token 账都是空的」。
 * ============================================================================
 */

export const GROUPS = [
  {
    group: '提醒',
    rows: [
      {
        key: 'remind', toggle: true, label: '电量低了说一句',
        hint: '关掉它就彻底安静：账还照记、工具还照用，只是不再往上下文里塞那一行。',
      },
      {
        key: 'hintEveryMinutes', label: '低档多久念一次', unit: '分钟',
        hint: '只在「已经在低档」时起作用；掉档那一下永远当场说。默认 30 分钟。',
      },
    ],
  },
  {
    group: '自动记账',
    rows: [
      {
        key: 'autoRestMinutes', label: '隔多久算在歇', unit: '分钟',
        hint: '两步之间隔这么久，就自动记一笔「歇」——一口气会在这段时间里回一点。默认 10 分钟。',
      },
    ],
  },
  {
    group: 'Token 账',
    rows: [
      {
        key: 'costHours', label: '默认看最近多少小时', unit: '小时',
        hint: 'energy_cost 不传 hours 时用它；0 = 整个会话从头上算。默认 24。',
      },
    ],
  },
]

/** 字段表拍平，给「读当前值」和「白名单」共用一份。 */
const FLAT = GROUPS.flatMap((g) => g.rows)

export const DEFAULTS = {
  remind: true,
  hintEveryMinutes: 30,
  autoRestMinutes: 10,
  costHours: 24,
}

const RANGE = {
  hintEveryMinutes: [5, 1440],
  autoRestMinutes: [1, 720],
  costHours: [0, 8760],
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
