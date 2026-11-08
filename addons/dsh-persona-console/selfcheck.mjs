// 自检：不启动宿主，只验这个包「装得上、读得回、说得清」。
// 一、包元数据对不对；二、入口语法过不过；三、给宿主看的两份字齐不齐。
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = dirname(fileURLToPath(import.meta.url))
const dir = basename(root)
let pass = 0
let fail = 0

function ok(cond, label, detail = '') {
  if (cond) {
    pass += 1
    console.log(`✓ ${label}`)
  } else {
    fail += 1
    console.log(`✗ ${label}${detail ? '：' + detail : ''}`)
  }
  return cond
}

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

const pkgPath = join(root, 'package.json')
const pkg = readJson(pkgPath)
ok(Boolean(pkg), 'package.json 读得出', pkgPath)
if (pkg) {
  ok(pkg.name === dir, '包名与目录同名', `name=${pkg.name} dir=${dir}`)
  ok(/^\d+\.\d+\.\d+/.test(String(pkg.version || '')), '版本号是三段', String(pkg.version))
  ok(Boolean(pkg.main || (pkg.exports && pkg.exports['.'])), '入口写明了', 'main/exports 都空')
  ok(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch === './cordis.patch.yml', '写了 bundle patch', JSON.stringify(pkg.dsh || null))
}

const entry = join(root, 'index.js')
const hasEntry = ok(existsSync(entry), 'index.js 在')
if (hasEntry) {
  const src = readFileSync(entry, 'utf8')
  const syntax = spawnSync(process.execPath, ['--check', entry], { encoding: 'utf8' })
  ok(syntax.status === 0, 'index.js 语法过', (syntax.stderr || '').split('\n').slice(0, 3).join(' '))
  ok(/export\s+const\s+name\s*=/.test(src), '导出了 name')
  ok(/export\s+const\s+version\s*=/.test(src), '导出了 version')
  ok(/export\s+(async\s+)?function\s+apply\s*\(|export\s+const\s+apply\s*=/.test(src), '导出了 apply')
  ok(/ctx\.(tools|systemPrompt|webServer)\??\.\w+|ctx\.(on|effect)\??\(/.test(src), '至少接上了一样宿主能力（工具/段/钩子）')
}

ok(existsSync(join(root, 'cordis.patch.yml')), 'cordis.patch.yml 在')

// 给界面看的字：中文一份、英文一份，标题和说明都不能空。
for (const lang of ['zh', 'en']) {
  const locPath = join(root, 'locale', `${lang}.json`)
  const loc = readJson(locPath)
  if (ok(Boolean(loc), `locale/${lang}.json 读得出`)) {
    const meta = loc.meta || {}
    ok(String(meta.title || '').trim().length > 0, `locale/${lang}.json 有标题`)
    ok(String(meta.description || '').trim().length > 0, `locale/${lang}.json 有说明`)
  }
}

// 带客户端页面的包，client.js 必须在；导出了 icon 的包，icon.svg 必须在。
if (pkg && pkg.dsh && pkg.dsh.client) {
  const c = pkg.dsh.client
  const rel = typeof c === 'string' ? c : (c && (c.entry || c.path)) || 'client.js'
  ok(existsSync(join(root, String(rel).replace(/^\.\//, ''))), 'client.js 在', JSON.stringify(c))
}
if (pkg && pkg.exports && pkg.exports['./icon']) {
  ok(existsSync(join(root, 'icon.svg')), 'icon.svg 在')
}

console.log(`\n${fail === 0 ? '全部过了' : '有没过的'}：${pass} 项过，${fail} 项没过。`)
process.exit(fail === 0 ? 0 : 1)
