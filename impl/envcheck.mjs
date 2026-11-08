/**
 * 环境体检：抄 `dsh-win32` 的「查得出还修得了」。
 *
 * framework 的 selfcheck 只验自己（文件在不在、版本对不对），
 * 这一层验的是**站的地方**：系统、内存、磁盘、node、git。
 * 判据固定：每条都给「值、够不够、不够怎么办」，不说「可能有问题」。
 */
import { statfsSync } from 'node:fs'
import { cpus, totalmem, freemem, release, arch, platform, version as osVersion } from 'node:os'
import { execFileSync } from 'node:child_process'

const GB = 1024 ** 3

function has(cmd, args) {
  try { execFileSync(cmd, args, { stdio: 'ignore', timeout: 4000 }); return true } catch { return false }
}

function gitVersion() {
  try {
    const out = execFileSync('git', ['--version'], { encoding: 'utf8', timeout: 4000 })
    return out.trim()
  } catch { return '' }
}

export function envCheck({ workspace = process.cwd() } = {}) {
  const rows = []
  const push = (what, value, ok, fix) => rows.push({ what, value, ok, fix })

  // 系统
  const osName = platform() === 'win32' ? `Windows ${release?.() ?? ''}`.trim() : `${platform()} ${release?.() ?? ''}`
  push('系统', `${osName} · ${arch()} · ${cpus().length} 核`, true, '')

  // 内存（低于 4 GB 时 DSH + 插件容易互相挤）
  const totalGb = totalmem() / GB
  const freeGb = freemem() / GB
  push('内存', `${totalGb.toFixed(1)} GB（空 ${freeGb.toFixed(1)} GB）`, totalGb >= 4, '关掉不用的 Electron / 浏览器标签；低于 4 GB 时别同时开模型下载。')

  // 磁盘（工作区所在盘，留 5 GB 是底线）
  try {
    const st = statfsSync(workspace)
    const free = st.bavail * st.bsize
    push('磁盘', `工作区所在盘剩 ${(free / GB).toFixed(1)} GB`, free >= 5 * GB, '先清 %TEMP% 与包缓存；别删记忆池与人格文件。')
  } catch (e) {
    push('磁盘', `读不到（${e?.message || e}）`, false, '换一个存在的路径再跑一次。')
  }

  // node（插件用 fs.statfsSync / structuredClone 等，20 以下会缺）
  const major = Number(process.versions.node.split('.')[0])
  push('node', process.versions.node, major >= 20, '升级到 node 20+；低于 20 时 statfsSync 与部分 ESM 行为会缺。')

  // git（提交、备份都靠它）
  const gv = gitVersion()
  push('git', gv || '没找到', Boolean(gv), '装 git 并放进 PATH；没有它就只能手动留备份，回退会很难。')

  const bad = rows.filter((r) => !r.ok)
  return { rows, bad }
}

export function renderEnvCheck(res) {
  const lines = ['', `**环境体检**：${res.rows.length} 项，${res.bad.length} 项不够。`]
  for (const r of res.rows) {
    lines.push(`- ${r.ok ? '·' : '✗'} ${r.what}：${r.value}${r.ok ? '' : ` —— ${r.fix}`}`)
  }
  if (!res.bad.length) lines.push('', '这一层没查出问题；它只说明「站得下」，不说明插件都对——那看上面四条。')
  return lines.join('\n')
}
