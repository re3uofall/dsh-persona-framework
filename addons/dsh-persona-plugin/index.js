/**
 * dsh-persona-plugin —— 《插件》这一篇的功能实现层
 * ============================================================================
 * 只干一件事：把「装/卸/启停/回读插件」做成工具，外加每 10 分钟对一次
 * 「装了没登进 bundles／登了没装」的漂移账。
 *
 * 三条写死的边界：
 *   - 不注正文：模块 29 的正文由总模块从 `persona-ai/modules/` 轮转注入，
 *     这个包里没有 `module.md`，也不注册任何 `systemPrompt.section`。
 *   - 不碰别人的状态：只读 profile 的 `package.json`，写之前留 `.bak`。
 *   - 失败只坏自己：所有工具都 try/catch，回一句「没办成：…」，不外抛。
 *
 * 判据：装上 → 六个 `mod29_*` 工具在，`模29账.jsonl` 每 10 分钟长一行；
 *       卸下 → 工具没了、账不再长，别的插件不受影响。
 * ============================================================================
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { install as installImpl } from './lib/impl-tools.mjs'
import { tick } from './lib/tick.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'))

export const name = 'dsh-persona-plugin'
export const version = PKG.version
export const inject = ['tools']

const DEFAULTS = { workspace: '', stateDir: '.persona-framework' }

let sessionWs = ''

function noteSessionWorkspace(payload) {
  const cwd = payload && payload.agent && payload.agent.session && payload.agent.session.header && payload.agent.session.header.cwd
  if (typeof cwd === 'string' && cwd.trim()) sessionWs = cwd.trim()
}

export function apply(ctx, config) {
  const cfg = { ...DEFAULTS, ...(config || {}) }
  const ws = () => String(cfg.workspace || '').trim() || sessionWs || process.env.DSH_WORKSPACE || ''

  try { installImpl(ctx, cfg) } catch { /* 工具挂不上就只少这一层，别拖垮宿主 */ }

  try {
    ctx.on('agent/pre-step', (payload, next) => {
      noteSessionWorkspace(payload)
      try { if (ws()) tick({ ...(config || {}) }, ws()) } catch { /* 账写不进去不拦这一步 */ }
      return next()
    })
  } catch { /* 没有这个钩子就只靠手动调工具 */ }
}
