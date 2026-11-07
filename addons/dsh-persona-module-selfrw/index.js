/**
 * dsh-persona-module-<id> —— 一个模块长成一个插件（样板）
 * ============================================================================
 * 一句话：**模块正文不再由总模块从 md 里读，而是由它自己的包注进来。**
 *
 * 这个包里没有逻辑，只有三样：
 *   1. 这篇模块的正文（`module.md`，从 `persona-ai/modules/<id>-<名>.md` 搬来的原件）；
 *   2. 一条 `systemPrompt.section`（名字 `模块:<id>`，order 205，每轮都在）；
 *   3. 一张登记条（`<ws>/.persona-framework/模块插件.json`）——告诉总模块
 *      「这一篇我自己注，你别再从 md 里注一遍」。
 *
 * 三条写死的边界：
 *   - 只注正文，不加工具、不写账、不做触发器——模块是知识，不是器官。
 *   - 不藏字：`module.md` 与 `persona-ai/modules/` 里那篇是同一份，改哪边都要同步。
 *   - 卸载要留痕：`ctx.effect` 的清理函数把登记条删掉，总模块下一轮就把这片收回去。
 *
 * 判据（怎么算这条路径成了）：
 *   装上 → 总模块那一轮不再从 md 里读到 `<id>-`，`模块:<id>` 段自己出来；
 *   卸下 → 段没了，登记条没了，md 那篇还在原处（内容没丢）。
 * ============================================================================
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'))
const MOD = (PKG.dsh && PKG.dsh.module) || {}
const MOD_ID = String(MOD.id || '').padStart(2, '0')
const MOD_TITLE = String(MOD.title || MOD_ID)

export const name = `persona-module-${MOD_ID}`
export const version = PKG.version
export const inject = ['systemPrompt']

const DEFAULTS = {
  workspace: '',
  stateDir: '.persona-framework',
  order: 205,
  enabled: true,
}

let sessionWs = ''

function noteSessionWorkspace(payload) {
  const cwd = payload && payload.agent && payload.agent.session && payload.agent.session.header && payload.agent.session.header.cwd
  if (typeof cwd === 'string' && cwd.trim()) sessionWs = cwd.trim()
}

export function apply(ctx, config) {
  const cfg = { ...DEFAULTS, ...(config || {}) }
  const ws = () => String(cfg.workspace || '').trim() || sessionWs || process.env.DSH_WORKSPACE || ''
  const registryPath = () => join(ws(), String(cfg.stateDir || '.persona-framework'), '模块插件.json')

  let cached = ''
  const body = () => {
    if (cached) return cached
    try {
      cached = readFileSync(join(HERE, 'module.md'), 'utf8').replace(/\r\n/g, '\n').trim()
    } catch { cached = '' }
    return cached
  }

  /** 登记：告诉总模块「这一篇别再从 md 里注」。没有工作区就先不写，等 pre-step 认出来。 */
  function register() {
    const p = ws()
    if (!p) return false
    try {
      const file = registryPath()
      mkdirSync(dirname(file), { recursive: true })
      let state = { modules: {} }
      try {
        if (existsSync(file)) {
          const raw = JSON.parse(readFileSync(file, 'utf8'))
          if (raw && typeof raw === 'object' && raw.modules && typeof raw.modules === 'object') state = raw
        }
      } catch { /* 坏了就重写，不装成读过了 */ }
      state.modules[MOD_ID] = {
        package: PKG.name,
        title: MOD_TITLE,
        at: new Date().toISOString(),
      }
      writeFileSync(file, JSON.stringify(state, null, 2) + '\n', 'utf8')
      return true
    } catch { return false }
  }

  /** 撤销登记：只删自己那一格，别人的不动。 */
  function unregister() {
    const p = ws()
    if (!p) return
    try {
      const file = registryPath()
      if (!existsSync(file)) return
      const state = JSON.parse(readFileSync(file, 'utf8'))
      if (!state || !state.modules) return
      delete state.modules[MOD_ID]
      writeFileSync(file, JSON.stringify(state, null, 2) + '\n', 'utf8')
    } catch { /* 清理失败不抛：下一轮 apply 会重写 */ }
  }

  try {
    ctx.on('agent/pre-step', (payload, next) => {
      noteSessionWorkspace(payload)
      try { register() } catch {}
      return next()
    })
  } catch { /* 没有这个钩子就只靠 apply 那一次 */ }

  register()

  if (cfg.enabled !== false) {
    ctx.effect(() => {
      const off = ctx.systemPrompt.section({
        name: `模块:${MOD_ID}`,
        order: Number(cfg.order) || 205,
        interpolate: false,
        text: () => body(),
      })
      return () => {
        unregister()
        if (typeof off === 'function') off()
      }
    })
  }
}
