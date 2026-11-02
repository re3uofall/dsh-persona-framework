// 冒烟：加固 / 两个库 / 注入顺序。只碰临时目录，不碰真工作区。
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_LAYERS, recall, scanPools } from './lib/pools.mjs'
import { scoreFiles, saveReinforce, loadReinforce, scoreOf } from './lib/reinforce.mjs'
import { addStimulus, readStimulus, renderLongLibrary, renderNowLibrary, renderOtherLibrary, renderShortLibrary } from './lib/libraries.mjs'
import { findVerbatim, renderTrace, sectionsOf } from './lib/trace.mjs'

const root = mkdtempSync(join(tmpdir(), 'pm-'))
const ok = (c, m) => console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`)
let fails = 0
const check = (c, m) => { if (!c) fails += 1; ok(c, m) }

// ── 造池子
mkdirSync(join(root, 'persona-ai/knowledge/session'), { recursive: true })
mkdirSync(join(root, 'persona-ai/knowledge/长期记忆'), { recursive: true })
mkdirSync(join(root, 'knowledge'), { recursive: true })
writeFileSync(join(root, 'persona-ai/knowledge/session/2026-11-01.md'),
  '# 11-01\n\n师父：加固要不要做？\n她：思思说做，撞上主体词就算，时间近的排前面。\n')
writeFileSync(join(root, 'persona-ai/knowledge/长期记忆/加固.md'),
  '# 加固\n\n加固只改排序，不删字节。\n')
writeFileSync(join(root, 'knowledge/无关.md'), '# 无关\n\n这是一条跟主体无关的记录，字数也不多。\n')

// ── 两格（长期 order 23 / 其他 order 30）；它们是两格，不是一格
const short = renderShortLibrary(root, { journalDir: 'persona-ai/knowledge/session', longTermDir: 'persona-ai/knowledge/长期记忆' })
const long = renderLongLibrary(root, { journalDir: 'persona-ai/knowledge/session', longTermDir: 'persona-ai/knowledge/长期记忆' })
const other = renderOtherLibrary(root, { journalDir: 'persona-ai/knowledge/session', longTermDir: 'persona-ai/knowledge/长期记忆' })
check(short.includes('## 短期记忆'), '短期那格有标题')
check(long.includes('## 长期记忆'), '长期那格叫「长期记忆」')
check(long.includes('记得久') && long.includes('重要'), '长期那格写明判据：记得久 + 重要')
check(!long.includes('## 其他记忆'), '长期那格不再冒充「其他记忆」')
check(other.includes('## 其他记忆'), '其他记忆是独立的一格')
check(short.includes('比人格原文件重要'), '短期那格写明它比人格原文件更重要')

const nowEmpty = renderNowLibrary(root, {})
check(nowEmpty.includes('即时记忆') && nowEmpty.includes('刺激记忆'), '即时库两个格子都在')

const add = addStimulus(root, '加固', 'session/2026-11-01.md#1')
check(add.ok && readStimulus(root).words['加固'].length === 1, '刺激记忆能记一条')
const now = renderNowLibrary(root, {})
check(now.includes('加固') && now.includes('session/2026-11-01.md#1'), '刺激记忆注进了即时库')

// ── 加固
const scan = scanPools(root, DEFAULT_LAYERS)
const files = scan.pools.flatMap((p) => p.files)
const sc = scoreFiles(root, files, { subjects: ['加固', '思思'] })
check(sc.items.length === files.length, '加固给每个文件都算了分')
const top = sc.items[0]
check(top.hits >= 2, `撞主体词的排最前（${top.path} hits=${top.hits}）`)

const saved = saveReinforce(root, sc.items)
check(saved.count > 0 && Object.keys(loadReinforce(root).entries).length > 0, '加固账落盘了')
check(typeof scoreOf({ at: new Date().toISOString(), hits: 3 }) === 'number', 'scoreOf 算得出数')

// ── 排序真的变了（加固 vs 不加固）
// 造一对：大的旧文件 vs 小的新文件。不带加固时大的先（字数大）；带加固时新的先。
writeFileSync(join(root, 'knowledge/旧大.md'),
  '# 旧大\n\n' + '加固无关的旧内容。'.repeat(300) + '\n')
const big = join(root, 'knowledge/旧大.md')
const old = new Date(Date.now() - 60 * 86400_000)
utimesSync(big, old, old)
writeFileSync(join(root, 'knowledge/新小.md'), '# 新小\n\n思思刚说过：加固只改排序。\n')

const scan2 = scanPools(root, DEFAULT_LAYERS)
const files2 = scan2.pools.flatMap((p) => p.files)
const sc2 = scoreFiles(root, files2, { subjects: ['加固', '思思'] })
saveReinforce(root, sc2.items)
const strip = (p) => String(p).split(/[\\/]/).pop()
const byName = new Map(sc2.items.map((x) => [strip(x.path), x.score]))
const order = (r) => r.picked.map((s) => strip(s.path))

const withR = recall(root, { budget: 50000, layers: DEFAULT_LAYERS, reinforce: (f) => byName.get(strip(f.path)) ?? 0 })
const without = recall(root, { budget: 50000, layers: DEFAULT_LAYERS })
console.log(`   加固后：${order(withR).join(' > ')}`)
console.log(`   没加固：${order(without).join(' > ')}`)
check(sc2.items[0].path.endsWith('新小.md'), '新小（撞主体 + 时间近）分最高')
check(order(withR).indexOf('新小.md') < order(withR).indexOf('旧大.md'), '加固后小的新的排在大的旧的之前')

// 真正的判据：同层内的先后被换过了。看池子里的排法，不看 picked——
// picked 还受该层预算截断，拿它判加固会把「预算不够」误记成「加固没生效」。
const poolOrder = (r) => r.scan.pools
  .map((p) => p.files.map((f) => strip(f.path)).join(','))
  .join(' | ')
check(poolOrder(withR) !== poolOrder(without), '加固确实改了同层内的先后（否则它就是白做的）')
console.log(`   池内排法（加固后）：${poolOrder(withR)}`)

// ── 按字查（trace）：在不在、谁说的、在哪一节
//
// 这一组的判据不是「能搜到」，是四件更窄的事：
//   ① 归属对（师父说的 vs 她说的，引用不算承诺）；
//   ② 指针是 memory_source 认的形状，查完翻得回去；
//   ③ 「没有」之前先归一过，假阴性不许报；
//   ④ 空池/没分节的文件不能因为没标题就整篇跳过。
writeFileSync(join(root, 'persona-ai/knowledge/session/2026-11-02.md'),
  '# 11-02 · 会话\n\n'
  + '## 09:30 加固\n\n'
  + '- tags: 加固\n- kind: session\n- source: test\n- updated: 2026-11-02\n\n'
  + '师父：加固只改排序，别删字节。\n'
  + '她：知道了。她还说「只改排序」这四个字要一字不改。\n\n'
  + '## 10:00 第二段\n\n'
  + '师父：第二段的话在这里。\n')

const DIRS = ['persona-ai/knowledge/session', 'persona-ai/knowledge/长期记忆', 'knowledge']

const tHe = findVerbatim(root, DIRS, '加固只改排序，别删字节')
check(tHe.mode === 'exact' && tHe.hits.length >= 1, '按字查命中师父那句（一字不差）')
check(tHe.hits.every((h) => h.who === 'he'), '归属是「师父说的」')

const tMe = findVerbatim(root, DIRS, '这四个字要一字不改')
check(tMe.hits.length >= 1 && tMe.hits[0].who === 'me', '她说的那句归到「她」名下')
const rendered = renderTrace('这四个字要一字不改', tMe)
check(!rendered.includes('师父说的（') && rendered.includes('引用不算'), '只有她说的时，明写「引用不算师父答应过什么」')

check(/^session\/2026-11-02\.md#1$/.test(tHe.hits[0].pointer),
  `指针是 memory_source 的形状（${tHe.hits[0].pointer}），不带 persona-ai/knowledge/ 前缀`)

const tSec2 = findVerbatim(root, DIRS, '第二段的话')
check(tSec2.hits.length === 1 && tSec2.hits[0].pointer.endsWith('#2'), '同文件第二处命中给的是第 2 节，不是第 1 节')

const tQuote = findVerbatim(root, DIRS, '"只改排序"')
check(tQuote.mode === 'loose' && tQuote.hits.length >= 2, '带引号查：原样找不到，去掉引号后找到（不说「没有」）')

const tWhole = findVerbatim(root, DIRS, '加固要不要做')
check(tWhole.hits.length >= 1 && tWhole.hits[0].who === 'he', '没分节的整篇文件也能查到（不因缺 ## 标题就跳过）')

const tNone = findVerbatim(root, DIRS, '这句话压根没在账上出现过')
check(tNone.mode === 'none' && tNone.hits.length === 0, '真没有就是 none')
const noneText = renderTrace('这句话压根没在账上出现过', tNone)
check(noneText.includes('没有') && !noneText.includes('没扫完'), '报「没有」时不许夹带「没扫完」')

check(sectionsOf('# x\n\n## a\nA\n\n## b\nB\n').length === 2, 'sectionsOf 按 ## 切两节')
// CRLF 回归：池子里的 md 全是 CRLF，不归一就会整篇成一节、指针全变 #1
check(sectionsOf('# x\r\n\r\n## a\r\nA\r\n\r\n## b\r\nB\r\n').length === 2, 'sectionsOf 认 CRLF（不许把整篇当一节）')

console.log(fails ? `\n${fails} 条没过` : '\n全过')
process.exit(fails ? 1 : 0)
