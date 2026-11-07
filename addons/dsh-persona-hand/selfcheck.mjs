/**
 * selfcheck：不装 DSH 也能验的那部分。
 * 跑：node selfcheck.mjs
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendReceipt, briefOf, countReceipts, readPending, readReceipts, renderReceipts, writePending } from './lib/receipt.mjs'
import { decodeOutput, firstLine, runCommand, sniffEncoding } from './lib/run.mjs'

let pass = 0
const fails = []
function ok(name, cond, detail) {
  if (cond) pass++
  else fails.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
function eq(name, got, want) {
  ok(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
}

const dir = mkdtempSync(join(tmpdir(), 'hand-selfcheck-'))
const log = join(dir, '手账.jsonl')
const pending = join(dir, '手账状态.json')

// ---- briefOf --------------------------------------------------------------
eq('briefOf 成功', briefOf({ command: 'Write-Output hi', code: 0, first: 'hi' }), '✓ Write-Output hi → hi')
eq('briefOf 失败', briefOf({ command: 'exit 3', code: 3 }), '✗(3) exit 3')
eq('briefOf 没退出码', briefOf({ command: 'x', code: null }), '✗(?) x')
ok('briefOf 长命令截断', briefOf({ command: 'a'.repeat(200), code: 0 }).includes('…'))
ok('briefOf 长首行截断', briefOf({ command: 'c', code: 0, first: 'b'.repeat(200) }).includes('…'))
eq('briefOf 压平空白', briefOf({ command: 'a   b\n c', code: 0 }), '✓ a b c')

// ---- 手账读写 --------------------------------------------------------------
appendReceipt(log, { at: '2026-11-07T00:00:00Z', command: 'echo a', code: 0, first: 'a' })
appendReceipt(log, { at: '2026-11-07T00:00:01Z', command: 'echo b', code: 1, first: 'b' })
eq('countReceipts 两条', countReceipts(log), 2)
eq('readReceipts limit=1', readReceipts(log, 1).length, 1)
eq('readReceipts 拿到最后一条', readReceipts(log, 1)[0].command, 'echo b')
eq('readReceipts 不存在的文件', readReceipts(join(dir, '无.jsonl'), 5).length, 0)
eq('countReceipts 不存在的文件', countReceipts(join(dir, '无.jsonl')), 0)

// ---- renderReceipts --------------------------------------------------------
eq('renderReceipts 空', renderReceipts([]), '手账还是空的——一件真动过的事都没有。')
ok('renderReceipts 有字', renderReceipts([{ command: 'echo a', code: 0, first: 'a' }]).startsWith('- ✓'))

// ---- pending ---------------------------------------------------------------
eq('readPending 空', readPending(pending).pending.length, 0)
writePending(pending, { pending: ['✓ a → 1', '✗(2) b'], spokenAt: '' })
eq('writePending/readPending 往返', readPending(pending).pending.length, 2)
ok('writePending 带 at', typeof JSON.parse(readFileSync(pending, 'utf8')).at === 'string')
writePending(pending, { pending: [], spokenAt: '2026-11-07T00:00:00Z' })
eq('pending 清空后', readPending(pending).pending.length, 0)

// ---- firstLine -------------------------------------------------------------
eq('firstLine 取第一行', firstLine({ out: '\n  hello  \nsecond' }), 'hello')
eq('firstLine 空', firstLine({ out: '' }), '')
eq('firstLine 只有错误', firstLine({ err: 'boom\nx' }), 'boom')

// ---- runCommand（真跑） -----------------------------------------------------
const r1 = await runCommand('Write-Output hi', { timeoutMs: 20000 })
ok('runCommand 成功退出码 0', r1.ok && r1.code === 0, JSON.stringify(r1).slice(0, 200))
eq('runCommand 首行 hi', firstLine(r1), 'hi')
const r2 = await runCommand('exit 3', { timeoutMs: 20000 })
ok('runCommand 失败带退出码', r2.ok && r2.code === 3, JSON.stringify(r2).slice(0, 200))
const r3 = await runCommand('', {})
ok('runCommand 空命令不跑', r3.ok === false && r3.why.includes('没给命令'))
const r4 = await runCommand('Write-Output 中文', { timeoutMs: 20000 })
eq('runCommand 中文不乱码', firstLine(r4), '中文')


// ---- 输出编码（借 dsh-win32 的 sniff 形状，自己实现） ----------------------
eq('sniff 空 -> utf8', sniffEncoding(Buffer.alloc(0)), 'utf8')
eq('sniff 普通 utf8', sniffEncoding(Buffer.from('中文', 'utf8')), 'utf8')
eq('sniff GBK', sniffEncoding(Buffer.from([0xc4, 0xe3, 0xba, 0xc3])), 'gbk')
eq('sniff UTF-16LE 带 BOM', sniffEncoding(Buffer.from([0xff, 0xfe, 0x2d, 0x4e])), 'utf16le')
eq('sniff 无 BOM 的 UTF-16LE', sniffEncoding(Buffer.from([0x2d, 0x00, 0x4e, 0x00, 0x2d, 0x00, 0x4e, 0x00])), 'utf16le')
eq('decode GBK 中文', decodeOutput(Buffer.from([0xc4, 0xe3, 0xba, 0xc3])), '你好')
eq('decode UTF-8 原样', decodeOutput(Buffer.from('中文', 'utf8')), '中文')
eq('decode UTF-16LE BOM', decodeOutput(Buffer.from([0xff, 0xfe, 0x2d, 0x4e, 0x87, 0x65])), '中文')
rmSync(dir, { recursive: true, force: true })

console.log(`\n手 自检：${pass} 项过，${fails.length} 项没过`)
if (fails.length) {
  for (const f of fails) console.log(`  ✗ ${f}`)
  process.exit(1)
}
