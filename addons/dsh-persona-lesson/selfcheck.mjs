/**
 * selfcheck.mjs —— lesson 的自检。`node selfcheck.mjs`，全绿再往下。
 * 只测纯逻辑（写一条、列几条、读一条、半条标记），不起进程。
 */
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from './index.js'

let pass = 0
const fails = []
function ok(cond, name) {
  if (cond) pass++
  else fails.push(name)
}

const dir = mkdtempSync(join(tmpdir(), 'lesson-'))
const cfg = { dir, file: '教训.jsonl', workspace: '' }
const tools = new Map()
const ctx = {
  effect(fn) { const d = fn(); return () => { try { d && d() } catch {} } },
  on() {},
  tools: { register(spec) { tools.set(spec.name, spec); return () => tools.delete(spec.name) } },
}
await apply(ctx, cfg)

ok(tools.has('lesson_write'), '注册了 lesson_write')
ok(tools.has('lesson_list'), '注册了 lesson_list')
ok(tools.has('lesson_read'), '注册了 lesson_read')

const call = async (name, args = {}) => String((await tools.get(name).execute(args)).text)

const w1 = await call('lesson_write', { title: '把局部当全部', what: '只验了三句就说不存在', cost: '师父多试两次', fix: '先问限定词', kind: '内置指令' })
ok(w1.includes('记下了'), '写入回执带「记下了」')
ok(!w1.includes('半条'), '写了代价不算半条')

const w2 = await call('lesson_write', { title: '心跳当版本', what: '看见心跳就说是新版', fix: '只认版本自证那行' })
ok(w2.includes('半条'), '没写代价标成半条')

const bad = await call('lesson_write', { title: '' })
ok(bad.includes('没办成') || bad.includes('要'), '缺字段被拦住')

const list = await call('lesson_list', { limit: 10 })
ok(list.includes('把局部当全部'), '列表里有第一条')
ok(list.includes('心跳当版本'), '列表里有第二条')
ok(list.indexOf('心跳当版本') < list.indexOf('把局部当全部'), '倒序：新的在前')

const byKind = await call('lesson_list', { kind: '内置指令' })
ok(byKind.includes('把局部当全部'), '按 kind 过滤命中')
ok(!byKind.includes('心跳当版本'), '按 kind 过滤排掉别的')

const all = readFileSync(join(dir, '教训.jsonl'), 'utf8').trim().split('\n')
ok(all.length === 2, '账上两行')
const row = JSON.parse(all[0])
ok(typeof row.id === 'string' && row.id.startsWith('L'), 'id 以 L 开头')
ok(row.half === undefined, '有代价的不带 half')

const one = await call('lesson_read', { id: row.id })
ok(one.includes('哪一步'), '读一条有「哪一步」')
ok(one.includes('下次判据'), '读一条有「下次判据」')

const miss = await call('lesson_read', { id: 'L-nope' })
ok(miss.includes('没这条') || miss.includes('找不到'), '读不到就说没这条')

rmSync(dir, { recursive: true, force: true })

if (fails.length) {
  console.log(`没全过：${pass} 过，${fails.length} 没过`)
  for (const f of fails) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log(`全过：${pass} 项`)
