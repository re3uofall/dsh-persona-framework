import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const M = 'file:///C:/爱思考的大肥鱼思思/dsh-persona-memory/lib/'
const { link, edgesOf, counterparts, renderEdges } = await import(M + 'edges.mjs')
const { record, blocked } = await import(M + 'audit.mjs')
const { reject, looksRejected, renderRejected } = await import(M + 'rejected.mjs')
const { check } = await import(M + 'consistency.mjs')
const { addAnchor, anchorsOf } = await import(M + 'anchors.mjs')
const { reflect } = await import(M + 'reflect.mjs')
const { harvest } = await import(M + 'flywheel.mjs')

const root = 'C:/Users/52624/AppData/Local/Temp/gate-test-root'
rmSync(root, { recursive: true, force: true })
mkdirSync(join(root, 'persona-ai/knowledge/chat'), { recursive: true })
mkdirSync(join(root, 'persona-ai/knowledge/session'), { recursive: true })
mkdirSync(join(root, '.persona-framework'), { recursive: true })

let pass = 0
let fail = 0
const ok = (name, cond) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`)
  cond ? pass++ : fail++
}

// ── 边 ──
link(root, { from: 'chat/a.md#1', to: 'chat/b.md#2', type: 'same', why: '同一笔' })
link(root, { from: 'chat/a.md#1', to: 'chat/c.md#3', type: 'refutes' })
ok('边：连了两条', edgesOf(root, 'chat/a.md#1').length === 2)
ok('边：同一件事的对家', counterparts(root, 'chat/a.md#1').join() === 'chat/b.md#2')
ok('边：类型非法要拒', (() => { try { link(root, { from: 'x', to: 'y', type: 'bad' }); return false } catch { return true } })())
ok('边：渲染出字', renderEdges(root, 'chat/a.md#1').includes('same'))

// ── 审计 ──
record(root, { op: 'write', path: 'chat/a.md', decision: 'allow' })
record(root, { op: 'write', path: 'characters/x.md', decision: 'deny', why: '缺 verify' })
ok('审计：两条', blocked(root).length === 1)
ok('审计：挡住的那条记了原因', blocked(root)[0].why.includes('verify'))

// ── 负记忆 ──
reject(root, { claim: '把窗口设成工作区就能对齐脚底', why: '实际会沉进任务栏', evidence: '截图 y≈953' })
ok('负记忆：文件里能读到', renderRejected(root).includes('沉进任务栏'))
ok('负记忆：能查出来', !!looksRejected(root, '把窗口设成工作区就能对齐脚底'))

// ── 一致性 ──
writeFileSync(
  join(root, 'persona-ai/knowledge/chat/2026-11-03.md'),
  '# 判断\n\n## 一条\n\n- 把窗口设成工作区就能对齐脚底。\n',
  'utf8',
)
ok('一致性：查出重复被证伪的说法', check(root).length >= 1)

// ── 锚点 ──
addAnchor(root, { text: '先吃饭，再说', source: 'persona-ai/characters/大肥鱼思思_人格文件.md', why: '底' })
addAnchor(root, { text: '先吃饭，再说' })
ok('锚点：钉一次', anchorsOf(root).length === 1)

// ── 反思 / 飞轮（空目录也要能给话） ──
const r = reflect(root)
ok('反思：给出事实', Array.isArray(r.facts) && r.facts.length >= 3)
ok('飞轮：空着也说得出话', harvest(root).length === 0)

rmSync(root, { recursive: true, force: true })
console.log(`\n${pass} 过 / ${fail} 不过`)
process.exit(fail ? 1 : 0)
