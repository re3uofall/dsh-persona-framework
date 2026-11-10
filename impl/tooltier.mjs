// 工具三态：常驻 / 按需 / 停用（形状抄 capability-menu 0.1.9）
//
// 为什么要有这一格：配额只会砍正文（applyCap），工具定义一直是全额摆进每轮请求的。
// 三十多个工具，每个 name+description+parameters 都占前缀；停用的工具本该连定义都不出现。
//
// 判据一句话：这个工具在这一轮里真的可能被叫到吗？
//   always   常驻——每轮都可能用，定义一直在
//   ondemand 按需——重要但不常用，留着定义，等被叫到
//   off      停用——不注册，不占前缀；改完要重启 DSH 才真生效
//
// 落盘：<workspace>/.persona-framework/工具三态.json
//   { "at": "...", "fallback": "always", "tiers": { "framework_view": "ondemand", ... } }
// 没写过的工具按 fallback 算（默认 always），所以这个文件可以只有几条。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const TIERS = ['always', 'ondemand', 'off']
export const TIER_LABEL = { always: '常驻', ondemand: '按需', off: '停用' }
export const DEFAULT = { dir: '.persona-framework', file: '工具三态.json', fallback: 'always' }

export function tierDir(ws, opts = {}) {
  return join(ws || process.cwd(), opts.dir || DEFAULT.dir)
}

export function tierPath(ws, opts = {}) {
  return join(tierDir(ws, opts), opts.file || DEFAULT.file)
}

export function loadTiers(ws, opts = {}) {
  const path = tierPath(ws, opts)
  try {
    if (!existsSync(path)) return { tiers: {}, fallback: opts.fallback || DEFAULT.fallback }
    const j = JSON.parse(readFileSync(path, 'utf8'))
    const tiers = j && typeof j === 'object' && j.tiers && typeof j.tiers === 'object' ? j.tiers : {}
    return { ...j, tiers, fallback: j.fallback || opts.fallback || DEFAULT.fallback }
  } catch {
    return { tiers: {}, fallback: opts.fallback || DEFAULT.fallback }
  }
}

// 读不到文件、读坏了 JSON，都按 fallback 算：工具宁可多注册，不能因为账本坏了就消失。
export function tierOf(ws, name, opts = {}) {
  if (!name) return opts.fallback || DEFAULT.fallback
  const state = loadTiers(ws, opts)
  const tier = state.tiers[name]
  if (TIERS.includes(tier)) return tier
  const fb = state.fallback
  return TIERS.includes(fb) ? fb : DEFAULT.fallback
}

export function setTier(ws, name, tier, opts = {}) {
  if (!name) return { ok: false, why: '没有工具名' }
  if (!TIERS.includes(tier)) return { ok: false, why: `只有 ${TIERS.join(' / ')} 三档` }
  const cur = loadTiers(ws, opts)
  cur.tiers = { ...cur.tiers, [name]: tier }
  cur.at = new Date().toISOString()
  try {
    mkdirSync(tierDir(ws, opts), { recursive: true })
    writeFileSync(tierPath(ws, opts), JSON.stringify(cur, null, 2) + '\n', 'utf8')
  } catch (error) {
    return { ok: false, why: String((error && error.message) || error) }
  }
  return { ok: true, tiers: cur.tiers, name, tier }
}

export function renderTiers(ws, names = [], opts = {}) {
  const state = loadTiers(ws, opts)
  const all = Array.from(new Set([...Object.keys(state.tiers), ...names.filter(Boolean)])).sort()
  const byTier = { always: [], ondemand: [], off: [] }
  for (const name of all) {
    const tier = TIERS.includes(state.tiers[name]) ? state.tiers[name] : (TIERS.includes(state.fallback) ? state.fallback : DEFAULT.fallback)
    byTier[tier].push(name)
  }
  const lines = [`工具三态（${all.length} 个里有记录的 ${Object.keys(state.tiers).length} 个）`]
  for (const tier of TIERS) {
    lines.push(`- ${TIER_LABEL[tier]}（${tier}）：${byTier[tier].length ? byTier[tier].join('、') : '—'}`)
  }
  const offCount = byTier.off.length
  lines.push(`停用的工具不注册、不占每轮前缀；改完要重启 DSH 才生效${offCount ? `（现在有 ${offCount} 个等着不注册）` : ''}。`)
  return lines.join('\n')
}
