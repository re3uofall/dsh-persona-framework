/**
 * 自检：一个模块插件到底做了三件事没有——
 *   ① 有一篇正文（非空）；
 *   ② 注册了一条 section（名字 模块:<id>，order 205）；
 *   ③ 认到工作区之后写了登记条，卸载时把自己的登记撤掉、md 原件还在。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, name, version } from './index.js'

let pass = 0
let fail = 0
const ok = (c, m) => { if (c) { pass += 1; console.log('  ✓ ' + m) } else { fail += 1; console.log('  ✗ ' + m) } }

const PKG = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const MOD = PKG.dsh.module

const ws = mkdtempSync(join(tmpdir(), 'mod-probe-'))
let sectionSpec = null
let preStep = null
let disposers = []

const ctx = {
  on(ev, fn) { if (ev === 'agent/pre-step') preStep = fn },
  effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d); return d },
  systemPrompt: { section(spec) { sectionSpec = spec; return () => { sectionSpec = null } } },
}

apply(ctx, { workspace: '' })
ok(name === `persona-module-${MOD.id}`, `插件名跟着包走：${name}`)
ok(!!version, `版本号读得到：${version}`)
ok(!!sectionSpec, '注册了一条 section')
ok(sectionSpec && sectionSpec.name === `模块:${MOD.id}`, `section 名字是 模块:${MOD.id}`)
ok(sectionSpec && sectionSpec.order === 205, 'order 是 205')
const text = sectionSpec ? String(sectionSpec.text()) : ''
ok(text.length > 500, `正文非空（${text.length} 字）`)
ok(/^#/.test(text.split('\n')[0]), `正文第一行是标题：${text.split('\n')[0].slice(0, 24)}`)

const reg = join(ws, '.persona-framework', '模块插件.json')
ok(!existsSync(reg), '还没认到会话时先不登记（不往错的地方写）')

const ret = preStep({ agent: { session: { header: { cwd: ws } } } }, () => 'next')
ok(ret === 'next', 'pre-step 把 next() 还回去了（瀑布钩子不许吞）')
ok(existsSync(reg), '认到工作区后写了登记条')
const state = existsSync(reg) ? JSON.parse(readFileSync(reg, 'utf8')) : { modules: {} }
ok(!!state.modules[MOD.id], `登记条里有 ${MOD.id}`)
ok(state.modules[MOD.id] && state.modules[MOD.id].package === PKG.name, '登记条写的是自己的包名')

for (const d of disposers) d()
const after = JSON.parse(readFileSync(reg, 'utf8'))
ok(!after.modules[MOD.id], '卸载后自己的登记撤掉了')
ok(existsSync(new URL('./module.md', import.meta.url)), 'module.md 原件还在（内容没丢）')

rmSync(ws, { recursive: true, force: true })
console.log(`\n${fail === 0 ? '✓ 全过' : '✗ 有没过'}：${pass} 项过，${fail} 项没过`)
process.exit(fail === 0 ? 0 : 1)
