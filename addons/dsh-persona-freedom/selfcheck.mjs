/**
 * selfcheck.mjs —— freedom 的自检。`node selfcheck.mjs`，全绿再往下。
 * 只测纯逻辑（lib/free.mjs），不碰 fs、不碰 ctx。
 */
import {
  addItem,
  describe,
  dueItems,
  emptyState,
  isInQuiet,
  localMinutes,
  dayKeyOf,
  markDone,
  markReminded,
  normalizeState,
  readClock,
  renderDue,
  selectItem,
  todayItems,
  DEFAULT_DND,
} from './lib/free.mjs'

let pass = 0
const fails = []
function ok(cond, name) {
  if (cond) pass++
  else fails.push(name)
}
function eq(actual, expected, name) {
  ok(JSON.stringify(actual) === JSON.stringify(expected), `${name}（得到 ${JSON.stringify(actual)}，要 ${JSON.stringify(expected)}）`)
}

// 固定时刻：2026-11-06T01:00:00Z = 上海 09:00
const T0900 = Date.parse('2026-11-06T01:00:00Z')
const T2300 = Date.parse('2026-11-06T15:00:00Z') // 上海 23:00
const T0730 = Date.parse('2026-11-05T23:30:00Z') // 上海 07:30（次日）
const T0800 = Date.parse('2026-11-06T00:00:00Z') // 上海 08:00
const T2229 = Date.parse('2026-11-06T14:29:00Z') // 上海 22:29

// ---- 钟点 ----
eq(readClock('09:30'), 570, 'readClock 09:30')
eq(readClock('00:00'), 0, 'readClock 00:00')
eq(readClock('23:59'), 1439, 'readClock 23:59')
eq(readClock('9:30'), null, 'readClock 拒绝 9:30')
eq(readClock('24:00'), null, 'readClock 拒绝 24:00')
eq(readClock(''), null, 'readClock 拒绝空')

// ---- 本地时间 ----
eq(localMinutes(T0900), 540, 'localMinutes 上海 09:00')
eq(localMinutes(T2300), 1380, 'localMinutes 上海 23:00')
eq(dayKeyOf(T0900), '2026-11-06', 'dayKeyOf 上海 11-06')
eq(dayKeyOf(T0730), '2026-11-06', 'dayKeyOf 上海早上 07:30 仍是 11-06')

// ---- DND：跨零点 ----
const dnd = { ...DEFAULT_DND }
eq(isInQuiet(dnd, T2300), true, 'DND 23:00 在里面')
eq(isInQuiet(dnd, T0730), true, 'DND 07:30 在里面')
eq(isInQuiet(dnd, T0800), false, 'DND 08:00 不在（终点不算）')
eq(isInQuiet(dnd, T2229), false, 'DND 22:29 不在')
eq(isInQuiet({ ...dnd, on: false }, T2300), false, 'DND 关了就不拦')
eq(isInQuiet({ ...dnd, start: '08:00', end: '08:00' }, T0900), false, '起点等于终点不算全天')
eq(isInQuiet({ ...dnd, start: '11:00', end: '13:00' }, T0900), false, '非跨零点：09:00 不在 11:00–13:00')
eq(isInQuiet({ ...dnd, start: '08:00', end: '10:00' }, T0900), true, '非跨零点：09:00 在 08:00–10:00')

// ---- 加事 ----
let st = emptyState()
let r = addItem(st, { kind: 'fixed', text: '写插件自检', at: '09:30' }, T0900)
ok(r.ok, '加一条固定事')
st = r.state
eq(st.items.length, 1, '单子上一条')
eq(st.items[0].at, '09:30', '固定事带钟点')
eq(st.items[0].doneDays, [], '新条目没打过卡')
ok(!addItem(st, { kind: 'fixed', text: '没钟点的固定事' }, T0900).ok, '固定事没钟点要拒')
ok(!addItem(st, { kind: 'elastic', text: '弹性事带钟点', at: '10:00' }, T0900).ok, '弹性事带钟点要拒')
ok(!addItem(st, { kind: 'weird', text: 'x' }, T0900).ok, '不认识的 kind 要拒')
ok(!addItem(st, { kind: 'elastic', text: '   ' }, T0900).ok, '空文本要拒')
ok(!addItem(st, { kind: 'fixed', text: '写插件自检', at: '11:00' }, T0900).ok, '重复的原文要拒')
r = addItem(st, { kind: 'elastic', text: '抽空整理书签' }, T0900)
ok(r.ok, '加一条弹性事')
st = r.state
eq(st.items.length, 2, '两条')

// ---- 打勾 ----
r = markDone(st, '写插件自检', T0900)
ok(r.ok && !r.already, '第一次打勾')
st = r.state
eq(st.items[0].doneDays, ['2026-11-06'], '记下了哪天')
r = markDone(st, '写插件自检', T0900)
ok(r.ok && r.already, '第二次打勾说已经打过')
eq(r.state.items[0].doneDays.length, 1, '不重复记同一天')
ok(!markDone(st, '不存在的事', T0900).ok, '打查不到的勾要拒')

// ---- 划/挪/换 ----
st = emptyState()
st = addItem(st, { kind: 'fixed', text: '九点半的事', at: '09:30' }, T0900).state
st = addItem(st, { kind: 'elastic', text: '弹性事' }, T0900).state
ok(!selectItem(st, { action: 'move', key: '弹性事', at: '10:00' }, T0900).ok, '弹性事不许挪钟点')
ok(!selectItem(st, { action: 'move', key: '九点半的事', at: '9:30' }, T0900).ok, '挪到非法钟点要拒')
r = selectItem(st, { action: 'move', key: '九点半的事', at: '14:00' }, T0900)
ok(r.ok, '挪钟点')
st = r.state
eq(st.items.find((i) => i.text === '九点半的事').at, '14:00', '钟点真的变了')
r = selectItem(st, { action: 'swap', key: '九点半的事', text: '下午的事' }, T0900)
ok(r.ok, '换说法')
st = r.state
ok(st.items.some((i) => i.text === '下午的事'), '新说法在')
r = selectItem(st, { action: 'drop', key: '弹性事' }, T0900)
ok(r.ok, '划掉')
st = r.state
ok(st.items.find((i) => i.text === '弹性事').dropped === true, '划掉是标记不是删除')
ok(!selectItem(st, { action: 'nope', key: '下午的事' }, T0900).ok, '不认识的 action 要拒')

// ---- 到点判定 ----
st = emptyState()
st = addItem(st, { kind: 'fixed', text: '早上写', at: '09:30' }, T0900).state
st = addItem(st, { kind: 'fixed', text: '晚上写', at: '21:00' }, T0900).state
st = addItem(st, { kind: 'elastic', text: '弹性事' }, T0900).state
const T0931 = Date.parse('2026-11-06T01:31:00Z') // 上海 09:31
const T2101 = Date.parse('2026-11-06T13:01:00Z') // 上海 21:01
eq(dueItems(st, T0900).map((i) => i.text), [], '09:00 还没到 09:30，一条都不提')
eq(dueItems(st, T0931).map((i) => i.text), ['早上写'], '09:31 到了一条')
eq(dueItems(st, T2101).map((i) => i.text), ['早上写', '晚上写'], '21:01 到两条')
ok(!dueItems(st, T2101).some((i) => i.kind === 'elastic'), '弹性事永远不自动提')

// 提过就不再提
st = markReminded(st, dueItems(st, T2101).map((i) => i.id), T2101)
eq(dueItems(st, T2101), [], '提过一次之后当天不再提')

// 做过就不再提
st = emptyState()
st = addItem(st, { kind: 'fixed', text: '早上写', at: '09:30' }, T0900).state
st = markDone(st, '早上写', T0931).state
eq(dueItems(st, T0931), [], '做过了就不再提')

// 跨天重新算
const nextDay = Date.parse('2026-11-07T01:31:00Z') // 上海 11-07 09:31
eq(dueItems(st, nextDay).map((i) => i.text), ['早上写'], '第二天照旧该提（不是永久消掉）')

// ---- 今天该做什么：固定事按钟点排，弹性事跟后面 ----
let list = emptyState()
list = addItem(list, { kind: 'fixed', text: '晚的', at: '21:00' }, T0900).state
list = addItem(list, { kind: 'fixed', text: '早的', at: '09:30' }, T0900).state
list = addItem(list, { kind: 'elastic', text: '抽空' }, T0900).state
eq(todayItems(list, T0900).map((i) => i.text), ['早的', '晚的', '抽空'], '固定事按钟点排、弹性事在最后')
list = markDone(list, '早的', T0900).state
eq(todayItems(list, T0900)[0].doneToday, true, '打过勾的标出来')
eq(todayItems(list, T0900)[1].doneToday, false, '没打的没标')

// ---- 描述 ----
const emptyText = describe(emptyState(), T0900)
ok(emptyText.includes('单子上是空的'), '空单子要说清是空的')
ok(emptyText.includes('免打扰'), '描述里带 DND 状态')
const filled = describe(list, T0900)
ok(filled.includes('固定的事'), '有固定事那一段')
ok(filled.includes('弹性的事'), '有弹性事那一段')
ok(filled.includes('✓ 09:30 早的'), '打过勾的带勾')

// ---- 到点那句话 ----
const dueLine = renderDue([{ at: '09:30', text: '写自检' }], T0931)
ok(dueLine.includes('写自检'), '到点那句话带上事名')
ok(dueLine.includes('到点了'), '刚过几分钟说「到点了」')
ok(renderDue([{ at: '09:30', text: 'x' }], Date.parse('2026-11-06T01:40:00Z')).includes('过了 10 分钟'), '过了 5 分钟以上要说迟到多久')
eq(renderDue([], T0900), '', '没事就没这句话')

// ---- 旧账升级 ----
const up = normalizeState({ items: [{ kind: 'fixed', text: '老的', at: '9:30' }] })
ok(up.dnd && up.dnd.on === true, '旧账补上 DND')
eq(up.items[0].at, null, '钟点写坏的固定事：钟点清空，条目留着')
ok(normalizeState(null).items.length === 0, 'null 认成空账')
ok(normalizeState({ dnd: { start: '25:00' } }).dnd.start === DEFAULT_DND.start, '坏钟点回默认')
eq(normalizeState({ dnd: { on: false } }).dnd.on, false, '关着就保持关着')

// ---- 结果 ----
if (fails.length) {
  console.log(`没全过：${pass} 过，${fails.length} 没过`)
  for (const f of fails) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log(`全过：${pass} 项`)
