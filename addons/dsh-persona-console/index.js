/**
 * dsh-persona-console —— 人格框架台（host 半端）
 * ============================================================================
 * 侧栏那个「人格框架」页的数据口：把这一套拆成三组摆出来，和 DSH 原来的插件页分开。
 *
 *   1. 总模块插件   —— 本体 + 模块正文（`persona-ai/modules/*.md`）+ 三个并列模块：
 *                     程序模块（`impl/`）、自读写模块、适配模块
 *   2. 模块功能实现 —— 人格框架自身的实现那一层：不给人格字，只真去做、落盘
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
export const version = '0.4.0'
export const inject = ['webServer', 'pluginManager']

const API = '/api/persona-console'
const TOGGLE = '/api/persona-console/toggle'

/**
 * 附加插件分四组。判据是**包名**，不是标题——
 * 标题会改，包名不会；没进任何一组的，落进「其他附加插件」。
 */
const PERSONA_EIGHT = new Set([
  'dsh-persona-grow', 'dsh-persona-gradient', 'dsh-persona-betray', 'dsh-persona-appear',
  'dsh-persona-identity', 'dsh-persona-context', 'dsh-persona-bridge', 'dsh-persona-memory',
])
// 器官只认「身子上的那四件」：手、嘴、耳、眼——中文名带「器官·」前缀的也只有它们。
// 其余（情感、电量、自由时间、练习、感悟、教训、成果、日记、清扫、卡片、卡片守、
// 插件、虚拟、future*）不挂在身上，落进「其他附加插件」。
const ORGANS = new Set([
  'dsh-persona-hand', 'dsh-persona-mouth', 'dsh-persona-hearing', 'dsh-persona-vision',
])
const INTERFACES = new Set(['dsh-pet-sisi'])

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

/**
 * 从 Loader 的实时条目表取启停真相：`include:<id>` 才是可寻址的入口 id，
 * 只有这些能真启停；没在表里的（包名对不上）退回 bundles 判断，标成「不可寻址」。
 */
async function liveEntries(ctx) {
  const map = new Map()
  try {
    const list = await ctx.pluginManager.listPlugins()
    for (const e of Array.isArray(list) ? list : []) {
      const mod = String(e.moduleName ?? '')
      map.set(mod, {
        entryId: String(e.entryId ?? ''),
        moduleName: mod,
        enabled: Boolean(e.enabled),
        phase: e.fiberPhase ?? null,
        readOnly: Boolean(e.readOnlyReason),
        reason: e.readOnlyReason ?? '',
      })
    }
  } catch { /* 取不到实时表就退回 bundles，不装作拿到了 */ }
  return map
}

async function collect(cfg, ctx) {
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

  // 实时启停真相：以 Loader 条目为准，bundles 只当退路。
  const live = await liveEntries(ctx)
  for (const a of addons) {
    const hit = live.get(a.pkg)
    a.entryId = hit?.entryId || ''
    a.on = hit ? hit.enabled : a.enabled
    a.enabled = a.on
    a.readOnly = a.pkg === 'dsh-persona-console' || Boolean(hit?.readOnly)
      || !(a.pkg.startsWith('dsh-persona-') || a.pkg.startsWith('dsh-pet-'))
    a.installed = Boolean(hit)
    a.phase = hit?.phase || null
  }

  // 分四组：八大人格插件／器官／对外接口／其余。
  const byGroup = (set) => addons.filter((a) => set.has(a.pkg))
  const restAddons = addons.filter((a) => !PERSONA_EIGHT.has(a.pkg) && !ORGANS.has(a.pkg) && !INTERFACES.has(a.pkg))
  // 模块类插件里真改状态的实现件（不是把正文再注一遍的那种）：第二部分写「功能已实现」，要写出包名。
  const IMPL_PKGS = new Set(["dsh-persona-plugin"])
  const moduleImpls = addons.filter((x) => IMPL_PKGS.has(x.pkg))

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
      implAddons: moduleImpls.length,
      addons: addons.length,
      addonsOn: addons.filter((x) => x.enabled).length,
      persona: byGroup(PERSONA_EIGHT).length,
      personaOn: byGroup(PERSONA_EIGHT).filter((x) => x.enabled).length,
      organs: byGroup(ORGANS).length,
      organsOn: byGroup(ORGANS).filter((x) => x.enabled).length,
      interfaces: byGroup(INTERFACES).length,
      interfacesOn: byGroup(INTERFACES).filter((x) => x.enabled).length,
      rest: restAddons.length,
      restOn: restAddons.filter((x) => x.enabled).length,
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
        hint: "第二部分：模块功能实现——一个模块一条，只写「这条已经实现了」，不列插件包。这一栏没有可启停的东西；真去启停插件，看第三部分。真改状态的模块类实现件会写出插件包名。改了这一层要重启 DSH 才生效。",
        items: [
          {
            id: "impl:program",
            title: "程序模块 · 功能实现",
            group: "功能实现",
            file: "impl/",
            desc: "程序模块的功能实现：框架的全部程序都收在这一个目录里（" + impl.length + " 支），按模块整体摆，不单列到文件。",
            detail: "impl/*.mjs",
          },
          ...programs.map((p) => ({
            id: "impl:" + p.id,
            title: p.title + " · 功能实现",
            group: "功能实现",
            file: p.file,
            desc: "模块「" + p.title + "」自己的功能实现：真去做、落盘，不给人格字。",
          })),
          ...moduleImpls.map((x) => ({
            id: "impl:pkg:" + x.pkg,
            title: x.title + " · 功能已实现",
            group: "功能实现",
            file: x.dir,
            desc: x.desc,
            detail: "插件包 " + x.pkg,
            enabled: x.enabled,
          })),
          {
            id: "impl:explore",
            title: "探索 · 功能实现",
            group: "功能实现",
            file: "knowledge/web/",
            desc: "功能已完成：搜、读原文、留判断、排方向四件事都能做，落在 knowledge/web/ 与 explore/ 的队列、触发账里。",
            detail: "功能已完成（没有独立插件包）",
          },
          {
            id: "impl:results",
            title: "成果 · 功能实现",
            group: "功能实现",
            file: "growth/成果/",
            desc: "功能已完成：一条一句标题、正文写骨架／判断／还欠什么，落成长条账。",
            detail: "功能已完成（没有独立插件包）",
          },
          {
            id: "impl:diary",
            title: "日记 · 功能实现",
            group: "功能实现",
            file: "growth/日记/",
            desc: "功能已完成：公开／私密／记录三本分开写，带日期与出处。",
            detail: "功能已完成（没有独立插件包）",
          },
          {
            id: "impl:sweep",
            title: "通用清扫 · 功能实现",
            group: "功能实现",
            file: "addons/dsh-persona-sweep/",
            desc: "功能已完成：账本超过阈值就归档留尾，落清扫账。",
            detail: "功能已完成（没有独立插件包）",
          },
        ],
      },
      {
        id: "persona",
        title: "八大人格插件",
        hint: "人格本体那一层：成长、梯度、背叛、出现、同一、上下文、桥、记忆。勾了立刻启停，不用重启；面板自己除外——关掉它，这块面板就没了。",
        items: byGroup(PERSONA_EIGHT),
      },
      {
        id: "organs",
        title: "所有器官",
        hint: "身子上的那四件：手、嘴、耳、眼。只有中文名带「器官·」前缀的才归这里，别的都不算。",
        items: byGroup(ORGANS),
      },
      {
        id: "interfaces",
        title: "所有对外接口",
        hint: "跨设备的那个：桌宠桥。人格桥管的是会话之间，归八大人格插件。它们只负责把里外接起来，不替谁判断。",
        items: byGroup(INTERFACES),
      },
      {
        id: "addons",
        title: "其他附加插件",
        hint: "剩下的都在这儿。勾了立刻启停；标「不可寻址」的是 Loader 里没有独立条目的包，只能改 profile 的 bundles 再重启。",
        items: restAddons,
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
    async handler(req, res) {
      try {
        const body = await collect(cfg, ctx)
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

  // 启停：只认 Loader 真有的条目 id，只认 own 的包名，别的都拒——
  // 面板不该能替人关掉不该关的东西。
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: TOGGLE,
    async handler(req, res) {
      const reply = (code, obj) => {
        res.writeHead(code, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(JSON.stringify(obj))
      }
      try {
        const chunks = []
        for await (const c of req) chunks.push(c)
        const raw = Buffer.concat(chunks).toString('utf8')
        const input = raw ? JSON.parse(raw) : {}
        const entryId = String(input.entryId ?? '')
        const pkgName = String(input.pkg ?? '')
        const dirName = String(input.dir ?? '')
        const enabled = Boolean(input.enabled)

        const ws = workspaceOf(cfg)
        const addonsDir = join(ws, 'dsh-persona-framework', 'addons')
        const pkgDir = dirName ? join(addonsDir, dirName) : ''
        const pkgJson = pkgDir ? readJson(join(pkgDir, 'package.json'), {}) ?? {} : {}
        const realPkg = String(pkgJson.name ?? pkgName)

        const live = await liveEntries(ctx)
        const hit = entryId
          ? [...live.values()].find((x) => x.entryId === entryId)
          : [...live.values()].find((x) => x.moduleName === realPkg)

        // 只许动人格框架这一套的包；别的包一律拒。
        const own = realPkg.startsWith('dsh-persona-') || realPkg.startsWith('dsh-pet-')
        if (!own || !pkgDir || !existsSync(pkgDir)) {
          return reply(403, { ok: false, error: '只允许启停人格框架这一套：' + (realPkg || '(空)') })
        }
        if (hit?.readOnly) {
          return reply(403, { ok: false, error: '这条是管理必需的，Loader 不让改：' + hit.entryId })
        }

        // 一、已有 Loader 条目：直接启停。
        if (hit) {
          const result = await ctx.pluginManager.setPluginEnabled(hit.entryId, enabled)
          return reply(200, {
            ok: true, mode: 'entry', entryId: hit.entryId, pkg: realPkg, enabled,
            application: result?.application ?? 'unknown',
          })
        }

        // 二、还没装载：先试「这条 bundle 只是被关着」，再试登记本地目录。
        const notes = []
        if (ctx.pluginManager.setBundleEnabled) {
          try {
            const r = await ctx.pluginManager.setBundleEnabled(realPkg, enabled)
            notes.push({ step: 'setBundleEnabled', application: r?.application ?? 'unknown' })
            const after = await liveEntries(ctx)
            const fresh = [...after.values()].find((x) => x.moduleName === realPkg)
            if (fresh) {
              const applied = await ctx.pluginManager.setPluginEnabled(fresh.entryId, enabled)
              return reply(200, {
                ok: true, mode: 'bundle', entryId: fresh.entryId, pkg: realPkg, enabled,
                application: applied?.application ?? 'unknown', notes,
              })
            }
          } catch (error) {
            notes.push({ step: 'setBundleEnabled', error: String(error?.message ?? error) })
          }
        }

        for (const spec of [pkgDir, 'link:' + pkgDir]) {
          try {
            const r = await ctx.pluginManager.installBundle(spec)
            notes.push({ step: 'installBundle', spec, application: r?.application ?? 'unknown', message: r?.message })
            if (r?.application === 'applied') break
          } catch (error) {
            notes.push({ step: 'installBundle', spec, error: String(error?.message ?? error) })
          }
        }

        const again = await liveEntries(ctx)
        const fresh = [...again.values()].find((x) => x.moduleName === realPkg)
        if (!fresh) {
          return reply(500, {
            ok: false,
            error: '这条还没装进 Loader，登记也没成：' + realPkg + '；' + (notes.map((n) => JSON.stringify(n)).join(' / ')),
            notes,
          })
        }
        const result = await ctx.pluginManager.setPluginEnabled(fresh.entryId, enabled)
        return reply(200, {
          ok: true, mode: 'install', entryId: fresh.entryId, pkg: realPkg, enabled,
          application: result?.application ?? 'unknown', notes,
        })
      } catch (error) {
        return reply(500, { ok: false, error: String(error?.message ?? error) })
      }
    },
  }))

  return () => { /* webServer 的 disposer 由 ctx.effect 管 */ }
}
