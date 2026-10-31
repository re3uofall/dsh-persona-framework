/**
 * 体检：一次查清「这套东西在这台机器上到底能不能跑」。
 *
 * 为什么要有它：换电脑、换工作区、换 profile 之后，出问题的地方从来不是代码，
 * 而是「路断了」——插件登记指向一个不存在的目录、设置文件指着一个搬走了的路径、
 * 工作区目录还没建。这些都不会报错，只会**静默地少读一点**。
 *
 * 判据固定四条，每条都能说清「在哪找证据」：
 *   1. 插件本体在不在（profile 登记的 link 指向的目录是否真的存在）
 *   2. 工作区目录在不在（每一层该在哪，找到了没有）
 *   3. 设置里的路径有没有指空（config 里那几条绝对路径）
 *   4. 版本对不对得上（package.json vs 跑起来的 VERSION）
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

const PLUGINS = [
  { pkg: 'dsh-persona-framework', dir: 'dsh-persona-framework', label: '人格框架' },
  { pkg: 'dsh-persona-memory', dir: 'dsh-persona-memory', label: '记忆分层' },
  { pkg: 'dsh-persona-grow', dir: 'persona-grow-plugin', label: '人格自学' },
  { pkg: 'dsh-persona-diary', dir: 'persona-diary-plugin', label: '日记' },
  { pkg: 'dsh-persona-results', dir: 'persona-results-plugin', label: '成果' },
  { pkg: 'dsh-persona-explore', dir: 'persona-explore-plugin', label: '碗外探索' },
]

/** 工作区里该有的目录（缺了不等于坏，只是那层是空的） */
const EXPECT_DIRS = [
  { rel: 'knowledge', what: '判断层' },
  { rel: 'persona-ai/characters', what: '人格文件' },
  { rel: 'persona-ai/modules', what: '模块库' },
  { rel: 'persona-ai/knowledge/session', what: '流水层' },
  { rel: 'persona-ai/knowledge/world', what: '理论层' },
]

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

/** 列出所有 profile，返回 [{ profile, deps }] */
function profiles(root) {
  const base = join(root, 'profiles')
  if (!existsSync(base)) return []
  const out = []
  for (const name of readdirSync(base)) {
    const pkg = readJson(join(base, name, 'package.json'))
    if (pkg) out.push({ profile: name, deps: pkg.dependencies || {} })
  }
  return out
}

/**
 * @param {{workspace?: string, dshRoot?: string, version?: string}} opts
 */
export function doctorCheck(opts = {}) {
  const ws = String(opts.workspace || '').trim() || process.cwd()
  const dsh = String(opts.dshRoot || '').trim() || join(homedir(), '.dsh')
  const running = String(opts.version || '')

  // ── 1. 插件本体：登记的 link 指到哪，那个目录在不在 ──
  const profs = profiles(dsh)
  const pluginRows = PLUGINS.map((p) => {
    const localDir = join(ws, p.dir)
    const registered = []
    for (const pr of profs) {
      const spec = pr.deps[p.pkg]
      if (!spec) continue
      // link:C:/xxx 或 file:C:/xxx —— 去掉前缀看目录在不在
      const raw = String(spec).replace(/^(link|file):/, '')
      registered.push({ profile: pr.profile, spec: String(spec), path: raw, exists: existsSync(raw) })
    }
    // ★ 插件目录不一定在工作区里——它多半是 link 到别处的。
    //   所以「在哪读版本」要按登记走：先看登记指向的真目录，再退回工作区同名目录。
    const fromLink = registered.map((r) => r.path).find((x) => x && existsSync(join(x, 'package.json')))
    const pkgDir = fromLink || (existsSync(join(localDir, 'package.json')) ? localDir : '')
    const localPkg = pkgDir ? readJson(join(pkgDir, 'package.json')) : null
    return {
      ...p,
      localExists: Boolean(pkgDir),
      pkgDir,
      version: localPkg?.version || '',
      registered,
      // 断链：登记了，但指过去的目录不存在
      broken: registered.filter((r) => !r.exists),
      notInstalled: registered.length === 0,
    }
  })

  // ── 2. 工作区目录 ──
  const dirRows = EXPECT_DIRS.map((d) => ({ ...d, exists: existsSync(join(ws, d.rel)) }))

  // ── 3. 设置里那几条绝对路径 ──
  const cfgFile = join(ws, '.persona-framework', 'config.json')
  const cfg = readJson(cfgFile) || {}
  const pathKeys = ['frameworkFile', 'modulesFile', 'personalityFile']
  const pathRows = pathKeys.map((k) => {
    const v = String(cfg[k] || '')
    if (!v) return { key: k, value: '', exists: null, note: '没设（会用默认位置）' }
    const ok = existsSync(v)
    // 指空但同名文件在工作区里还在 → 能按名字找回来
    const base = v.split(/[\\/]/).pop()
    const guess = [join(ws, '.persona-framework', base), join(ws, 'persona-ai', 'modules', base), join(ws, 'persona-ai', 'characters', base)]
      .find((x) => existsSync(x))
    return { key: k, value: v, exists: ok, recoverTo: ok ? '' : (guess || ''), note: ok ? '指得到' : (guess ? '指空了，但工作区里找得到同名文件' : '指空了，工作区里也没有') }
  })

  // ── 4. 版本 ──
  const mainPkg = readJson(join(ws, 'dsh-persona-framework', 'package.json'))
  const versionOk = !running || !mainPkg?.version ? null : running === mainPkg.version

  // ── 判：哪几条真会拦人 ──
  const blockers = []
  for (const p of pluginRows) {
    if (p.broken.length) blockers.push(`${p.label}：${p.broken.map((b) => b.profile).join('、')} 里的登记指空了——这条插件加载不了，要重装`)
  }
  for (const r of pathRows) {
    if (r.exists === false) blockers.push(`设置里的 ${r.key} 指空了${r.recoverTo ? '（工作区里有同名文件，能改回来）' : ''}`)
  }
  if (versionOk === false) blockers.push(`版本对不上：跑的是 ${running}，包是 ${mainPkg.version}——改完没重启`)

  const soft = []
  for (const d of dirRows) if (!d.exists) soft.push(`${d.what}（${d.rel}）还没有`)
  for (const p of pluginRows) if (p.notInstalled) soft.push(`${p.label} 没登记进任何 profile——要用得先装`)

  return {
    workspace: ws,
    dshRoot: dsh,
    profiles: profs.map((p) => p.profile),
    plugins: pluginRows,
    dirs: dirRows,
    paths: pathRows,
    versions: { running, package: mainPkg?.version || '' },
    blockers,
    soft,
    ok: blockers.length === 0,
  }
}

export function renderDoctor(r) {
  const lines = [
    `体检：${r.ok ? '这套能跑' : `有 ${r.blockers.length} 处会拦人`}`,
    `  工作区 ${r.workspace}`,
    `  profile ${r.profiles.join('、') || '（一个都没找到）'}`,
    '',
    '插件本体：',
  ]
  for (const p of r.plugins) {
    const mark = p.broken.length ? '✗' : p.notInstalled ? '·' : p.localExists ? '✓' : '?'
    const where = p.registered.length
      ? p.registered.map((x) => `${x.profile}${x.exists ? '' : '（指空）'}`).join('、')
      : '没登记'
    lines.push(`  ${mark} ${p.label}  v${p.version || '?'}  ${where}`)
  }
  lines.push('', '工作区目录：')
  for (const d of r.dirs) lines.push(`  ${d.exists ? '✓' : '·'} ${d.what}（${d.rel}）${d.exists ? '' : ' 还没有'}`)

  const bad = r.paths.filter((x) => x.exists === false)
  if (bad.length) {
    lines.push('', '设置里的路径：')
    for (const x of bad) lines.push(`  ✗ ${x.key} → ${x.note}${x.recoverTo ? `\n      能改成：${x.recoverTo}` : ''}`)
  }

  lines.push('', `版本：跑的是 ${r.versions.running || '?'}，包是 ${r.versions.package || '?'}`)

  if (r.blockers.length) {
    lines.push('', '会拦人的（按这个顺序修）：')
    for (const b of r.blockers) lines.push(`  · ${b}`)
  }
  if (r.soft.length) {
    lines.push('', '不影响跑、但空着的：')
    for (const s of r.soft.slice(0, 6)) lines.push(`  · ${s}`)
    if (r.soft.length > 6) lines.push(`  ……还有 ${r.soft.length - 6} 条`)
  }
  lines.push('', '断链只有一处没法自愈：profile 里写的是绝对路径，换电脑必须重装一次。其余都能按名字找回来。')
  return lines.join('\n')
}
