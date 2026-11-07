/**
 * dsh-persona-console —— 人格框架台（host 半端）
 * ============================================================================
 * 侧栏那个「人格框架」页的数据口：把这一套拆成三组摆出来，和 DSH 原来的插件页分开。
 *
 *   1. 总模块插件   —— 框架本体 `dsh-persona-framework`：注入、模块调度、配额
 *   2. 模块功能实现 —— `persona-ai/modules/*.md`：真的模块正文（不是「插件」）
 *   3. 附加插件     —— `dsh-persona-framework/addons/*`：手、嘴、记忆、日记……
 *
 * 只读：扫目录、读 package.json 与 locale/zh.json，不改任何东西。
 * 判据是「盘上有没有这个包、bundles 里登没登记」——不是「我记得装过」。
 * ============================================================================
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'dsh-persona-console'
export const inject = ['webServer']

const API = '/api/persona-console'

/** 这一步的会话工作区：宿主把它放在 payload.agent.session.header.cwd。 */
let sessionWs = null

function noteSessionWs(payload) {
  const cwd = payload?.agent?.session?.header?.cwd
  if (typeof cwd === 'string' && cwd.trim()) sessionWs = cwd.trim()
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function isDir(p) {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** 取 md 第一行 `# 标题`；没有就用文件名。 */
function headingOf(file, fallback) {
  try {
    const text = readFileSync(file, 'utf8')
    const m = text.match(/^#\s+(.+?)\s*$/m)
    if (m) return m[1].trim()
  } catch { /* 读不了就退回文件名 */ }
  return fallback
}

function moduleOrder(id) {
  const m = /^(\d+)/.exec(id)
  return m ? Number(m[1]) : 999
}

/**
 * 从一个目录往上找真工作区。
 * 判据要**同时**有 `dsh-persona-framework/` 和 `persona-ai/`——
 * 本体目录里也有一个占位的 `persona-ai/`，只看一样会认错层（第一版就认错了）。
 */
function climbToWorkspace(start) {
  const dirs = []
  let dir = start
  for (let i = 0; i < 8 && dir; i += 1) {
    dirs.push(dir)
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  for (const d of dirs) {
    if (existsSync(join(d, 'dsh-persona-framework')) && existsSync(join(d, 'persona-ai'))) return d
  }
  for (const d of dirs) {
    if (existsSync(join(d, 'persona-ai'))) return d
  }
  return ''
}

function workspaceOf(cfg) {
  const candidates = [cfg.workspace, sessionWs, process.cwd()].filter(
    (x) => typeof x === 'string' && x.trim(),
  )
  for (const dir of candidates) {
    const found = climbToWorkspace(dir)
    if (found) return found
  }
  return candidates[0] ?? ''
}

function bundlesOf(profileDir) {
  const files = [
    join(profileDir, 'package.json'),
    join(homedir(), '.dsh', 'profiles', 'desktop', 'package.json'),
  ]
  for (const file of files) {
    const json = readJson(file)
    const list = json?.dsh?.profile?.bundles
    if (Array.isArray(list)) return new Set(list)
  }
  return new Set()
}

function collect(cfg) {
  const ws = workspaceOf(cfg)
  if (!ws) {
    return { ok: false, error: '还没认到工作区：会话 cwd 没到，也没配 workspace。' }
  }
  const frameworkDir = join(ws, 'dsh-persona-framework')
  const modulesDir = join(ws, 'persona-ai', 'modules')
  const addonsDir = join(frameworkDir, 'addons')
  const bundles = bundlesOf(cfg.profileDir)

  // ── 一、总模块（本体） ────────────────────────────────────────────────────
  const fwPkg = readJson(join(frameworkDir, 'package.json'), {}) ?? {}
  const core = [
    {
      pkg: fwPkg.name ?? 'dsh-persona-framework',
      title: '总模块（本体）',
      version: String(fwPkg.version ?? '?'),
      desc: '注入骨架：人格文件、模块索引、模块正文、配额、元协调。它自己就是一个插件，不挂在别的插件底下。',
      enabled: true,
      detail: existsSync(frameworkDir) ? frameworkDir : '没找到目录',
    },
  ]

  // ── 二、程序功能实现（impl/ 下框架自己的程序） ─────────────────────────────
  let impl = []
  const implDir = join(frameworkDir, "impl")
  if (isDir(implDir)) {
    impl = readdirSync(implDir)
      .filter((f) => f.endsWith(".mjs"))
      .map((f) => ({ id: f, file: "impl/" + f, title: f, group: "模块功能实现" }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }
  impl.unshift({
    id: "index.js",
    file: "index.js",
    title: "index.js",
    group: "模块功能实现",
    desc: "总模块本体：注入、调度、工具注册。它自己不算「功能实现」，只是把实现接起来。",
  })

  // ── 二之一、程序模块（programs/<id>：自带正文与自己的实现） ─────────────
  let programs = []
  const programsDir = join(frameworkDir, "programs")
  if (isDir(programsDir)) {
    programs = readdirSync(programsDir)
      .filter((d) => isDir(join(programsDir, d)))
      .map((d) => {
        const root = join(programsDir, d)
        const meta = readJson(join(root, "program.json"), {}) ?? {}
        const implFile = String(meta.impl ?? "impl.mjs")
        return {
          id: String(meta.id ?? d),
          order: Number(meta.order ?? 900),
          pkg: "programs/" + d,
          title: String(meta.title ?? d),
          file: "programs/" + d + "/" + implFile,
          desc: String(meta.note ?? ""),
          enabled: true,
          detail: "程序模块：正文 programs/" + d + "/module.md，实现 programs/" + d + "/" + implFile,
          group: "模块",
        }
      })
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  }

  // ── 二之二、模块正文（persona-ai/modules/*.md） ────────────────────────── ──────────────────────────────────────────
  let modules = []
  if (isDir(modulesDir)) {
    modules = readdirSync(modulesDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => {
        const id = f.replace(/\.md$/, '')
        const order = moduleOrder(id)
        return {
          id,
          order,
          file: `persona-ai/modules/${f}`,
          title: headingOf(join(modulesDir, f), id),
          group: order === 0 ? '常驻（每轮）' : order < 10 ? '人格与骨架' : order < 40 ? '骨架与理论' : '其余模块',
        }
      })
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  }

  // ── 三、附加插件（addons/ 下的包） ─────────────────────────────────────────
  let addons = []
  if (isDir(addonsDir)) {
    addons = readdirSync(addonsDir)
      .filter((d) => isDir(join(addonsDir, d)))
      .map((dir) => {
        const root = join(addonsDir, dir)
        const pkg = readJson(join(root, 'package.json'), {}) ?? {}
        const zh = readJson(join(root, 'locale', 'zh.json'), {}) ?? {}
        const pkgName = String(pkg.name ?? dir)
        const meta = zh.meta ?? {}
        return {
          dir,
          pkg: pkgName,
          version: String(pkg.version ?? '?'),
          title: String(meta.title ?? pkgName),
          desc: String(meta.description ?? pkg.description ?? ''),
          enabled: bundles.has(pkgName),
          hasClient: Boolean(pkg?.dsh?.client),
          hasPatch: Boolean(pkg?.dsh?.bundle?.patch),
        }
      })
      .sort((a, b) => a.title.localeCompare(b.title, 'zh'))
  }

  return {
    ok: true,
    workspace: ws,
    frameworkDir,
    modulesDir,
    programsDir,
    addonsDir,
    counts: {
      modules: modules.length,
      programs: programs.length,
      programModules: programs.length + 1,
      impl: impl.length,
      addons: addons.length,
      addonsOn: addons.filter((x) => x.enabled).length,
    },
    groups: [
      {
        id: "core",
        title: "总模块插件",
        hint: "第一部分：本体（注入与调度）＋ 模块正文（每轮按配额挑几篇进上下文）＋ 三个模块——程序模块、自读写模块、适配模块；前一个是框架自己的程序，后两个各带一份正文。",
        items: [
          ...core,
          {
            id: "module:program",
            title: "程序模块",
            group: "模块",
            file: "impl/",
            desc: "框架自己的程序：注入骨架、模块调度、配额、工具——全部收在 impl/ 里，由它自带的那一份实现跑。",
            detail: "程序功能实现：impl/*.mjs",
          },
          ...programs.map((p) => ({
            id: "program:" + p.id,
            title: p.title,
            group: "模块",
            file: p.file,
            desc: p.desc,
            detail: "正文 programs/" + p.id + "/module.md",
          })),
          ...modules,
        ],
      },
      {
        id: "impl",
        title: "模块功能实现",
        hint: "第二部分：模块功能实现——人格框架自身的实现。框架的全部程序都在这里：impl/ 里的框架程序，加上每个程序模块自己的 impl.mjs。改了这一层要重启 DSH 才生效。",
        items: [
          ...impl,
          ...programs.map((p) => ({
            id: "programimpl:" + p.id,
            title: p.title + " · 程序功能实现",
            group: "模块功能实现",
            file: p.file,
            desc: "程序模块「" + p.title + "」自己的程序功能实现。",
          })),
        ],
      },
      {
        id: "addons",
        title: "附加插件",
        hint: "第三部分：挂在框架上的那些（记忆、日记、器官、电量……）。「已装」= 登记在 bundles 里。",
        items: addons,
      },
    ],
  }
}

export function apply(ctx, rawConfig) {
  const cfg = {
    workspace: '',
    profileDir: '',
    ...(rawConfig && typeof rawConfig === 'object' ? rawConfig : {}),
  }

  // 会话工作区：只记，不改任何状态；瀑布钩子必须把控制权交回去。
  try {
    ctx.on('agent/pre-step', (payload, next) => {
      noteSessionWs(payload)
      return next()
    })
  } catch { /* 没有这个钩子也不影响面板 */ }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: API,
    handler(req, res) {
      try {
        const body = collect(cfg)
        res.writeHead(body.ok ? 200 : 500, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(JSON.stringify(body))
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }))
      }
    },
  }))

  return () => { /* webServer 的 disposer 由 ctx.effect 管 */ }
}
