/**
 * selfcheck：不装 DSH 也能验的那部分。
 * 跑：node selfcheck.mjs
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHANNEL_KINDS, channelNames, channelOf, channelReady, sendVia } from './lib/channel.mjs'
import { appendSaying, briefOf, countSayings, readPending, readSayings, renderSayings, writePending } from './lib/saying.mjs'

let pass = 0
const fails = []
function ok(name, cond, detail) {
  if (cond) pass++
  else fails.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
function eq(name, got, want) {
  ok(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
}

const dir = mkdtempSync(join(tmpdir(), 'mouth-selfcheck-'))
const log = join(dir, '嘴账.jsonl')
const pending = join(dir, '嘴账状态.json')

// ---- briefOf --------------------------------------------------------------
eq('briefOf 成功', briefOf({ to: '师父', text: '在', channel: 'file:file', ok: true }), '✓ → 师父：「在」（file:file）')
eq('briefOf 失败', briefOf({ to: '师父', text: '在', ok: false, code: 401 }), '✗(401) → 师父：「在」')
eq('briefOf 没 code', briefOf({ text: 'x', ok: false, code: null }), '✗(?) 「x」')
ok('briefOf 长话截断', briefOf({ text: 'a'.repeat(200), ok: true }).includes('…'))
eq('briefOf 压平空白', briefOf({ text: 'a  \n b', ok: true }), '✓ 「a b」')

// ---- 嘴账读写 --------------------------------------------------------------
appendSaying(log, { at: '2026-11-07T00:00:00Z', to: 'a', text: '一', ok: true })
appendSaying(log, { at: '2026-11-07T00:00:01Z', to: 'b', text: '二', ok: false, code: 3 })
eq('countSayings 两条', countSayings(log), 2)
eq('readSayings limit=1', readSayings(log, 1).length, 1)
eq('readSayings 最后一条', readSayings(log, 1)[0].text, '二')
eq('readSayings 不存在', readSayings(join(dir, '无.jsonl'), 5).length, 0)
eq('countSayings 不存在', countSayings(join(dir, '无.jsonl')), 0)

// ---- renderSayings ---------------------------------------------------------
eq('renderSayings 空', renderSayings([]), '嘴账还是空的——一句真说出去的话都没有。')
ok('renderSayings 有字', renderSayings([{ text: '一', ok: true }]).startsWith('- ✓'))

// ---- pending ---------------------------------------------------------------
eq('readPending 空', readPending(pending).pending.length, 0)
writePending(pending, { pending: ['✓ → 师父：「在」', '✗(3) → a：「二」'], spokenAt: '' })
eq('writePending/readPending 往返', readPending(pending).pending.length, 2)
ok('writePending 带 at', typeof JSON.parse(readFileSync(pending, 'utf8')).at === 'string')
writePending(pending, { pending: [], spokenAt: '2026-11-07T00:00:00Z' })
eq('pending 清空后', readPending(pending).pending.length, 0)

// ---- 通道表 ----------------------------------------------------------------
ok('CHANNEL_KINDS 三样', CHANNEL_KINDS.length === 3 && CHANNEL_KINDS.includes('file'))
ok('channelNames 默认有 file', channelNames({}).includes('file'))
ok('channelNames 自定义也在', channelNames({ hook: { kind: 'http', url: 'x' } }).includes('hook'))
eq('channelOf 默认 file', channelOf('file', {}).kind, 'file')
eq('channelOf 没有的通道', channelOf('nope', {}), null)
eq('channelOf 自定义盖默认', channelOf('file', { file: { kind: 'http', url: 'http://x' } }).kind, 'http')

// ---- channelReady ----------------------------------------------------------
ok('channelReady file 能送', channelReady({ kind: 'file', path: 'a.md' }, { workspace: dir }).ready)
ok('channelReady command 没命令', !channelReady({ kind: 'command' }, {}).ready)
ok('channelReady http 没 url', !channelReady({ kind: 'http' }, {}).ready)
ok('channelReady 不认识', !channelReady({ kind: 'smoke' }, {}).ready)

// ---- sendVia: file 真写 ----------------------------------------------------
const fch = { kind: 'file', path: '.persona-framework/嘴/发件箱.md' }
const r1 = await sendVia(fch, { to: '师父', text: '在' }, { workspace: dir })
ok('file 送成了', r1.ok === true, r1.detail)
ok('file 回报字节数', /字节/.test(r1.detail), r1.detail)
const outbox = readFileSync(join(dir, '.persona-framework/嘴/发件箱.md'), 'utf8')
ok('发件箱里有那句话', outbox.includes('在') && outbox.includes('师父'), outbox.slice(0, 120))
const r2 = await sendVia(fch, { to: '', text: '   ' }, { workspace: dir })
ok('空话不送', r2.ok === false && /空/.test(r2.detail), r2.detail)
const r3 = await sendVia(null, { text: 'x' }, { workspace: dir })
ok('没通道不送', r3.ok === false, r3.detail)
const r4 = await sendVia({ kind: 'smoke' }, { text: 'x' }, { workspace: dir })
ok('不认识的通道类型', r4.ok === false && /不认识/.test(r4.detail), r4.detail)
const r5 = await sendVia({ kind: 'command' }, { text: 'x' }, { workspace: dir })
ok('command 没写命令', r5.ok === false && /没写命令/.test(r5.detail), r5.detail)
const r6 = await sendVia({ kind: 'http' }, { text: 'x' }, { workspace: dir })
ok('http 没写 url', r6.ok === false && /没写 url/.test(r6.detail), r6.detail)

// ---- sendVia: command 真跑（PowerShell，本机有） ---------------------------
const cch = { kind: 'command', command: "Write-Output ('送到:{to}')" }
const c1 = await sendVia(cch, { to: '阿b', text: '' }, { workspace: dir })
// 空话会被拦，换一句真有内容的
const c2 = await sendVia(cch, { to: '阿b', text: '在' }, { workspace: dir })
ok('command 通道真跑', c2.ok === true, c2.detail)
ok('command 回执有输出', /送到:/.test(c2.detail), c2.detail)
const c3 = await sendVia({ kind: 'command', command: 'exit 7' }, { text: '在' }, { workspace: dir })
ok('command 退出码非 0 就不算送到', c3.ok === false && c3.code === 7, JSON.stringify(c3))
ok('c1 空话被拦', c1.ok === false)

rmSync(dir, { recursive: true, force: true })

if (fails.length) {
  console.log(`✗ ${fails.length} 项没过（过了 ${pass} 项）：`)
  for (const f of fails) console.log(`  - ${f}`)
  process.exit(1)
}
console.log(`✓ ${pass} 项全过`)
