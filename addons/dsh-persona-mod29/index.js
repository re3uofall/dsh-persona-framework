// 模块 29「插件」的功能实现：装上、卸下、启停、回读。
// 只改 profile 的 package.json 与 pnpm 依赖，不写人格字、不注册 systemPrompt 段。
import { appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import * as prof from './lib/profile.mjs'

export const name = 'dsh-persona-mod29'
export const version = '0.1.0'
export const inject = ['tools']

const textOutput = {
  schema: {
    type: 'object',
    properties: { text: { type: 'string', description: '给模型看的结果正文' } },
    required: ['text'],
    additionalProperties: false,
  },
  render(_args, value) {
    return [{ type: 'text', text: String(value?.text ?? '') }]
  },
}

let sessionWs = ''

function ws(config) {
  return sessionWs || config?.workspace || process.cwd()
}

function accountPath(config) {
  const dir = join(ws(config), config?.dir || '.persona-framework')
  mkdirSync(dir, { recursive: true })
  return join(dir, prof.ACCOUNT)
}

function note(config, row) {
  try {
    appendFileSync(accountPath(config), JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n')
  } catch { /* 账写不进去不挡动作，但调用方会看到 ok 为真 */ }
}

function line(r) {
  if (!r) return '没办成：没有结果'
  if (r.skipped) return `已经装着了：${r.name}（${r.detail || ''}）`
  if (r.ok) return `成了：${r.name}${r.dep ? '（' + r.dep + '）' : ''}`
  return `没办成：${r.name || ''} 退出码 ${r.code ?? '?'}${r.error ? ' —— ' + r.error : ''}`
}

export function apply(ctx, config = {}) {
  const cfg = { ...prof.DEFAULTS, ...config }

  try {
    ctx.on('agent/pre-step', (payload, next) => {
      const cwd = payload?.agent?.session?.header?.cwd
      if (typeof cwd === 'string' && cwd) sessionWs = cwd
      return next()
    })
  } catch { /* 没有这个钩子就只靠 config.workspace */ }

  const reg = (spec) => ctx.effect(() => ctx.tools.register({ output: textOutput, ...spec }))

  reg({
    name: 'mod29_list',
    description: '列出 profile 里装了哪些包、哪些在 bundles 里启用着。只读。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      const r = prof.list(cfg)
      if (!r.ok) return { text: '读不到 profile：' + r.error }
      const on = r.rows.filter((x) => x.enabled).length
      return {
        text: [
          `profile：${r.profile}`,
          `依赖 ${r.deps} 个，启用 ${on} 个（bundles ${r.bundles} 条）`,
          ...r.rows.map((x) => `${x.enabled ? '●' : '○'} ${x.name} ${x.version}`),
        ].join('\n'),
      }
    },
  })

  reg({
    name: 'mod29_install',
    description: '装一个包到 profile（pnpm add），装完回读 package.json 确认依赖真的在。',
    parameters: {
      type: 'object',
      properties: { spec: { type: 'string', description: '包名或「包名@版本」或 link: 路径' } },
      required: ['spec'],
      additionalProperties: false,
    },
    async execute({ spec }) {
      const r = prof.install(spec, cfg)
      note(cfg, { op: 'install', spec, ok: !!r.ok, name: r.name })
      return { text: line(r) }
    },
  })

  reg({
    name: 'mod29_enable',
    description: '把一个已装的包写进 dsh.profile.bundles（启用），写完回读确认。',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: '包名' } },
      required: ['name'],
      additionalProperties: false,
    },
    async execute({ name: pkg }) {
      const r = prof.setEnabled(pkg, true, cfg)
      note(cfg, { op: 'enable', name: pkg, ok: !!r.ok })
      return { text: r.ok ? `启用了：${pkg}（回读：在）` : `没办成：${pkg} ${r.error || '回读对不上'}` }
    },
  })

  reg({
    name: 'mod29_disable',
    description: '把一个包从 dsh.profile.bundles 里去掉（停用），不卸依赖。',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: '包名' } },
      required: ['name'],
      additionalProperties: false,
    },
    async execute({ name: pkg }) {
      const r = prof.setEnabled(pkg, false, cfg)
      note(cfg, { op: 'disable', name: pkg, ok: !!r.ok })
      return { text: r.ok ? `停用了：${pkg}（回读：不在 bundles 里）` : `没办成：${pkg} ${r.error || '回读对不上'}` }
    },
  })

  reg({
    name: 'mod29_remove',
    description: '卸掉一个包的依赖（pnpm remove），卸完回读确认依赖已不在。',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: '包名' } },
      required: ['name'],
      additionalProperties: false,
    },
    async execute({ name: pkg }) {
      const r = prof.remove(pkg, cfg)
      note(cfg, { op: 'remove', name: pkg, ok: !!r.ok })
      return { text: r.ok ? `卸掉了：${pkg}` : `没办成：${pkg} 依赖还在（${r.code ?? '?'}）` }
    },
  })

  reg({
    name: 'mod29_verify',
    description: '回读状态：某个包在不在依赖里、在不在 bundles 里。只读。',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: '包名' } },
      required: ['name'],
      additionalProperties: false,
    },
    async execute({ name: pkg }) {
      const r = prof.readProfile(cfg)
      if (!r.ok) return { text: '读不到 profile：' + r.error }
      const dep = r.json.dependencies ? r.json.dependencies[pkg] || '' : ''
      const on = prof.bundlesOf(r.json).includes(pkg)
      return { text: `${pkg}：依赖 ${dep ? '在（' + dep + '）' : '不在'}；bundles ${on ? '在' : '不在'}` }
    },
  })

  return { profile: prof.profilePath(cfg), account: accountPath(cfg) }
}
