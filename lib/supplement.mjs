/**
 * 功能补充：**真读那个 json**。
 *
 * 注入里那段指南写着「写 `功能补充.json`，它下一轮读键」。
 * 在那之前，**代码里没有任何一处读它**——指南承诺的是一条不存在的路。
 * 这个文件就是那条路。
 *
 * 三条边界：
 *  - 键对不上任何功能 → 不静默，报出来（写错了得知道写错了）。
 *  - 文件坏了 → 报出来，不当没有。
 *  - 文件不在 → 什么都不说（没写补充是常态，不是错误）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 键可以写功能真名，也可以写一组。分组是给人写的，不是给代码写的。 */
export const GROUPS = {
  自主: ['起念', '称重', '决断', '做', '自我监控'],
  记忆: ['捞记忆'],
  本我: ['起念', '称重'],
}

export function readSupplement(ws, names = []) {
  const path = join(String(ws || '.'), '功能补充.json')
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return { path, items: [], unknown: [], broken: null, missing: true }
  }

  let obj
  try {
    obj = JSON.parse(raw)
  } catch (e) {
    return { path, items: [], unknown: [], broken: String((e && e.message) || e), missing: false }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { path, items: [], unknown: [], broken: '顶层得是一个对象，键＝功能名', missing: false }
  }

  const known = new Set(names)
  const items = []
  const unknown = []

  for (const [key, val] of Object.entries(obj)) {
    const want = typeof val === 'string' ? val : (val && typeof val === 'object' ? val.希望 || val.hope || '' : '')
    const why = (val && typeof val === 'object' && (val.why || val.理由)) || ''
    if (!String(want).trim()) {
      unknown.push({ key, why: '只有键没有「希望」——没有话可办' })
      continue
    }
    const targets = GROUPS[key] ? GROUPS[key].filter((n) => !known.size || known.has(n)) : (known.has(key) ? [key] : [])
    if (!targets.length) {
      unknown.push({ key, why: known.size ? '没有这个功能' : '（功能清单没拿到，先不定对错）' })
      continue
    }
    items.push({ key, targets, want: String(want).trim(), why: String(why).trim() })
  }

  return { path, items, unknown, broken: null, missing: false }
}

/**
 * 渲染成注入里的一段。
 * **只摆事实**：写了什么、挂到哪儿、哪条对不上。
 * 不评价，不替它解释——解释是人格那一层的事。
 */
export function renderSupplement(sup) {
  if (!sup) return ''
  if (sup.broken) return `\n**功能补充读不了**：${sup.broken}`
  if (sup.missing) return ''
  if (!sup.items.length && !sup.unknown.length) return ''

  const lines = ['']
  lines.push('## 功能补充（照键办事）')
  lines.push('')
  if (sup.items.length) {
    lines.push('这一轮按你写的要求办：')
    lines.push('')
    for (const it of sup.items) {
      lines.push(`- **${it.targets.join(' / ')}**${it.why ? `（${it.why}）` : ''}｜${it.want}`)
    }
  }
  if (sup.unknown.length) {
    lines.push('')
    lines.push('这几条没挂上：')
    for (const u of sup.unknown) lines.push(`- 「${u.key}」——${u.why}`)
  }
  return lines.join('\n')
}
