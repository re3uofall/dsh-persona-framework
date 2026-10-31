/**
 * 打「五个附加插件」的分发包。
 *
 *   node release-pack.mjs
 *
 * 为什么有这个脚本：那五个插件的源码在仓库的 `addons/` 里（唯一源），
 * 但用户要拿到的是**能解压到工作区根就认出来**的包——所以打包时要把
 * `addons/` 这一层剥掉。手打容易忘，忘了解压出来就多一层目录，
 * 设置页扫工作区根就看不见它们。这条踩过。
 *
 * 产物：`dist/dsh-persona-addons-YYYYMMDD.zip`
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const PKG = dirname(fileURLToPath(import.meta.url))
const ADDONS = join(PKG, 'addons')
const DIST = join(dirname(PKG), 'dist')

// 不该进包的东西：版本控制、依赖、工作区数据、演示大件、备份
const SKIP = new Set([
  '.git', 'node_modules', '.persona-framework', 'knowledge', 'persona-ai',
  '__pycache__', '.tools', 'dist', '.pkg', '.DS_Store', 'Thumbs.db', 'TALK.md',
])
const skip = (n) => SKIP.has(n)
  || (n.startsWith('TALK') && /\.(mp4|pptx|mkv)$/.test(n))
  || n.includes('.bak') || n.includes('.old-')
  || /\.(tgz|zip|log|tmp|pyc)$/.test(n)

const README = `解压到哪、怎么装

一、把这五个目录解压到**工作区根目录**（就是放 persona-ai/ 的那个地方）。
   解压后应该是这样，五个目录并排在工作区根下：

   你的工作区/
   ├── persona-grow-plugin/      人格自学
   ├── persona-diary-plugin/     日记
   ├── persona-results-plugin/   成果
   ├── persona-explore-plugin/   碗外探索
   └── dsh-persona-memory/       记忆分层

   **不要**解压到某个子文件夹里——插件要能"看见"这些目录，靠的是扫工作区根。

二、重启 DSH（或刷新页面）。

三、打开 设置 → 附加插件。这一栏会自动认出上面五个：
   每条前面一个勾选框，后面一句介绍。

四、想装哪个就勾哪个 → 保存。装过的会变灰（那是"已经装好了"，
   不是坏了；要卸去插件管理器）。

注意事项

- 只装框架、不装这些也能用。框架是主体，这五个是附加件。
- 目录名**不要改**。设置页认的是包名，安装走的是目录名——改了会找不到。
- 可以只解压其中几个，设置页就只显示你解的那几个。
- 解压后这个说明文件可以删掉，不影响任何功能。
`

if (!existsSync(ADDONS)) {
  console.error(`没有 addons/ 目录：${ADDONS}`)
  process.exit(1)
}

const today = new Date()
const stamp = [
  today.getFullYear(),
  String(today.getMonth() + 1).padStart(2, '0'),
  String(today.getDate()).padStart(2, '0'),
].join('')
mkdirSync(DIST, { recursive: true })
const out = join(DIST, `dsh-persona-addons-${stamp}.zip`)

// 用 PowerShell 的 Compress-Archive 还是 node 的 zlib？
// node 没有内置 zip 写；用 PowerShell 最省事（Windows 自带）。
// 先把要打的东西摊到一个临时目录（剥掉 addons/ 那层），再压。
import { mkdtempSync, cpSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const stage = mkdtempSync(join(tmpdir(), 'persona-pack-'))
let n = 0
for (const pkg of readdirSync(ADDONS)) {
  const src = join(ADDONS, pkg)
  if (!statSync(src).isDirectory()) continue
  const walk = (from, to) => {
    mkdirSync(to, { recursive: true })
    for (const e of readdirSync(from)) {
      if (skip(e)) continue
      const a = join(from, e)
      const b = join(to, e)
      if (statSync(a).isDirectory()) walk(a, b)
      else { cpSync(a, b); n++ }
    }
  }
  walk(src, join(stage, pkg))
}
writeFileSync(join(stage, '解压后看这里.txt'), README, 'utf8')

try { rmSync(out, { force: true }) } catch { /* 没旧的 */ }
execFileSync('powershell', [
  '-NoProfile', '-Command',
  `Compress-Archive -Path '${stage}\\*' -DestinationPath '${out}' -Force`,
], { stdio: 'inherit' })

rmSync(stage, { recursive: true, force: true })
const size = (statSync(out).size / 1048576).toFixed(2)
console.log(`\n打好：${n} 个文件，${size} MB`)
console.log(`  ${out}`)
console.log('\n解压后应该是五个目录并排，不含 addons/ 这一层——那层剥掉了。')
