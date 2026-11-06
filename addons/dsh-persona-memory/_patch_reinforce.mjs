import fs from 'node:fs'
const f = 'lib/reinforce.mjs'
let s = fs.readFileSync(f, 'utf8')
const before = s.length
const notes = []

// 1) import
if (!s.includes("from './recency.mjs'")) {
  const m = s.match(/^import[^\n]*\n/m)
  const line = "import { recencyOf, recencyWeight, rehearseFactor } from './recency.mjs'\n"
  if (m) { s = s.slice(0, m.index + m[0].length) + line + s.slice(m.index + m[0].length) }
  else s = line + s
  notes.push('import ok')
} else notes.push('import skip')

// 2) 取 scoreOf 第一个参数名
const sig = s.match(/export\s+function\s+scoreOf\s*\(\s*([A-Za-z_$][\w$]*)/)
const rowVar = sig ? sig[1] : 'row'
notes.push('rowVar=' + rowVar)

// 3) 给 scoreOf 的 return 乘上复习因子
if (!s.includes('rehearseFactor(' + rowVar + ')')) {
  const re = /return\s+W_TIME\s*\*\s*timeScore\(([^)]*)\)\s*\+\s*W_SUBJECT\s*\*\s*subjectScore\(([^)]*)\)/
  if (re.test(s)) {
    s = s.replace(re, (_m, a, b) => `return (W_TIME * timeScore(${a}) + W_SUBJECT * subjectScore(${b})) * rehearseFactor(${rowVar})`)
    notes.push('scoreOf modulated')
  } else notes.push('scoreOf pattern MISS')
} else notes.push('scoreOf already')

// 4) 尾巴
if (!s.includes('export function richScoreOf')) {
  s += `
// —— 学自 coner13/dsh-hippocampus 的四件（算法重写，未搬代码）——
export {
  recencyOf, recencyWeight, rehearseFactor, strengthOf,
  LOCATOR, hasLocator, THOUGHT_KINDS, KIND_LABEL, similarity, textHashOf,
} from './recency.mjs'

/** 一条记忆「还剩多少力气」：衰减（带显著性/情绪加成）× 复习因子 */
export function richScoreOf(item = {}, now = Date.now()) {
  const days = item && item.at ? (now - item.at) / 86400000 : null
  return recencyOf(days, item && item.salience, item && item.emotion) * rehearseFactor(item || {})
}
`
  notes.push('tail ok')
} else notes.push('tail skip')

fs.writeFileSync(f, s)
console.log('bytes', before, '->', s.length, '|', notes.join(' / '))
