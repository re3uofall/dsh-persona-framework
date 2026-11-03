/**
 * dsh-persona-appear · 闸的纯函数
 * ============================================================================
 * 一句话：决定**哪一个插件**这一轮出现、哪一个不出现。
 *
 * 为什么粒度是「插件」而不是「会话」：
 * 人格不是一家给的一个块。它是两部分——
 *   ① 人格本身（人格文件、补丁、证据）
 *   ② 随人格的其他内容（记忆、框架、日记、探索、成果）
 * 六家各注册各的 `systemPrompt.section`，各有各的包名。名字在装的时候就定死了，
 * 所以「让谁出场」问的是**哪一个插件**，不是「哪一个会话」——不用猜键，也不用等宿主给。
 *
 * 状态文件：<workspace>/.persona-framework/出现.json
 *   { "global": "on", "plugins": { "dsh-persona-framework": "off" }, "note": "" }
 *
 * 本文件只管三样：读成对象、判一家出不出场、只增删名单。
 * ============================================================================
 */

export const STATE_FILE = '出现.json'

/** 往上下文里塞东西的那几家：包名 → 人话名 */
export const INJECTORS = {
  'dsh-persona-grow': '人格自学',
  'dsh-persona-memory': '记忆分层',
  'dsh-persona-framework': '人格框架',
  'dsh-persona-diary': '日记',
  'dsh-persona-explore': '碗外探索',
  'dsh-persona-results': '思考成果',
}

/** 人格的两部分：关之前，得说得出关的是哪一半 */
export const PARTS = {
  'dsh-persona-grow': '人格本身（人格文件、补丁、证据）',
  'dsh-persona-memory': '随人格（记忆：即时／短期／长期／其他）',
  'dsh-persona-framework': '随人格（框架：骨架、模块库、触发器）',
  'dsh-persona-diary': '随人格（日记）',
  'dsh-persona-explore': '随人格（探索）',
  'dsh-persona-results': '随人格（成果）',
}

export function emptyState() {
  return { global: 'on', plugins: {}, order: {}, note: '' }
}

/**
 * 顺序的默认值：**只填我知道的**，其余让注入者用自己的默认值。
 * 键是 section 的 name 原文（注册时写什么就是什么），不是插件名。
 * 一个插件可以有多段，各段顺序不同，所以按段记，不按插件记。
 */
export const DEFAULT_ORDER = {
  'persona-memory:now': 10,
  'persona:framework': 35,
  'persona-memory:long-term': 23,
  'persona-memory:short': 25,
  'persona-memory:other': 30,
}

/** 盘上读出来的可能是任何垃圾；读不动的一律归零，不抛。 */
export function normalizeState(raw) {
  const s = emptyState()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return s
  if (raw.global === 'off') s.global = 'off'
  if (typeof raw.note === 'string') s.note = raw.note
  if (raw.plugins && typeof raw.plugins === 'object' && !Array.isArray(raw.plugins)) {
    for (const [k, v] of Object.entries(raw.plugins)) {
      if (!k) continue
      if (v === 'off' || (v && typeof v === 'object' && v.mode === 'off')) s.plugins[k] = 'off'
    }
  }
  if (raw.order && typeof raw.order === 'object' && !Array.isArray(raw.order)) {
    for (const [k, v] of Object.entries(raw.order)) {
      const n = Number(v)
      if (k && Number.isFinite(n)) s.order[k] = Math.round(n)
    }
  }
  return s
}

/**
 * 这一家出场吗？
 * @returns {{allow: boolean, why: string}}
 */
export function allows(state, plugin) {
  const s = state || emptyState()
  if (s.global === 'off') return { allow: false, why: '全局关：这一轮谁都不出现' }
  if (!plugin) return { allow: true, why: '没报名字：默认放行' }
  if (s.plugins && s.plugins[plugin] === 'off') {
    return { allow: false, why: `「${INJECTORS[plugin] || plugin}」被关掉了` }
  }
  return { allow: true, why: '放行' }
}

export function setPlugin(state, plugin, on, why = '') {
  const s = normalizeState(state)
  if (!plugin) return s
  const next = { ...s, plugins: { ...s.plugins } }
  if (on) delete next.plugins[plugin]
  else next.plugins[plugin] = 'off'
  if (why) next.note = String(why)
  return next
}

export function mute(state, plugin, why = '') {
  return setPlugin(state, plugin, false, why)
}

export function unmute(state, plugin) {
  return setPlugin(state, plugin, true)
}

export function setGlobal(state, on) {
  const s = normalizeState(state)
  return { ...s, global: on ? 'on' : 'off' }
}

/** 被关掉的插件名（排好序，输出稳定） */
export function mutedPlugins(state) {
  const s = normalizeState(state)
  return Object.keys(s.plugins).sort()
}

/** 这一轮谁出场、谁不出场——报给人看的一行行 */
export function roster(state) {
  const s = normalizeState(state)
  const rows = Object.keys(INJECTORS).map((pkg) => {
    const r = allows(s, pkg)
    return {
      plugin: pkg,
      label: INJECTORS[pkg],
      part: PARTS[pkg] || '',
      on: r.allow,
      why: r.why,
    }
  })
  return { global: s.global, rows, note: s.note }
}

/**
 * 某一段该排第几。注入者注册 section 时问它，不自己写死数字。
 * 没改过就用注入者自己的默认值——闸不该假装什么都知道。
 */
export function orderOf(state, section, fallback) {
  const s = state || emptyState()
  if (s.order && Number.isFinite(s.order[section])) return s.order[section]
  if (Number.isFinite(DEFAULT_ORDER[section])) return DEFAULT_ORDER[section]
  return fallback
}

export function setOrder(state, section, order) {
  const s = normalizeState(state)
  const n = Number(order)
  if (!section || !Number.isFinite(n)) return s
  return { ...s, order: { ...s.order, [String(section)]: Math.round(n) } }
}

/** 现在的顺序表：改过的 + 我知道的默认值，按数值排好 */
export function orderTable(state) {
  const s = normalizeState(state)
  const merged = { ...DEFAULT_ORDER, ...s.order }
  return Object.entries(merged)
    .map(([section, order]) => ({ section, order, custom: section in s.order }))
    .sort((a, b) => a.order - b.order || (a.section < b.section ? -1 : 1))
}
