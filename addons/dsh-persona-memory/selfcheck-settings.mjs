/**
 * dsh-persona-memory · 设置白名单自检
 * 只跑纯函数：白名单、范围、垃圾容错。
 * 不碰 DSH 运行时——那是另一层（脚本过 ≠ 插件在跑）。
 */
import assert from 'node:assert/strict'
import { EDITABLE, FIELDS, normalizePatch, normalizeStored, pickCurrent } from './lib/settings.mjs'

let n = 0
const t = (name, fn) => { fn(); n += 1; console.log(`  ok ${n}  ${name}`) }

t('白名单里有短期那几个', () => {
  for (const k of ['injectShortDays', 'shortBudgetChars', 'nowGapMinutes', 'injectTemp', 'injectNow']) {
    assert.ok(k in EDITABLE, `${k} 不在白名单`)
  }
})

t('路径不在白名单（设置页改不到 root／目录）', () => {
  for (const k of ['root', 'judgmentDir', 'journalDir', 'longTermDir']) {
    assert.ok(!(k in EDITABLE), `${k} 不该由设置页改`)
  }
})

t('表外的键一律不收', () => {
  const p = normalizePatch({ root: 'D:\\别的', injectShortDays: 3, 乱写: 1 })
  assert.deepEqual(p, { injectShortDays: 3 })
})

t('超范围的值不收（不夹带、不硬夹）', () => {
  assert.deepEqual(normalizePatch({ injectShortDays: 0 }), {})
  assert.deepEqual(normalizePatch({ injectShortDays: 999 }), {})
  assert.deepEqual(normalizePatch({ journalShare: 2 }), {})
})

t('小数与整数分开：share 收小数，天数只收整数', () => {
  assert.deepEqual(normalizePatch({ journalShare: 0.15 }), { journalShare: 0.15 })
  assert.deepEqual(normalizePatch({ injectShortDays: 2.6 }), { injectShortDays: 3 })
})

t('开关只认真值', () => {
  const p = normalizePatch({ injectTemp: false, injectNow: 'off' })
  assert.equal(p.injectTemp, false)
  assert.equal(p.injectNow, false)
})

t('垃圾输入不抛，当空', () => {
  for (const bad of [null, undefined, 42, 'x', [], true]) {
    assert.deepEqual(normalizePatch(bad), {})
    assert.deepEqual(normalizeStored(bad), {})
  }
})

t('盘上的旧文件混了别的东西，也只剩白名单', () => {
  const s = normalizeStored({ injectShortDays: 1, root: 'C:\\x', __proto__x: 1 })
  assert.deepEqual(s, { injectShortDays: 1 })
})

t('报给界面的当前值只含白名单', () => {
  const cur = pickCurrent({ root: 'C:\\x', injectShortDays: 2, budget: 2000 })
  assert.deepEqual(Object.keys(cur).sort(), ['budget', 'injectShortDays'])
})

t('每一行的 key 都在白名单里（界面画得出、服务端收得住）', () => {
  for (const g of FIELDS) {
    assert.ok(g.group && Array.isArray(g.rows))
    for (const row of g.rows) {
      assert.ok(row.key in EDITABLE, `${g.group}/${row.key} 没有对应白名单`)
      assert.ok(row.label, `${row.key} 缺 label`)
    }
  }
})

console.log(`\n${n} 条全过。`)
