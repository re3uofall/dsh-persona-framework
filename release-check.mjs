/**
 * 发版体检：一条命令，把「改版本号时必须做的事」全跑一遍。
 *
 * 用法：node release-check.mjs        只查
 *       node release-check.mjs --fix  能自动修的顺手修（版本号不一致时）
 *
 * 它查七类：
 *   一 版本号：index.js / package.json / index.json / FRAMEWORK.ai.md / FRAMEWORK.md / README / MANIFEST
 *   二 README：版本行、op 数、开关数、自检项数，跟代码对得上
 *   三 AI 语言适配：FRAMEWORK.ai.md 头部版本、规则编号连续、术语表在
 *   四 配置四通道：DEFAULTS / EDITABLE / publicState / save()，外加前端回退值不能跟后端漂移
 *   五 模块：七节齐、更新记录在最后、一句话在、判据/自查各 ≥3
 *   六 索引：MODULES.md 与 00-目录.md 覆盖同一批模块，70 分钟压缩后不超上限
 *   七 测试：语法、自检、op、程序、工具、内容、过期扫描
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { spawnSync } from 'node:child_process'

// ★ 从脚本自己的位置往上推，不写死盘符——换电脑、换工作区名都不用改。
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname } from 'node:path'
const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = HERE
const WS = dirname(HERE)
const NODE = process.execPath

const problems = []
const warns = []
const say = (s = '') => console.log(s)
const ok = (name, detail = '') => say(`  ✓ ${name}${detail ? '｜' + detail : ''}`)
const bad = (name, detail = '') => { problems.push(name + (detail ? ' — ' + detail : '')); say(`  ✗ ${name}${detail ? '｜' + detail : ''}`) }
const warn = (name, detail = '') => { warns.push(name + (detail ? ' — ' + detail : '')); say(`  · ${name}${detail ? '｜' + detail : ''}`) }

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const idx = read(join(PKG, 'index.js'))
const cli = read(join(PKG, 'client.js'))
const readme = read(join(PKG, 'README.md'))
const changelog = read(join(PKG, 'CHANGELOG.md'))

// ── 一、版本号
say('== 一、版本号 ==')
const verOf = (t, re) => { const m = t.match(re); return m ? m[1] : '' }
const versions = {
  'index.js': verOf(idx, /const VERSION = '([^']+)'/),
  'package.json': verOf(read(join(PKG, 'package.json')), /"version":\s*"([^"]+)"/),
  'index.json': verOf(read(join(PKG, 'index.json')), /"version":\s*"([^"]+)"/),
  'FRAMEWORK.ai.md': verOf(read(join(PKG, 'framework/FRAMEWORK.ai.md')), /版本：([\d.]+)/),
  'FRAMEWORK.md': verOf(read(join(PKG, 'framework/FRAMEWORK.md')), /版本：([\d.]+)/),
  'README.md': verOf(readme, /^版本 ([\d.]+)/m),
  // MANIFEST 第一行是「# 发布指纹清单」，第二行才是「# 版本：x.y.z」，第三行是生成时间。
  // 用 `/v?([\d.]+)/` 抓「第一个数字」是碰运气——哪天生成时间排到版本号前面，就抓到 2026 了。
  'MANIFEST.txt': verOf(read(join(PKG, 'MANIFEST.txt')), /版本：([\d.]+)/),
}
const distinct = [...new Set(Object.values(versions).filter(Boolean))]
if (distinct.length === 1) ok('七处版本号一致', distinct[0])
else bad('版本号不一致', Object.entries(versions).map(([k, v]) => `${k}=${v || '(缺)'}`).join(' '))

// 整行匹配，别用 includes：`includes('## 5.1.0')` 会被 `## 5.1.0-old` 这种行骗过去（故障注入测出来的）
const clRe = new RegExp(`^## ${distinct[0].replace(/\./g, '\\.')}(?:\\s|·|$)`, 'm')
if (!clRe.test(changelog)) bad('CHANGELOG 没有当前版本的条目', distinct[0])
else ok('CHANGELOG 有当前版本条目', distinct[0])

// ── 二、README 跟代码对得上
say('')
say('== 二、README 跟代码对得上 ==')
// README 里写的是中文数字（「二十八个 op」）。先把 README 里那个数字解析出来，再跟代码比。
// 原来写成 `readme.includes('二十八个 op') || ...`——只要 README 写着「二十八个」，这条就永远过，
// 代码里删掉几个 op 也发现不了（故障注入测出来的）。
const CN_NUM = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const cnToInt = (s) => {
  if (/^\d+$/.test(s)) return Number(s)
  if (!s) return NaN
  if (s === '十') return 10
  if (s.startsWith('十')) return 10 + (CN_NUM[s[1]] || 0)
  if (s.includes('十')) {
    const [a, b] = s.split('十')
    return (CN_NUM[a] || 0) * 10 + (b ? CN_NUM[b] || 0 : 0)
  }
  // 二十几、三十几这种两位拼法
  let n = 0
  for (const ch of s) n = n * 10 + (CN_NUM[ch] ?? NaN)
  return n
}
const ops = new Set([...idx.matchAll(/op === '([a-zA-Z]+)'/g)].map((m) => m[1]))
const opCount = ops.size
const readmeOpMatch = readme.match(/([零一二三四五六七八九十\d]+)\s*个\s*op/)
const readmeOpNum = readmeOpMatch ? cnToInt(readmeOpMatch[1]) : NaN
if (!readmeOpMatch) warn('README 里没写「N 个 op」', '没法核对 op 数')
else if (readmeOpNum === opCount) ok('op 数对得上', String(opCount))
else bad('README 的 op 数跟代码不一致', `README ${readmeOpMatch[1]}（${readmeOpNum}）／ 代码 ${opCount}`)

// README 程序表里的 op 名，跟代码里的 op 集合逐一对上——数量对不代表名字对。
// 只比数字的旧办法：把 write 改名成 writeXX，数量不变，表里写 write 也不报。
const procHead = readme.search(/^## [^\n]*个程序\s*$/m)
if (procHead < 0) {
  warn('README 没有「N 个程序」那一节', '没法核对 op 名')
} else {
  const after = readme.indexOf('\n## ', procHead + 1)
  const procSec = readme.slice(procHead, after < 0 ? readme.length : after)
  const readmeOps = [...new Set([...procSec.matchAll(/^\| `([a-zA-Z][a-zA-Z0-9]*)` \|/gm)].map((m) => m[1]))]
  const codeOps = [...ops]
  const onlyReadme = readmeOps.filter((o) => !codeOps.includes(o))
  const onlyCode = codeOps.filter((o) => !readmeOps.includes(o))
  if (!onlyReadme.length && !onlyCode.length) ok('README 程序表的 op 名跟代码逐一对上', String(readmeOps.length))
  else {
    bad(
      'README 程序表跟代码的 op 名对不上',
      [
        onlyReadme.length ? `表里有代码没有：${onlyReadme.join('、')}` : '',
        onlyCode.length ? `代码有表里没有：${onlyCode.join('、')}` : '',
      ].filter(Boolean).join('；'),
    )
  }
}

const defaultsBlock = idx.slice(idx.indexOf('const DEFAULTS'), idx.indexOf('\n}', idx.indexOf('const DEFAULTS')))
const boolDefaults = [...defaultsBlock.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*): (true|false),/gm)]
if (readme.includes('十六个开关') && boolDefaults.length >= 16) ok('可选开关规模对得上', `${boolDefaults.length} 个布尔键`)
else warn('README 的开关数可能没跟上', `代码 ${boolDefaults.length} 个布尔键`)

// README 里提到的每个配置键，代码里得真有
// 只认「## 配置」那一节的表格——程序表也用 `| \`op名\` |` 这种格式，别混进来
const cfgSecStart = readme.indexOf('## 配置')
const cfgSec = cfgSecStart < 0 ? '' : readme.slice(cfgSecStart, (readme.indexOf('\n## ', cfgSecStart + 1) + 1) || readme.length)
const readmeKeys = [...new Set([...cfgSec.matchAll(/^\| `([a-zA-Z][a-zA-Z0-9]*)` \|/gm)].map((m) => m[1]))]
const missingKeys = readmeKeys.filter((k) => !new RegExp(`\\b${k}:`).test(idx))
if (!missingKeys.length) ok('README 配置表里的键代码里都有', `${readmeKeys.length} 个`)
else bad('README 配置表有代码里没有的键', missingKeys.join('、'))

// ── 三、AI 语言适配
say('')
say('== 三、AI 语言适配 ==')
const ai = read(join(PKG, 'framework/FRAMEWORK.ai.md'))
const rules = [...ai.matchAll(/^### R(\d+) /gm)].map((m) => Number(m[1]))
if (!rules.length) bad('FRAMEWORK.ai.md 没有规则')
else {
  const sorted = [...rules].sort((a, b) => a - b)
  const gap = sorted.findIndex((n, i) => n !== i + 1)
  if (gap < 0) ok('规则编号连续', `R1–R${sorted[sorted.length - 1]}`)
  else bad('规则编号断了', `第 ${gap + 1} 条应为 R${gap + 1}，实际 R${sorted[gap]}`)
  if (ai.includes('术语表')) ok('术语表在')
  else bad('FRAMEWORK.ai.md 缺术语表')
  // 每条规则要写「触发」和「反例」
  const blocks = ai.split(/^### R\d+ /m).slice(1)
  const noTrigger = blocks.filter((b) => !/触发[：:]/.test(b)).length
  const noCounter = blocks.filter((b) => !/反例[：:]/.test(b)).length
  if (!noTrigger) ok('每条规则都有「触发」')
  else warn(`${noTrigger} 条规则没有「触发」`)
  if (!noCounter) ok('每条规则都有「反例」')
  else warn(`${noCounter} 条规则没有「反例」`)
}
if (ai.includes('读法：') && ai.includes('触发')) ok('注入读法那行在')

// ── 四、配置四通道
say('')
say('== 四、配置四通道 ==')
const edMatch = idx.match(/const EDITABLE = \[([\s\S]*?)\]/)
const editable = edMatch ? [...edMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : []
const psStart = idx.indexOf('const publicState = () => ({')
const psBlock = idx.slice(psStart, idx.indexOf('\n  })', psStart))
const psKeys = [
  ...psBlock.matchAll(/^ {4}([a-zA-Z][a-zA-Z0-9]*):/gm),
  ...psBlock.matchAll(/^ {4}([a-zA-Z][a-zA-Z0-9]*),\s*$/gm),
].map((m) => m[1])
// save() 的键：只认 post 的 body 那一块——整个 save 函数里有样式对象（whiteSpace 之类），别混进来
const svStart = cli.indexOf('body: JSON.stringify({')
const svEnd = cli.indexOf('}),', svStart)
const svBlock = svStart < 0 ? '' : cli.slice(svStart, svEnd < 0 ? svStart + 5000 : svEnd)
const svKeys = [...svBlock.matchAll(/^ {14}([a-zA-Z][a-zA-Z0-9]*):/gm)].map((m) => m[1])
const fallbacks = {}
for (const m of svBlock.matchAll(/^ {14}([a-zA-Z][a-zA-Z0-9]*):\s*Number\(cfg\.[a-zA-Z0-9]+\)\s*\|\|\s*([\d.]+),/gm)) fallbacks[m[1]] = m[2]

const dKeys = [...defaultsBlock.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*):/gm)].map((m) => m[1])
const chan = []
for (const k of svKeys) if (!editable.includes(k)) chan.push(`save 有、EDITABLE 没有：${k}`)
for (const k of svKeys) if (!psKeys.includes(k)) chan.push(`save 有、publicState 没有：${k}`)
for (const k of editable) if (!dKeys.includes(k)) chan.push(`EDITABLE 有、DEFAULTS 没有：${k}`)
for (const [k, v] of Object.entries(fallbacks)) {
  const m = defaultsBlock.match(new RegExp(`^ {2}${k}: ([^,\\n]+),`, 'm'))
  if (m && m[1].trim() !== v) chan.push(`默认值漂移：${k} 前端 ${v} ／ 后端 ${m[1].trim()}`)
}
if (!chan.length) ok('四通道一致', `DEFAULTS ${dKeys.length}／EDITABLE ${editable.length}／publicState ${psKeys.length}／save ${svKeys.length}`)
else for (const c of chan) bad(c)

// ── 五、模块
say('')
say('== 五、模块 ==')
const MODDIR = join(WS, 'persona-ai/modules')
const modFiles = (await import('node:fs')).readdirSync(MODDIR).filter((n) => /^\d{2}-.*\.md$/.test(n) && !n.startsWith('00'))
const CANON = ['它是什么', '结构', '怎么动', '判据', '边界', '接口', '自查']
let modBad = 0
for (const f of modFiles) {
  const t = readFileSync(join(MODDIR, f), 'utf8')
  const heads = [...t.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim().replace(/^[一二三四五六七八九十]+、\s*/, ''))
  const missing = CANON.filter((c) => !heads.some((h) => h.startsWith(c)))
  const logOk = heads[heads.length - 1] && heads[heads.length - 1].startsWith('更新记录')
  const one = /^> 一句话：/m.test(t)
  if (missing.length || !logOk || !one) { modBad++; if (modBad <= 5) bad(`模块 ${f}`, [missing.length ? `缺 ${missing.join('/')}` : '', !logOk ? '更新记录不在最后' : '', !one ? '缺一句话' : ''].filter(Boolean).join('，')) }
}
if (!modBad) ok('全部模块七节齐、更新记录在最后、有一句话', `${modFiles.length} 个`)

// ── 六、索引
say('')
say('== 六、索引 ==')
const { compactIndex } = await import(pathToFileURL(join(PKG, 'lib/digest.mjs')).href)
const modulesMd = read(join(PKG, 'framework/MODULES.md'))
const dirMd = read(join(MODDIR, '00-目录.md'))
const nums = (t) => new Set([...t.matchAll(/^(?:\|\s*|-\s+)(\d{2})\s/gm)].map((m) => m[1]))
const a = nums(modulesMd)
const b = nums(dirMd)
const onlyA = [...a].filter((n) => !b.has(n))
const onlyB = [...b].filter((n) => !a.has(n))
if (!onlyA.length && !onlyB.length) ok('两份索引覆盖同一批模块', `${a.size} 个`)
else bad('两份索引不一致', `${onlyA.length ? 'MODULES 多：' + onlyA.join('、') : ''}${onlyB.length ? ' 00-目录 多：' + onlyB.join('、') : ''}`)

const maxMod = Number((idx.match(/maxModulesChars: (\d+)/) || [])[1] || 4000)
const natural = compactIndex(modulesMd)
const squeezed = compactIndex(modulesMd, maxMod)
// 注意：squeezed 是「按预算压完」的结果，它天然 ≤ maxMod——所以只比这一条永远绿，等于没查。
// 真该查的是两样：压不进去（压缩算法坏了），和压得太狠（预算小到把内容挤没了）。
const ratio = natural.length ? squeezed.length / natural.length : 1
if (squeezed.length > maxMod) {
  bad('索引按预算压后仍超上限', `${squeezed.length} > ${maxMod}`)
} else if (natural.length > 200 && ratio < 0.5) {
  bad(
    '索引压得太狠，信息丢了',
    `${natural.length} → ${squeezed.length}（预算 ${maxMod}），只剩 ${Math.round(ratio * 100)}%；预算太小，模块名会被截没`,
  )
} else {
  ok('索引按预算压后装得下，也没压过火', `${squeezed.length} / ${maxMod} 字（原 ${natural.length}，${Math.round(ratio * 100)}%）`)
}

// ── 七、测试
say('')
say('== 七、测试 ==')
const run = (label, file, args = []) => {
  // ★ .tools 在工作区根，不在插件目录里。原来只往插件目录找，五道测试**一直在跑不存在的文件**——
  //   永远失败，而我又只看 tail，看不见。两处都找，找不到就说清楚「没这个脚本」，不装成测试通过。
  // 调过来可能已经是绝对路径（比如 join(PKG, 'selfcheck.mjs')）——再 join 一次会拼成 PKG\C:\...。
  const candidates = isAbsolute(file) ? [file] : [join(PKG, file), join(WS, file)]
  const found = candidates.find((x) => existsSync(x))
  if (!found) { warn(label, `没有这个脚本：${file}（插件目录和工作区都找过）`); return }
  const r = spawnSync(NODE, [found, ...args], { cwd: dirname(found), encoding: 'utf8' })
  const out = (r.stdout || '') + (r.stderr || '')
  const lastLine = out.trim().split('\n').filter(Boolean).pop() || '(无输出)'
  if (r.status === 0) ok(label, lastLine.slice(0, 70))
  else bad(label, lastLine.slice(0, 70))
}
run('自检', join(PKG, 'selfcheck.mjs'))
const syntax = ['index.js', 'client.js', 'lib/programs.mjs', 'lib/workspace.mjs', 'lib/poolwrite.mjs', 'lib/autolex.mjs', 'lib/autosched.mjs', 'lib/anchor.mjs', 'lib/digest.mjs']
let synBad = 0
for (const f of syntax) {
  const r = spawnSync(NODE, ['--check', join(PKG, f)], { encoding: 'utf8' })
  if (r.status !== 0) { synBad++; bad(`语法 ${f}`, (r.stderr || '').split('\n')[0]) }
}
if (!synBad) ok('语法九个文件', '全过')
for (const [label, f] of [
  ['op 测试', '.tools/test_ops.mjs'],
  ['程序测试', '.tools/test_programs.mjs'],
  ['工具测试', '.tools/test_all_tools.mjs'],
  ['内容抽查', '.tools/test_content.mjs'],
  ['真实人格', '.tools/test_real_persona.mjs'],
  ['过期扫描', '.tools/scan_stale.mjs'],
  ['全量体检', '.tools/audit_all.mjs'],
]) {
  if (existsSync(join(WS, f))) run(label, join(WS, f))
  else warn(`${label} 不在`, f)
}

// ── 汇总
say('')
say('='.repeat(50))
if (problems.length) {
  say(`✗ ${problems.length} 处必须修：`)
  for (const p of problems) say('  ' + p)
  process.exitCode = 1
} else {
  say('✓ 发版体检全过')
}
if (warns.length) {
  say('')
  say(`· ${warns.length} 处提醒（不挡发版）：`)
  for (const w of warns) say('  ' + w)
}
