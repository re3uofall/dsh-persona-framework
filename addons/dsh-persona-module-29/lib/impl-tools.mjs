/**
 * 模块 29「插件」的功能实现：把这一篇讲的事真做出来——装上、卸下、启停、回读。
 *
 * 判据（GUIDE-FEATURES.md）：改状态 + 不给人格字 + 下一轮它真的变了。
 * 所以这里一个 systemPrompt.section 都不注册，只碰 profile 的 package.json 与文件系统。
 * 形状借自 dsh-plugin-session-view（看/启停）与 dsh-dpk-manager（装前校验、装后回读），
 * 只借判据不借代码。
 */
import * as prof from './profile.mjs'

const OUTPUT = {
  schema: {
    type: 'object',
    properties: { text: { type: 'string', description: '给人看的结果正文' } },
    required: ['text'],
    additionalProperties: false,
  },
  render(_args, value) {
    return [{ type: 'text', text: String(value?.text ?? '') }]
  },
}

function say(ctx, cfg, spec) {
  ctx.tools.register({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    output: OUTPUT,
    async execute(args) {
      try {
        return { text: String(await spec.run(args || {}, cfg) ?? '') }
      } catch (err) {
        return { text: `没办成：${err && err.message ? err.message : String(err)}` }
      }
    },
  })
}

const NAME_PARAM = {
  type: 'object',
  properties: { name: { type: 'string', description: '包名，如 dsh-persona-sweep' } },
  required: ['name'],
  additionalProperties: false,
}

export function install(ctx, cfg) {
  if (!ctx || !ctx.tools || typeof ctx.tools.register !== 'function') return

  say(ctx, cfg, {
    name: 'mod29_list',
    description: '列出 profile 里已装（依赖里在）的插件包，以及它们在 dsh.profile.bundles 里登没登记。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => {
      const rows = prof.list(cfg)
      if (!rows.length) return 'profile 里一个包装依赖都没有。'
      const lines = rows.map((x) => `- ${x.name}${x.version ? ` ${x.version}` : ''}｜bundles：${x.enabled ? '在' : '不在'}`)
      return `装了 ${rows.length} 个：\n${lines.join('\n')}`
    },
  })

  say(ctx, cfg, {
    name: 'mod29_install',
    description: '装一个包进 profile（pnpm add），装完回读 package.json 确认依赖真的在；已在依赖里就跳过。',
    parameters: {
      type: 'object',
      properties: { spec: { type: 'string', description: '安装说明，如 dsh-persona-sweep@1.0.0 或 link:C:/x' } },
      required: ['spec'],
      additionalProperties: false,
    },
    run: async ({ spec }) => {
      const r = await prof.install(spec, cfg)
      if (r.skipped) return `${r.name} 已经在依赖里，跳过。`
      if (!r.ok) return `装失败（退出码 ${r.code}）：${String(r.tail || '').slice(-400)}`
      return `装上了：${r.name}——回读依赖：${r.dep ? '在' : '不在（这一条要当事故说）'}`
    },
  })

  say(ctx, cfg, {
    name: 'mod29_remove',
    description: '从 profile 卸一个包（pnpm remove），卸完回读依赖确实没了。',
    parameters: NAME_PARAM,
    run: async ({ name }) => {
      const r = await prof.remove(name, cfg)
      if (!r.ok) return `卸失败（退出码 ${r.code}）：${String(r.tail || '').slice(-400)}`
      return `卸了：${name}——回读依赖：${r.dep ? '还在（这一条要当事故说）' : '没了'}`
    },
  })

  for (const on of [true, false]) {
    say(ctx, cfg, {
      name: on ? 'mod29_enable' : 'mod29_disable',
      description: on
        ? '把一个已装的包登记进 dsh.profile.bundles（下一轮加载时上场）；写完回读。'
        : '把一个包从 dsh.profile.bundles 里摘掉（不再加载）；写完回读。',
      parameters: NAME_PARAM,
      run: async ({ name }) => {
        const r = prof.setEnabled(name, on, cfg)
        if (!r.ok) return `没改成：${r.error || '写配置失败'}`
        return `${on ? '登记' : '摘掉'}：${name}——回读 bundles：${r.readBack ? '在' : '不在'}`
      },
    })
  }

  say(ctx, cfg, {
    name: 'mod29_verify',
    description: '回读一个包的真实状态：依赖在不在、bundles 在不在、入口文件在不在。装完/卸完用它核对，不听回执听盘。',
    parameters: NAME_PARAM,
    run: async ({ name }) => {
      const r = prof.verify(name, cfg)
      return [
        `${name}`,
        `依赖：${r.dep ? '在' : '不在'}${r.dep ? `（${r.dep}）` : ''}`,
        `bundles：${r.enabled ? '在' : '不在'}`,
        `入口：${r.entry ? `在（${r.entry}）` : '不在'}`,
      ].join('；')
    },
  })
}
