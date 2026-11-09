#!/usr/bin/env node
/** dsh-pet-sisi 自检：包元数据、语法、导出、工具与段、locale、钩子、地址发现。 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from "node:url"
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = fileURLToPath(new URL('.', import.meta.url)).replace(/^\/([A-Za-z]:)/, '$1')
let pass = 0
const fails = []
function ok(cond, label, detail = '') {
  if (cond) pass += 1
  else fails.push(detail ? `${label} — ${detail}` : label)
}

const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))
ok(pkg.name === 'dsh-pet-sisi', '包名是 dsh-pet-sisi', pkg.name)
ok(/^\d+\.\d+\.\d+/.test(String(pkg.version)), 'package.json 有版本', pkg.version)
const check = spawnSync(process.execPath, ['--check', join(here, 'index.js')], { encoding: 'utf8' })
ok(check.status === 0, 'index.js 语法通过', (check.stderr || '').slice(0, 200))

const mod = await import(pathToFileURL(join(here, 'index.js')).href)
ok(mod.name === 'dsh-pet-sisi', '导出了 name', mod.name)
ok(typeof mod.version === 'string', '导出了 version', mod.version)
ok(Array.isArray(mod.inject) && mod.inject.includes('tools'), 'inject 含 tools', JSON.stringify(mod.inject))
ok(typeof mod.apply === 'function', '导出了 apply')

const tools = []
const sections = []
const hooks = []
let effects = 0
const ctx = {
  effect(fn) { effects += 1; fn(); return () => {} },
  tools: { register(spec) { tools.push(spec) } },
  systemPrompt: {
    section(spec) { sections.push(spec) },
    context(spec) { sections.push(spec) },
  },
  on(name) { hooks.push(name) },
}
mod.apply(ctx, {})

const names = tools.map((t) => t.name)
for (const want of ['pet_status', 'pet_read', 'pet_say', 'pet_whisper', 'pet_do', 'pet_config', 'pet_api']) {
  ok(names.includes(want), `有工具 ${want}`)
}
ok(tools.every((t) => t.output && typeof t.output.render === 'function'), '每个工具的 output 是对象')
ok(tools.every((t) => typeof t.execute === 'function'), '每个工具有 execute')
ok(sections.some((s) => s.name === '实时环境:pet'), '注册了 实时环境:pet')
ok(sections.every((s) => Number.isFinite(s.order)), '段都有 order')
ok(hooks.includes('agent/pre-step'), '挂了 agent/pre-step')
ok(effects >= 8, '用 ctx.effect 注册', String(effects))

for (const f of ['locale/zh.json', 'locale/en.json']) {
  const p = join(here, f)
  ok(existsSync(p), `${f} 存在`)
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'))
    ok(Boolean(j?.meta?.title), `${f} 有 meta.title`)
  } catch (e) {
    ok(false, `${f} 能被解析`, String(e?.message || e))
  }
}
ok(existsSync(join(here, 'cordis.patch.yml')), 'cordis.patch.yml 存在')
ok(existsSync(join(here, 'icon.svg')), 'icon.svg 存在')

console.log(fails.length ? `过了 ${pass} 项，没过 ${fails.length} 项：\n- ${fails.join('\n- ')}` : `全部过了：${pass} 项过，0 项没过`)
process.exit(fails.length ? 1 : 0)
