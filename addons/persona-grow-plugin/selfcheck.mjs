/**
 * selfcheck.mjs —— 不装进 DSH 也能验一遍「学 → 采纳 → 忘掉 → 回滚」这条回路
 * 跑法：node selfcheck.mjs
 * 它在系统临时目录里造一个假鱼缸，不碰真人格。
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendEvidence, listVersions, mutatePatch, normalize, pathsFor, readBase, readPatch,
  revertTo, syncPatch, writeState, readState,
} from './lib/store.mjs'
import { extractCandidates } from './lib/learn.mjs'

const cfg = { autoAdopt: true, promoteAfter: 2, maxTraits: 40 }
const dir = mkdtempSync(join(tmpdir(), 'persona-grow-'))
let failed = 0
const ok = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`) } catch (error) { failed += 1; console.log(`  ✗ ${name}\n    ${error.message}`) }
}
const now = () => new Date().toISOString()

mkdirSync(join(dir, 'characters'), { recursive: true })
writeFileSync(join(dir, 'characters', '大肥鱼思思_人格文件.md'), '# 测试人格 v9.9\n\n> 说明行\n\n你是测试鱼。\n')
const p = pathsFor(dir)

console.log(`临时鱼缸：${dir}\n`)

ok('基础人格去掉了标题与说明块', () => {
  const base = readBase(p)
  assert.equal(base.version, '9.9')
  assert.equal(base.text, '你是测试鱼。')
})

ok('第一次同步建出 v1 空补丁', () => {
  const state = syncPatch(p, cfg)
  assert.equal(state.version, 1)
  assert.equal(state.adopted.length, 0)
  assert.ok(existsSync(p.patch))
  assert.match(readFileSync(p.patch, 'utf8'), /^# 人格补丁 v1/)
})

ok('没新证据时不会反复升版本', () => {
  syncPatch(p, cfg)
  const before = readPatch(p).text
  syncPatch(p, cfg)
  assert.equal(readPatch(p).text, before)
  assert.equal(readPatch(p).version, 1)
})

ok('同一句被要求两次 → 自己长进「已采纳」', () => {
  const trait = '以后你别老叫我鱼片'
  appendEvidence(p, { op: 'learn', t: now(), kind: '纠正', text: trait, quote: trait })
  let state = syncPatch(p, cfg)
  assert.equal(state.adopted.length, 0, '第一次还不该采纳')
  assert.equal(state.pending.length, 1)
  assert.match(state.pending[0].meta, /^1\/2$/)

  appendEvidence(p, { op: 'learn', t: now(), kind: '纠正', text: trait, quote: trait })
  state = syncPatch(p, cfg)
  assert.equal(state.adopted.length, 1)
  assert.equal(state.version, 2)
  assert.ok(listVersions(p).includes(1), '改「已采纳」前该留 v1 快照')
})

ok('忘掉之后旧账顶不回来', () => {
  const key = normalize('以后你别老叫我鱼片')
  mutatePatch(p, cfg, (model) => ({ ...model, adopted: model.adopted.filter((a) => normalize(a.text) !== key) }))
  appendEvidence(p, { op: 'forget', t: now(), key })
  let state = syncPatch(p, cfg)
  assert.equal(state.adopted.length, 0)

  // 忘掉之后再被要求一次：算新账，从头数
  appendEvidence(p, { op: 'learn', t: now(), kind: '纠正', text: '以后你别老叫我鱼片', quote: '以后你别老叫我鱼片' })
  state = syncPatch(p, cfg)
  assert.equal(state.adopted.length, 0, '忘掉之后一次不该立刻采纳')
  assert.equal(state.pending[0].meta, '1/2')
})

ok('force 证据立刻采纳', () => {
  appendEvidence(p, { op: 'learn', t: now(), kind: '偏好', text: '她更喜欢先给结论再解释', quote: '先给结论行不行', force: true })
  const state = syncPatch(p, cfg)
  assert.equal(state.adopted.length, 1)
  assert.match(state.adopted[0].text, /先给结论/)
})

ok('回滚到 v1 把「已采纳」清空，并作废旧证据', () => {
  const before = readPatch(p).version
  assert.ok(before > 1)
  assert.ok(revertTo(p, 1))
  writeState(p, { ...readState(p), revertedAt: now() })
  const state = syncPatch(p, cfg)
  assert.equal(state.adopted.length, 0)
  assert.equal(state.pending.length, 0, '旧证据一律作废')
})

ok('待议里的噪声能单独清掉，不惊动已采纳', () => {
  const noise = '你应该知道吗'
  appendEvidence(p, { op: 'learn', t: now(), kind: '纠正', text: noise, quote: noise })
  let state = syncPatch(p, cfg)
  assert.equal(state.pending.length, 1, '一句感慨先落在待议')
  assert.equal(state.adopted.length, 0, '一次不该上身')
  appendEvidence(p, { op: 'forget', t: now(), key: normalize(noise) })
  state = syncPatch(p, cfg)
  assert.equal(state.pending.length, 0, '作废之后待议里也不该再有它')
})

ok('从人话里挑候选：只认冲着「你」的长期要求', () => {
  assert.deepEqual(extractCandidates('以后你别一上来就列条目。').map((c) => c.kind), ['纠正'])
  assert.deepEqual(extractCandidates('以后你别老叫我鱼片。').map((c) => c.kind), ['称呼'])
  assert.deepEqual(extractCandidates('记住，叫我思思').map((c) => c.kind), ['称呼'])
  assert.equal(extractCandidates('以后再说吧').length, 0, '「以后再说」是拖，不是要求')
  assert.equal(extractCandidates('我喜欢吃鱼').length, 0, '没冲着你，不算')
  assert.equal(extractCandidates('别紧张，我随便看看').length, 0)
  assert.equal(extractCandidates('可以帮我看看这个报错吗').length, 0)
})

try {
  rmSync(dir, { recursive: true, force: true })
} catch { /* Windows 上偶尔删不干净，不影响结论 */ }

if (failed > 0) {
  console.log(`\n${failed} 项没过`)
  process.exit(1)
}
console.log('\n全部通过')
