/**
 * 附加插件：随框架一起装的那几个。
 *
 * 这一层的判断：**装不装是使用者的选择，不是框架替他做的主。**
 * 所以它只做两件事——**查状态**、**按选择装**；从不自作主张给谁装东西。
 *
 * 「装了没」的判据只有一条：当前 profile 的 `package.json` 的 `dependencies` 里有没有那个名字。
 * 不看目录在不在——目录可能是别人塞的，也可能是残留。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'

/**
 * 附件的「描述表」：只提供人写的部分——label 和 what。
 *
 * ★ 这份表**不是名单**。名单以扫目录为准（见 `discoverOptional`）。
 *   抄自 `cyanwell/dsh-agent-soul` 的一条实测教训：它原来把知识文件清单硬编码，
 *   加 `12-ledger.md` 时忘了登记——**而注释就写在文件头上「漏了会漏检」**。
 *   它自己踩了自己记的那个坑。后来改成「扫目录为准，硬编码只作兜底」，这类错误才结构上不可能再发生。
 *
 *   我们这里犯的是同一个错：硬编码五个附件，加第六个忘了登记，设置页就静默地看不见它。
 *   现在：**目录里扫到什么算什么**；这份表只补 label／what，表里没有的照样列出来（标「未登记」）。
 */
export const OPTIONAL_META = {
  'dsh-persona-grow': { key: 'grow', dir: 'persona-grow-plugin', label: '人格自学', what: '每轮注入人格，从纠正里长出新条目，带版本可回滚' },
  'dsh-persona-diary': { key: 'diary', dir: 'persona-diary-plugin', label: '日记', what: '记心得，侧栏按天摆着' },
  'dsh-persona-results': { key: 'results', dir: 'persona-results-plugin', label: '成果', what: '把认下的思考成果收进侧栏' },
  'dsh-persona-explore': { key: 'explore', dir: 'persona-explore-plugin', label: '碗外探索', what: '自己上网搜、读原文、把值得留的写进 knowledge/web' },
  'dsh-persona-memory': { key: 'memory', dir: 'dsh-persona-memory', label: '记忆分层', what: '流水不是记忆：按预算取、超期归档、流水压成一行（带指针）' },
}

/**
 * 扫工作区，找出所有「像附件」的本地包。
 *
 * 判据：目录下有 `package.json`，且 `name` 以 `dsh-persona-` 开头、不是主件本身。
 * 不按名字猜目录——`dsh-persona-memory` 的目录就叫 `dsh-persona-memory`，
 * `dsh-persona-grow` 的目录叫 `persona-grow-plugin`，两种都收。
 *
 * @param {string} workspace
 * @param {string} [mainName] 主件包名，排掉自己
 */
export function discoverOptional(workspace, mainName = 'dsh-persona-framework') {
  const found = []
  if (!workspace || !existsSync(workspace)) return found
  let names = []
  try { names = readdirSync(workspace) } catch { return found }
  for (const n of names) {
    const dir = join(workspace, n)
    const pkgFile = join(dir, 'package.json')
    if (!existsSync(pkgFile)) continue
    let pkg = null
    try { pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) } catch { continue }
    const name = String(pkg.name || '')
    if (!name.startsWith('dsh-persona-') || name === mainName) continue
    const meta = OPTIONAL_META[name] || {}
    found.push({
      key: meta.key || name.replace(/^dsh-persona-/, ''),
      name,
      dir: n,
      label: meta.label || name.replace(/^dsh-persona-/, ''),
      what: meta.what || (pkg.description || '').slice(0, 60),
      registered: Boolean(OPTIONAL_META[name]),
      version: String(pkg.version || ''),
    })
  }
  return found.sort((a, b) => a.key.localeCompare(b.key))
}

/** 兼容旧名字：原来叫 OPTIONAL_PLUGINS 的地方还按五个硬编码用。 */
export const OPTIONAL_PLUGINS = Object.entries(OPTIONAL_META).map(([name, m]) => ({ ...m, name }))

/** DSH 的根（`~/.dsh`）。 */
export function dshRoot() {
  try {
    const env = process.env.DSH_HOME || process.env.DSH_ROOT
    if (env && existsSync(env)) return env
  } catch { /* 落空 */ }
  return join(homedir(), '.dsh')
}

/**
 * 找出所有 profile：
 * 环境变量指了就用它；否则扫 `~/.dsh/profiles/*`，只收有 package.json 的。
 */
export function findProfiles() {
  const out = []
  const envName = process.env.DSH_PROFILE
  const base = join(dshRoot(), 'profiles')
  if (!existsSync(base)) return out
  let names = []
  try { names = readdirSync(base) } catch { return out }
  for (const n of names) {
    const f = join(base, n, 'package.json')
    if (!existsSync(f)) continue
    try {
      const d = JSON.parse(readFileSync(f, 'utf8'))
      const deps = d.dependencies || {}
      const bundles = d.dsh?.profile?.bundles || d.dsh?.bundles || []
      out.push({
        profile: n,
        active: envName ? n === envName : undefined,
        deps,
        bundles: Array.isArray(bundles) ? bundles : [],
        file: f,
      })
    } catch { /* 坏的 profile 跳过 */ }
  }
  return out
}

/**
 * 查状态：每个附件在当前（或全部）profile 里装了没。
 *
 * ★ 名单以**扫目录**为准，不以 OPTIONAL_META 为准。
 *   硬编码清单的毛病是「加了新的忘了登记就静默漏掉」——
 *   soul 的作者自己也踩过这个坑，注释写着「漏了会漏检」，下一个文件就是忘了加。
 *   现在：目录里扫到的都列；`registered: false` 的标「未登记」，而不是不显示。
 *
 * @param {{profile?: string, workspace?: string}} opts
 */
export function checkOptional(opts = {}) {
  const profiles = findProfiles()
  const want = opts.profile
  const list = want ? profiles.filter((p) => p.profile === want) : profiles

  // 扫目录拿到「本地有哪些」；没给 workspace 就退回硬编码表（老行为，别炸）
  const discovered = opts.workspace ? discoverOptional(opts.workspace) : []
  const pool = discovered.length
    ? discovered
    : OPTIONAL_PLUGINS.map((p) => ({ ...p, registered: true, version: '' }))

  const rows = pool.map((p) => {
    const installedIn = list.filter((x) => Object.prototype.hasOwnProperty.call(x.deps, p.name)).map((x) => x.profile)
    const localDir = opts.workspace ? join(opts.workspace, p.dir) : ''
    return {
      ...p,
      installed: installedIn.length > 0,
      installedIn,
      localExists: localDir ? existsSync(localDir) : false,
    }
  })
  return {
    profiles: list.map((p) => ({ profile: p.profile, active: p.active, bundles: p.bundles })),
    rows,
    /** 有没有「目录里有、描述表里没登记」的——该补描述 */
    unregistered: rows.filter((x) => x.registered === false).map((x) => x.name),
    /** 当前有没有认出一个 profile */
    hasProfile: list.length > 0,
  }
}

/**
 * 造安装命令（不执行）。真正执行留给调用方——**这里不跑子进程**。
 *
 * 为什么不跑：装插件会改 profile 的 package.json，跑错了要收拾；
 * 而使用者点一下「复制」自己粘，出错时他知道自己粘了什么。
 */
export function installCommands(keys, opts = {}) {
  const want = new Set(keys || [])
  const lines = []
  for (const p of OPTIONAL_PLUGINS) {
    if (want.size && !want.has(p.key)) continue
    const target = opts.workspace ? join(opts.workspace, p.dir) : p.dir
    const profile = opts.profile ? ` --profile ${opts.profile}` : ''
    lines.push(`dsh plugin${profile} add "file:${target.replace(/\\/g, '/')}"`)
  }
  return lines
}

export function renderOptional(r) {
  const lines = []
  if (!r.hasProfile) {
    lines.push('没找到 profile——不知道装到哪。先确认 `~/.dsh/profiles/` 下有一个。', '')
  } else {
    lines.push(`profile：${r.profiles.map((p) => p.profile + (p.active ? '（当前）' : '')).join('、')}`, '')
  }
  lines.push('| 附件 | 包名 | 状态 | 本地目录 |', '| --- | --- | --- | --- |')
  for (const row of r.rows) {
    const st = row.installed ? `已装（${row.installedIn.join('、')}）` : '未装'
    lines.push(`| ${row.label} | \`${row.name}\` | ${st} | ${row.localExists ? '在' : '不在'} |`)
  }
  if (r.unregistered && r.unregistered.length) {
    lines.push('', `⚠ 有 ${r.unregistered.length} 个目录里的包没登记描述：${r.unregistered.join('、')}`, '  它们照样列出来了——只是 label／what 用的是 package.json 的兜底。补进 OPTIONAL_META 就行。')
  }
  const missing = r.rows.filter((x) => !x.installed)
  if (missing.length) {
    lines.push('', `没装的有 ${missing.length} 个。设置页勾上后，框架会给出要粘的命令——它不自己动手。`)
  }
  return lines.join('\n')
}

/**
 * 真的装一个附件。**只认 OPTIONAL_PLUGINS 里的名字**，别的一律拒。
 *
 * 为什么这次敢跑子进程：设置页那个按钮是使用者点的，点了就是要装；
 * 不跑就成了「给你一条命令自己粘」——那是把活推回去。
 * 但三条护栏不能少：
 *   1. 名字必须在白名单里（不许传任意包名）
 *   2. 只装本地 file: 路径（不许从网上拉任意包）
 *   3. 超时 + 把 stdout/stderr 原样带回去（成功失败都看得见）
 *
 * @param {string} key  OPTIONAL_PLUGINS 里的 key
 * @param {{profile?: string, workspace?: string, timeoutMs?: number}} opts
 */
export function installOne(key, opts = {}) {
  const spec = OPTIONAL_PLUGINS.find((p) => p.key === key)
  if (!spec) return { ok: false, key, error: `不认识的附件：${key}` }
  if (!opts.workspace) return { ok: false, key, error: '不知道装到哪：没拿到工作区' }
  const target = join(opts.workspace, spec.dir)
  if (!existsSync(target)) return { ok: false, key, error: `本地目录不在：${spec.dir}` }

  const args = ['plugin']
  if (opts.profile) args.push('--profile', opts.profile)
  // 反斜杠换成正斜杠：pnpm 在 Windows 上也认 /，但认不了未转义的 \
  const posix = target.split(String.fromCharCode(92)).join('/')
  args.push('add', `file:${posix}`)

  // Windows 上 dsh 是 .cmd，得走 shell；其它平台直接调
  const isWin = process.platform === 'win32'
  const r = spawnSync('dsh', args, {
    encoding: 'utf8',
    timeout: Number(opts.timeoutMs ?? 120000),
    shell: isWin,
    windowsHide: true,
  })
  const out = String(r.stdout || '').trim()
  const err = String(r.stderr || '').trim()
  const failed = r.status !== 0
  return {
    ok: !failed,
    key,
    name: spec.name,
    code: r.status,
    // ★ 两个都带回去：装失败时人要看的是最后几行，不是「出错了」三个字
    stdout: out.slice(-1500),
    stderr: err.slice(-1500),
    error: failed
      ? (err.split('\n').map((x) => x.trim()).filter(Boolean).slice(-3).join(' / ') || `退出码 ${r.status}`)
      : '',
  }
}

export function installMany(keys, opts = {}) {
  const results = []
  for (const k of keys || []) results.push(installOne(k, opts))
  return {
    ok: results.every((x) => x.ok),
    results,
    installed: results.filter((x) => x.ok).map((x) => x.name),
    failed: results.filter((x) => !x.ok).map((x) => x.name),
  }
}
