// dsh-persona-gradient · 自检
// 只测纯函数：量具坏了要当场知道，不能等报数报出一堆假数。
// 跑法：node selfcheck.mjs

import { compare, countOf, measure, median, renderReport, splitSentences, textOf, textsOf } from './lib/metrics.mjs'

let pass = 0
let fail = 0

function ok(name, cond, extra = '') {
  if (cond) {
    pass += 1
    console.log(`  ✓ ${name}`)
  } else {
    fail += 1
    console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`)
  }
}

console.log('一、纯函数')
ok('median 取中位（奇数）', median([3, 1, 2]) === 2)
ok('median 取中位（偶数）', median([1, 2, 3, 4]) === 2.5)
ok('median 空数组给 0', median([]) === 0)
ok('countOf 数得对', countOf('嘛嘛嘛', '嘛') === 3)
ok('countOf 空针给 0', countOf('abc', '') === 0)
ok('splitSentences 按中文标点切', splitSentences('一。二！三？').length === 3)
ok('splitSentences 砍掉空句', splitSentences('。。。').length === 0)

console.log('二、取文本')
ok('字符串内容直接取', textOf({ content: '嗯' }) === '嗯')
ok(
  '块数组只挑 text，thinking 不算',
  textOf({ content: [{ type: 'thinking', thinking: '内心戏' }, { type: 'text', text: '说出来的' }] }) === '说出来的',
)
ok('只留她说的话', textsOf([
  { role: 'user', content: '师父说的' },
  { role: 'assistant', content: '她说的' },
]).join('') === '她说的')
ok('角色认不出的一律不算', textsOf([{ content: '没角色的' }]).length === 0)

console.log('三、量一遍')
const rich = '（把书签压平）真是的，又来烦我了嘛。哼，你们懂什么哲学。这条我找不到了，说不清。'
const flat = '好的。明白。可以。收到。'
const a = measure([rich])
const b = measure([flat])
ok('量得出段数', a.turns === 1 && a.sentences >= 3)
ok('有动作括号', a.parensPer100 > 0)
ok('有语气词', a.particlesPer100 > 0)
ok('有认领', a.claimsPer1000 > 0)
ok('平的那段没括号没认领', b.parensPer100 === 0 && b.claimsPer1000 === 0)
ok('平的句长比有话的短', b.medianLen < a.medianLen, `${b.medianLen} vs ${a.medianLen}`)

console.log('四、底线嫌疑只当嫌疑')
const risky = measure(['你应该这么做。显然，所有人都同意。绝对没问题。'])
ok('三类嫌疑都抓得到', risky.flags.length >= 3, JSON.stringify(risky.flags))
ok('干净的话不报嫌疑', measure(['嗯。']).flags.length === 0)

console.log('五、跟基线比')
const cmp = compare(b, a)
ok('能量出掉了几项', cmp.ok === true && cmp.weak.length >= 2, JSON.stringify(cmp.weak))
ok('没基线时说没基线', compare(a, null).ok === false)
ok('空数据说没数据', compare(measure([]), a).ok === false)
const text = renderReport(cmp, b)
ok('报数里有「掉了」', text.includes('掉了'))
ok('报数里写明是嫌疑线不是判决线', text.includes('嫌疑线'))

console.log('')
console.log(fail === 0 ? `全过：${pass} 项` : `有 ${fail} 项没过（过了 ${pass} 项）`)
process.exit(fail === 0 ? 0 : 1)
