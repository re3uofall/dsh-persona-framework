import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from './index.js'

let pass = 0
const fails = []
const ok = (c, n) => (c ? pass++ : fails.push(n))

const ws = mkdtempSync(join(tmpdir(), 'insight-'))
const tools = new Map()
const ctx = {
  effect(fn) { const d = fn(); return () => { try { d && d() } catch {} } },
  on() { return () => {} },
  tools: { register(s) { tools.set(s.name, s); return () => tools.delete(s.name) } },
}
apply(ctx, { workspace: ws })
ok(tools.has('insight_write'), '注册 insight_write')
ok(tools.has('insight_list'), '注册 insight_list')
ok(tools.has('insight_read'), '注册 insight_read')

const call = async (n, a) => String((await tools.get(n).execute(a)).text)
const w1 = await call('insight_write', { text: '雨落在窗上没有声音。', mood: '沉' })
ok(w1.includes('落了一笔'), '写进去有回执')
const w2 = await call('insight_write', { text: '写到一半不想写了。' })
ok(w2.includes('落了一笔'), '第二条也落')
const empty = await call('insight_write', { text: '   ' })
ok(empty.includes('没写'), '空正文拒绝')
const list = await call('insight_list', { limit: 5 })
ok(list.includes('雨落在窗上'), '列表能翻到第一条')
ok(list.includes('不想写了'), '列表能翻到第二条')
const day = new Date().toISOString().slice(0, 10)
const read = await call('insight_read', { day })
ok(read.includes('不是判断'), '全文带抬头')
const bad = await call('insight_read', { day: '2026/11/12' })
ok(bad.includes('YYYY-MM-DD'), '日子格式不对要说清')
const f = join(ws, 'persona-ai', 'growth', '感悟', day + '.md')
ok(existsSync(f), '落盘位置对')
ok(readFileSync(f, 'utf8').includes('沉'), 'mood 写进去了')
rmSync(ws, { recursive: true, force: true })

if (fails.length) { console.log('没全过：' + pass + ' 过，' + fails.length + ' 没过'); for (const x of fails) console.log('  ✗ ' + x); process.exit(1) }
console.log('全过：' + pass + ' 项')
