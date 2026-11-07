/**
 * dsh-persona-appear · 自检
 * 只跑纯函数：闸的形状、判定顺序、按插件开关、写回不改入参。
 * 不碰 DSH 运行时——那是另一层（插件在跑 ≠ 脚本通过）。
 */
import assert from 'node:assert/strict'
import {
  INJECTORS, PARTS, STATE_FILE, allows, emptyState, mute, mutedPlugins, normalizeState, orderOf,
  orderTable, roster, setGlobal, setOrder, unmute,
} from './lib/appear.mjs'
import {
  LADDER, adjudicate, presentLine, rankOf, renderPriority, ladderTable,
} from './lib/priority.mjs'

let n = 0
const t = (name, fn) => { fn(); n += 1; console.log(`  ok ${n}  ${name}`) }

t('STATE_FILE 是「出现.json」', () => {
  assert.equal(STATE_FILE, '出现.json')
})

t('六家注入者都在名单里（一家都不能漏）', () => {
  const want = [
    'dsh-persona-grow', 'dsh-persona-memory', 'dsh-persona-framework',
    'dsh-persona-diary', 'dsh-persona-explore', 'dsh-persona-results',
  ]
  assert.deepEqual(Object.keys(INJECTORS).sort(), want.sort())
  for (const k of want) assert.ok(PARTS[k], `${k} 没标属于人格哪部分`)
})

t('人格被分成两部分：人格本身 + 随人格', () => {
  const parts = Object.values(PARTS)
  assert.ok(parts.some((p) => p.startsWith('人格本身')), '缺「人格本身」那一半')
  assert.ok(parts.filter((p) => p.startsWith('随人格')).length >= 4, '「随人格」那一半太少')
})

t('空闸放行', () => {
  assert.equal(allows(emptyState(), 'dsh-persona-memory').allow, true)
})

t('全局关：谁都不出现（连名字都不看）', () => {
  const s = setGlobal(emptyState(), false)
  assert.equal(allows(s, 'dsh-persona-memory').allow, false)
  assert.equal(allows(s, '').allow, false)
  assert.match(allows(s, 'dsh-persona-memory').why, /全局/)
})

t('按插件关：只关那一家', () => {
  const s = mute(emptyState(), 'dsh-persona-memory', '省 token')
  assert.equal(allows(s, 'dsh-persona-memory').allow, false)
  assert.equal(allows(s, 'dsh-persona-framework').allow, true)
  assert.match(allows(s, 'dsh-persona-memory').why, /记忆分层/)
})

t('打开之后回到放行', () => {
  let s = mute(emptyState(), 'dsh-persona-framework')
  s = unmute(s, 'dsh-persona-framework')
  assert.equal(allows(s, 'dsh-persona-framework').allow, true)
  assert.deepEqual(mutedPlugins(s), [])
})

t('不改入参', () => {
  const base = emptyState()
  mute(base, 'dsh-persona-diary')
  assert.deepEqual(base.plugins, {})
  setGlobal(base, false)
  assert.equal(base.global, 'on')
})

t('坏文件归一化成空闸，不抛', () => {
  for (const bad of [null, undefined, 42, 'x', [], { plugins: 'no' }, { global: 'weird' }]) {
    const s = normalizeState(bad)
    assert.equal(s.global, 'on')
    assert.deepEqual(s.plugins, {})
  }
})

t('plugins 里非 off 的值不收', () => {
  const s = normalizeState({ plugins: { a: 'off', b: { mode: 'on' }, c: { mode: 'off' } } })
  assert.deepEqual(Object.keys(s.plugins).sort(), ['a', 'c'])
})

t('没给名字按放行（全局关除外）', () => {
  assert.equal(allows(emptyState(), '').allow, true)
  assert.equal(allows(mute(emptyState(), 'dsh-persona-memory'), '').allow, true)
})

t('名单排序稳定', () => {
  let s = emptyState()
  s = mute(s, 'dsh-persona-results')
  s = mute(s, 'dsh-persona-diary')
  assert.deepEqual(mutedPlugins(s), ['dsh-persona-diary', 'dsh-persona-results'])
})

t('roster 报得全：六家各有出/不出', () => {
  const r = roster(mute(emptyState(), 'dsh-persona-framework'))
  assert.equal(r.rows.length, 6)
  const fw = r.rows.find((x) => x.plugin === 'dsh-persona-framework')
  assert.equal(fw.on, false)
  assert.ok(fw.part.includes('框架'))
  assert.equal(r.rows.filter((x) => x.on).length, 5)
})

t('顺序：没改过就用注入者自己的默认值', () => {
  assert.equal(orderOf(emptyState(), '别的一段', 77), 77)
  assert.equal(orderOf(emptyState(), 'persona:framework', 999), 35)
})

t('顺序：改过的压过默认值（闸是唯一出处）', () => {
  const s = setOrder(emptyState(), 'persona:framework', 12)
  assert.equal(orderOf(s, 'persona:framework', 999), 12)
  const t2 = orderTable(s).find((x) => x.section === 'persona:framework')
  assert.equal(t2.custom, true)
  assert.equal(t2.order, 12)
})

t('顺序：只收数字，乱写的丢', () => {
  assert.equal(orderOf(normalizeState({ order: { 'x:y': 'abc' } }), 'x:y', 9), 9)
  assert.equal(orderOf(normalizeState({ order: { 'x:y': 3.6 } }), 'x:y', 9), 4)
})

t('顺序表按数值排好', () => {
  const table = orderTable(emptyState())
  const nums = table.map((r) => r.order)
  assert.deepEqual(nums, [...nums].sort((a, b) => a - b))
})


// ── 优先级：台阶是死的，谁在场是活的 ─────────────────────────────
t('优先级：六个台阶，人格在最上面', () => {
  assert.equal(LADDER.length, 6)
  assert.equal(rankOf('persona'), 1)
  assert.equal(rankOf('longTerm'), 2)
  assert.equal(rankOf('now'), 3)
  assert.equal(rankOf('shortTerm'), 4)
  assert.equal(rankOf('other'), 5)
  assert.equal(rankOf('corpus'), 6)
  assert.equal(rankOf('不认识的层'), 6, '认不出的一律落最后一档')
})

t('优先级：上面压下面，不看哪句更顺', () => {
  const r = adjudicate([{ layer: 'shortTerm', text: '顺的' }, { layer: 'persona', text: '判据' }])
  assert.equal(r.winner.layer, 'persona')
  assert.equal(r.losers[0].layer, 'shortTerm')
  assert.ok(r.why.includes('台阶在上面'))
})

t('优先级：只有一层说话就不裁', () => {
  const r = adjudicate([{ layer: 'now', text: '就一句' }])
  assert.equal(r.winner.layer, 'now')
  assert.equal(r.losers.length, 0)
})

t('优先级：空输入不报错', () => {
  assert.equal(adjudicate([]).winner, null)
})

t('优先级：看不见的层写不知道，不写成 0', () => {
  const line = presentLine({ persona: true, longTerm: 2, now: null, shortTerm: 0, other: 7 })
  assert.ok(line.includes('即时记忆：不知道'))
  assert.ok(line.includes('长期记忆：2 篇'))
})

t('优先级：段里一定带台阶表，算坏了也带', () => {
  const ok = renderPriority({ presence: { persona: true, longTerm: 1, now: null, shortTerm: 2, other: 3 }, at: 'T', wrote: true })
  assert.ok(ok.includes('1. 人格'))
  assert.ok(ok.includes('上面压下面'))
  const bad = renderPriority({ presence: null, at: 'T', wrote: false, error: 'boom' })
  assert.ok(bad.includes('1. 人格'))
  assert.ok(bad.includes('没算成'))
})

t('优先级：台阶表永远按 1..6 排', () => {
  assert.deepEqual(ladderTable().map((r) => r.rank), [1, 2, 3, 4, 5, 6])
})
console.log(`\n${n} 条全过。`)
