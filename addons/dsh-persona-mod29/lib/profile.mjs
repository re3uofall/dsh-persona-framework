// 模块 29（插件）的功能实现：读写 profile 的 package.json，调 pnpm 装/卸。
// 形状借自市场里两件：dsh-plugin-session-view（启停已有包）、dsh-dpk-manager（装前校验、装后回读）。
// 不借它们的代码，只借这两条判据：每一步都要能回读真实状态；失败只坏自己。
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

export const DEFAULT_PROFILE = 'C:/Users/52624/.dsh/profiles/desktop'
export const PNPM = 'C:/Users/52624/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.mjs'
export const NODE = 'C:/Users/52624/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe'
export const ACCOUNT = '模29账.jsonl'
export const DEFAULTS = { profile: DEFAULT_PROFILE, dir: '.persona-framework', timeoutMs: 180000 }

export function stampNow(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, '-')
}

export function profilePath(opts = {}) {
  return (opts.profile || DEFAULTS.profile).replace(/[\\/]+$/, '')
}

export function pkgFile(opts = {}) {
  return join(profilePath(opts), 'package.json')
}

export function readProfile(opts = {}) {
  const file = pkgFile(opts)
  if (!existsSync(file)) return { ok: false, file, error: '没有 package.json' }
  try {
    return { ok: true, file, json: JSON.parse(readFileSync(file, 'utf8')) }
  } catch (e) {
    return { ok: false, file, error: String(e && e.message || e) }
  }
}

export function bundlesOf(json) {
  const p = json && json.dsh && json.dsh.profile
  return Array.isArray(p && p.bundles) ? p.bundles.slice() : []
}

export function writeProfile(json, opts = {}) {
  const file = pkgFile(opts)
  copyFileSync(file, file + '.bak')
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n')
  return file
}

// 装一个包：先校验它是不是已经在依赖里；装完回读 package.json，确认有这一条。
export function install(spec, opts = {}) {
  const before = readProfile(opts)
  if (!before.ok) return { ok: false, step: 'read', error: before.error }
  const name = pkgNameOf(spec)
  if (!name) return { ok: false, step: 'parse', error: '看不出包名：' + spec }
  if (before.json.dependencies && before.json.dependencies[name]) {
    return { ok: true, skipped: true, name, detail: '已经在依赖里：' + before.json.dependencies[name] }
  }
  const r = spawnSync(NODE, [PNPM, 'add', spec], { cwd: profilePath(opts), timeout: opts.timeoutMs || DEFAULTS.timeoutMs, encoding: 'utf8' })
  const after = readProfile(opts)
  const dep = after.ok && after.json.dependencies ? after.json.dependencies[name] : ''
  return {
    ok: !!(after.ok && dep),
    name,
    spec,
    code: r.status,
    dep,
    tail: String((r.stdout || '') + (r.stderr || '')).split(/\r?\n/).filter(Boolean).slice(-3).join(' | '),
  }
}

export function remove(name, opts = {}) {
  const before = readProfile(opts)
  if (!before.ok) return { ok: false, step: 'read', error: before.error }
  const r = spawnSync(NODE, [PNPM, 'remove', name], { cwd: profilePath(opts), timeout: opts.timeoutMs || DEFAULTS.timeoutMs, encoding: 'utf8' })
  const after = readProfile(opts)
  const still = after.ok && after.json.dependencies && after.json.dependencies[name]
  return { ok: !!(after.ok && !still), name, code: r.status, still: !!still }
}

// 启停：只动 dsh.profile.bundles 这一处，不碰别的包。
export function setEnabled(name, on, opts = {}) {
  const r = readProfile(opts)
  if (!r.ok) return { ok: false, error: r.error }
  const json = r.json
  json.dsh = json.dsh || {}
  json.dsh.profile = json.dsh.profile || {}
  const list = bundlesOf(json)
  const has = list.includes(name)
  if (on && !has) list.push(name)
  if (!on && has) list.splice(list.indexOf(name), 1)
  json.dsh.profile.bundles = list
  const file = writeProfile(json, opts)
  const back = readProfile(opts)
  const now = back.ok ? bundlesOf(back.json).includes(name) : null
  return { ok: now === !!on, name, on, changed: has !== (now === true), file, readBack: now }
}

export function list(opts = {}) {
  const r = readProfile(opts)
  if (!r.ok) return { ok: false, error: r.error }
  const deps = Object.keys(r.json.dependencies || {})
  const bundles = bundlesOf(r.json)
  return {
    ok: true,
    profile: profilePath(opts),
    deps: deps.length,
    bundles: bundles.length,
    rows: deps.map((d) => ({ name: d, version: r.json.dependencies[d], enabled: bundles.includes(d) })),
  }
}

export function pkgNameOf(spec) {
  const s = String(spec || '').trim()
  if (!s) return ''
  const at = s.lastIndexOf('@')
  if (s.startsWith('@')) return at > 0 ? s.slice(0, at) : s
  return at > 0 ? s.slice(0, at) : s
}
