import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULTS, listLedgers, sweepFile, sweepAll, dueNow, renderStatus, renderReport, readState, writeState, appendRecord, statePath } from './lib/sweep.mjs'

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) { pass++; console.log('ok   ' + name) } else { fail++; console.log('FAIL ' + name) } }

// 1 默认值
ok('DEFAULTS.maxLines 是 300', DEFAULTS.maxLines === 300)
ok('DEFAULTS.keepLines 是 80', DEFAULTS.keepLines === 80)

const ws = mkdtempSync(join(tmpdir(), 'sweep-'))
const dir = join(ws, '.persona-framework')
mkdirSync(dir, { recursive: true })
writeFileSync(join(ws, 'placeholder'), '')

// 2 空目录不炸
ok('空目录 listLedgers 回空数组', Array.isArray(listLedgers(ws)) && listLedgers(ws).length === 0)

// 3 造一本 200 行的账
const big = join(dir, '大账.jsonl')
writeFileSync(big, Array.from({ length: 200 }, (_, i) => JSON.stringify({ i })).join('\n') + '\n')
const list = listLedgers(ws)
ok('listLedgers 数到 1 本', list.length === 1)
ok('listLedgers 数到 200 行', list[0].lines === 200)

// 4 没超阈值不压实
const r1 = sweepFile(big, { maxLines: 300, keepLines: 80 })
ok('没超阈值：skipped', r1.skipped === true)

// 5 超阈值：归档 + 留尾
const r2 = sweepFile(big, { maxLines: 100, keepLines: 50 })
ok('超阈值：不 skip', r2.skipped === false)
ok('超阈值：after 是 50 行', r2.after === 50)
const archived = readdirSync(join(dir, '_archive'))
ok('归档文件真的在', archived.length === 1 && archived[0].endsWith('.jsonl'))
const after = readFileSync(big, 'utf8').trim().split('\n')
ok('留下的是尾部：最后一行是 199', JSON.parse(after[after.length - 1]).i === 199)

// 6 sweepAll + 账
const res = sweepAll(ws, { maxLines: 10, keepLines: 5 })
ok('sweepAll 扫到 1 本', res.scanned === 1)
ok('sweepAll 又压实了 1 本', res.compacted.length === 1)
writeState(ws, res)
appendRecord(ws, res)
appendRecord(ws, { at: res.at, scanned: 0, compacted: [] })
ok('状态文件在', existsSync(statePath(ws)))
ok('状态里 scanned 有值', readState(ws).scanned === 1)
const ledger = readFileSync(join(dir, '清扫账.jsonl'), 'utf8').trim().split('\n')
ok('清扫账 2 行', ledger.length === 2)

// 7 冷却
ok('刚跑完 dueNow 为 false', dueNow({ at: new Date().toISOString() }, { cooldownMin: 15 }) === false)
ok('很久以前 dueNow 为 true', dueNow({ at: '2000-01-01T00:00:00.000Z' }, { cooldownMin: 15 }) === true)

// 8 渲染
const s = renderStatus(readState(ws))
ok('renderStatus 出字', typeof s === 'string' && s.length > 10 && s.includes('清扫'))
const rep = renderReport(listLedgers(ws))
ok('renderReport 出字', typeof rep === 'string' && rep.length > 5)

// 9 单本出错不中断
writeFileSync(join(dir, '坏账.jsonl'), 'not json\n'.repeat(120))
const res2 = sweepAll(ws, { maxLines: 100, keepLines: 20 })
console.log('  debug compacted:', JSON.stringify(res2.compacted));ok('坏账也被压实（按行切，不解析）', res2.compacted.some((c) => String(c.file).includes('坏账')))

rmSync(ws, { recursive: true, force: true })
console.log(`\n${pass} 项过，${fail} 项没过`)
process.exit(fail ? 1 : 0)
