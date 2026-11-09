// 环境卡：把一段环境注入压成一张卡（保留指针），或原样摆出去。
// 只做一件：mode='card' 时，长段压成 ≤budget 字节、每行一条、末尾带原字数。
// 不是摘要——不调用模型，只取每行第一个分句。
//
// 三个组件各有一份自己的档（components.<名>.mode / budget），互不抢：
//   framework —— 框架本体那一段（人格框架、模块索引）
//   memory    —— 记忆插件那五个段
//   persona   —— 人格成长：所有人格文件
// 顶层 mode/budget 是旧版单档，读不到组件档时当兜底。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const ENVCARD = { file: '环境卡.json', dir: '.persona-framework', mode: 'raw', budget: 600 }

export const COMPONENTS = ['framework', 'memory', 'persona', 'module']
export const COMPONENT_LABEL = { framework: '人格框架', memory: '记忆', persona: '人格成长', module: '模块库' }

export function envCardPath(ws) {
  return join(ws || process.cwd(), ENVCARD.dir, ENVCARD.file)
}

function readRaw(ws) {
  try {
    const p = envCardPath(ws)
    if (!existsSync(p)) return {}
    const j = JSON.parse(readFileSync(p, 'utf8'))
    return j && typeof j === 'object' ? j : {}
  } catch { return {} }
}

function pickMode(v, fallback) { return v === 'card' || v === 'raw' ? v : fallback }
function pickBudget(v, fallback) {
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback
}

/** 读某个组件的档；没写就落回顶层，再落回默认。 */
export function readCard(ws, component = 'framework') {
  const j = readRaw(ws)
  const base = {
    mode: pickMode(j.mode, ENVCARD.mode),
    budget: pickBudget(j.budget, ENVCARD.budget),
  }
  const c = COMPONENTS.includes(component) ? j.components?.[component] : null
  if (!c) return { ...base, component, inherited: true }
  return {
    component,
    mode: pickMode(c.mode, base.mode),
    budget: pickBudget(c.budget, base.budget),
    inherited: false,
  }
}

/** 兼容旧名：整份读出来（顶层 + 各组件的）。 */
export function readEnvCard(ws) {
  const j = readRaw(ws)
  const out = {
    mode: pickMode(j.mode, ENVCARD.mode),
    budget: pickBudget(j.budget, ENVCARD.budget),
    components: {},
  }
  for (const c of COMPONENTS) out.components[c] = readCard(ws, c)
  return out
}

export function writeCard(ws, component, patch = {}) {
  const j = readRaw(ws)
  const next = { ...j }
  if (!next.components || typeof next.components !== 'object') next.components = {}
  if (component === 'all' || component === 'global') {
    if (patch.mode !== undefined) next.mode = pickMode(patch.mode, pickMode(j.mode, ENVCARD.mode))
    if (patch.budget !== undefined) next.budget = pickBudget(patch.budget, pickBudget(j.budget, ENVCARD.budget))
  } else {
    if (!COMPONENTS.includes(component)) return { ok: false, why: `没有这个组件：${component}（只有 ${COMPONENTS.join(' / ')}）` }
    const cur = readCard(ws, component)
    next.components[component] = {
      mode: patch.mode !== undefined ? pickMode(patch.mode, cur.mode) : cur.mode,
      budget: patch.budget !== undefined ? pickBudget(patch.budget, cur.budget) : cur.budget,
    }
  }
  const p = envCardPath(ws)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(next, null, 2) + '\n', 'utf8')
  return { ok: true, ...next }
}

/** 兼容旧名：不给组件就改顶层。 */
export function writeEnvCard(ws, patch = {}) {
  const r = writeCard(ws, 'global', patch)
  return { mode: readCard(ws, 'framework').mode, budget: readCard(ws, 'framework').budget, components: r.components || {} }
}

const byteLen = (s) => Buffer.byteLength(String(s || ''), 'utf8')

/** 一句话取到第一个分句，够短才留。 */
function clause(line, max = 48) {
  const s = String(line || '').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  if (s.length <= max) return s
  const cut = s.search(/[，,。；;：:！!？?]/)
  if (cut > 6 && cut <= max) return s.slice(0, cut)
  return s.slice(0, max) + '…'
}

/**
 * 把一段原文压成卡。
 * @param {string} name 段名
 * @param {string} text 原文
 * @param {{budget?:number, keepTop?:number, component?:string}} opts
 */
export function cardOf(name, text, opts = {}) {
  const budget = Number(opts.budget) > 0 ? Number(opts.budget) : ENVCARD.budget
  const raw = String(text || '')
  if (!raw.trim()) return ''
  if (byteLen(raw) <= budget) return raw
  const lines = raw.split(/\r?\n/)
  const out = [`# ${name}（卡片 ${budget} 字节；全文在本地，按段名回收）`]
  let used = byteLen(out[0]) + 1
  let kept = 0
  let dropped = 0
  for (const line of lines) {
    const h = line.match(/^#{1,6}\s+(.+)$/)
    if (h) {
      const item = '- ' + clause(h[1], 40)
      const b = byteLen(item) + 1
      if (used + b + 40 > budget) { dropped += 1; continue }
      out.push(item); used += b; kept += 1
      continue
    }
    const t = String(line || '').trim()
    if (!t) continue
    const item = '- ' + clause(t)
    const b = byteLen(item) + 1
    if (used + b + 40 > budget) { dropped += 1; continue }
    out.push(item); used += b; kept += 1
    if (kept >= (opts.keepTop || 24)) { dropped += 1; break }
  }
  const tail = `…另有 ${dropped} 条没摆（原 ${byteLen(raw)} 字节）`
  out.push(tail)
  return out.join('\n')
}

/** 按组件档决定要不要压。 */
export function cardFor(ws, component, name, text, opts = {}) {
  const c = readCard(ws, component)
  if (c.mode !== 'card') return String(text || '')
  return cardOf(name, text, { ...opts, budget: c.budget })
}

export function renderCardReport(ws) {
  const rows = COMPONENTS.map((c) => {
    const r = readCard(ws, c)
    return `- ${COMPONENT_LABEL[c]}（${c}）：${r.mode === 'card' ? '卡片' : '原样'}，${r.budget} 字节${r.inherited ? '（跟顶层）' : ''}`
  })
  return ['环境注入档（.persona-framework/环境卡.json）：', ...rows].join('\n')
}

/** 兼容旧名。 */
export function renderEnvCard(ws) { return renderCardReport(ws) }

/** 旧签名包一层：wrapWithCard(name, fn, ws, opts) */
export function wrapWithCard(name, fn, ws, opts = {}) {
  return () => cardFor(ws, opts.component || 'framework', name, fn(), opts)
}
