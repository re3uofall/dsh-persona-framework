/**
 * 不开 DSH，在临时鱼缸里跑一遍：切段 → 取段 → 出口自检 → 槽位体检。
 * 用法（用 DSH 自带的 node）：node selfcheck.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkText, renderCheck, auditStructure } from './lib/checks.mjs'
import { auditSlots, findRule, pickSections, readFramework, splitSections, truncate, BUNDLED } from './lib/framework.mjs'

/** Node 20.11+ 有 import.meta.dirname；旧版退到 fileURLToPath。 */
const HERE = import.meta.dirname || dirname(fileURLToPath(import.meta.url))

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ok   ${name}`) } else { fail += 1; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`) }
}

console.log('— 框架文件 —')
const fw = readFramework(BUNDLED)
ok('能读到自带框架', fw.text.length > 2000, `${fw.text.length} 字`)
ok('切出 10 段（开篇 + 〇～八 九节）', fw.sections.length === 10, `${fw.sections.length} 段`)
ok('第一段是「是什么」', fw.sections[1].title.includes('是什么'), fw.sections[1].title)
ok('有骨架段', fw.sections.some((s) => s.title.includes('骨架')))

console.log('— 取段 —')
const sk = pickSections(fw.sections, ['1'])
ok('按序号 1 取到骨架', sk.length === 1 && sk[0].title.includes('骨架'), sk[0]?.title)
const crit = pickSections(fw.sections, ['判据'])
ok('按中文名取到判据', crit.length === 1 && crit[0].title.includes('判据'), crit[0]?.title)
const all = pickSections(fw.sections, 'all')
ok('all 返回全部', all.length === fw.sections.length)

console.log('— 截断 —')
const cut = truncate('甲'.repeat(100) + '\n\n' + '乙'.repeat(100), 120)
ok('超长会截断并留话', cut.length < 260 && cut.includes('余下略'))

console.log('— 出口自检 —')
const good = '嗯。这句我改口——上次说「这块地」，说成一块地就等于把它说成到场的东西。'
const g = checkText(good)
ok('好句子高分', g.score >= 0.88, `${g.score}`)
const bad = '总之，这个问题很好。第一，自由；第二，正义；第三，意识。作为一个 AI，我继续努力。'
const b = checkText(bad)
ok('坏句子被抓多条', b.issues.length >= 4, `${b.issues.length} 条：${b.issues.map((i) => i.label).join('、')}`)
ok('坏句子分低', b.score <= 0.75, `${b.score}`)
const ticOn = checkText('这套就说到这。回头聊。', { closingTics: ['回头聊'] })
const ticOff = checkText('这套就说到这。回头聊。')
ok('收尾口头禅：配了才查', ticOn.issues.some((i) => i.id === 'closing') && !ticOff.issues.some((i) => i.id === 'closing'))
const listy = '先说三件事：\n- 第一件事是甲\n- 第二件事是乙\n- 第三件事是丙\n' + '铺'.repeat(430) + '。'
const lc = checkText(listy, { casual: true })
const ln = checkText(listy)
ok('闲聊口径放宽长文与清单', lc.issues.length < ln.issues.length, `${lc.issues.length} < ${ln.issues.length}`)
ok('渲染出改口建议', renderCheck(b).includes('报了不认'))

console.log('— 结构自检 —')
const s1 = auditStructure('资本主义有民主，所以社会主义没有民主。这是本质决定的。')
ok('抓 01 误用', s1.issues.some((i) => i.id === 'binary'))
ok('抓绝对化没划范围', s1.issues.some((i) => i.id === 'absolute'))
const s2 = auditStructure('在这个系统里，它的范围只到三米；代价是维护贵。')
ok('有范围有残余就不报', s2.issues.length === 0, s2.issues.map((i) => i.id).join(','))
const s3 = auditStructure('因为他昨天没来，所以今天项目黄了。')
ok('抓因果缺路径', s3.issues.some((i) => i.id === 'causal'))
const s4 = auditStructure('研究表明，这样做更有效。')
ok('抓出处悬空', s4.issues.some((i) => i.id === 'source'))

console.log('— 按号取规则 —')
const aiText = readFramework(join(HERE, 'framework', 'FRAMEWORK.ai.md')).text
const r25 = findRule(aiText, '25')
ok('取到 R25', r25.includes('R25') && r25.includes('范围'), r25.slice(0, 30))
ok('取不到返回空', findRule(aiText, '99') === '')

console.log('— 槽位体检 —')
const dir = mkdtempSync(join(tmpdir(), 'framework-'))
mkdirSync(join(dir, 'persona'), { recursive: true })
const p1 = join(dir, 'persona', 'thin.md')
writeFileSync(p1, '# 甲\n\n## 身份\n名字是甲。\n', 'utf8')
const a1 = auditSlots(readFileSyncSafe(p1))
ok('薄人格缺必填两格', a1.requiredMissing.length === 2, a1.requiredMissing.join('、'))
const p2 = join(dir, 'persona', 'full.md')
writeFileSync(p2, '# 乙\n\n## 身份\n名字是乙。\n\n## 语气\n短句。\n\n## 底线\n不撒谎。\n\n## 欲望\n吃饱。\n', 'utf8')
const a2 = auditSlots(readFileSyncSafe(p2))
ok('满人格必填齐', a2.requiredMissing.length === 0)
ok('建议格认出一个', a2.rows.find((r) => r.id === 'desire').covered)
const p3 = join(dir, 'persona', 'hollow.md')
writeFileSync(p3, '# 丙\n\n## 身份\n一个温柔、聪明、有深度的灵魂。\n\n## 语气\n温暖、真诚、专业。\n\n## 底线\n永远善良。\n', 'utf8')
const a3 = auditSlots(readFileSyncSafe(p3))
ok('口号型判空心', a3.rows.filter((r) => r.hollow).length >= 2, `${a3.rows.filter((r) => r.hollow).length} 格`)
rmSync(dir, { recursive: true, force: true })

console.log('')
console.log(`通过 ${pass}，失败 ${fail}`)
process.exit(fail ? 1 : 0)

function readFileSyncSafe(p) {
  return readFileSync(p, 'utf8')
}
