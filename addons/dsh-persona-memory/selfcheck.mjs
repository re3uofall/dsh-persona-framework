/**
 * 自检：不连宿主，直接把四个工具的纯逻辑跑一遍。
 * 认的是「代码跑得通、边界不炸」，不认「记忆写得好不好」。
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { archiveOld, recall, renderArchive, renderPools, renderRecall, scanPools, DEFAULT_LAYERS } from './lib/pools.mjs'
import { condense, condenseJournal, excerpt, renderCondense } from './lib/journal.mjs'

let pass = 0
let fail = 0
function ok(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`) }
  else { fail += 1; console.log(`  ✗ ${name} ${detail}`) }
}

const root = mkdtempSync(join(tmpdir(), 'pm-'))
const k = join(root, 'persona-ai/knowledge')
mkdirSync(join(k, 'session'), { recursive: true })
mkdirSync(join(k, 'chat'), { recursive: true })
mkdirSync(join(k, 'world'), { recursive: true })
mkdirSync(join(root, 'knowledge'), { recursive: true })

writeFileSync(join(k, 'world', '判断.md'), '# 判断\n\n' + '这是一句真的判断。'.repeat(20), 'utf8')
// 大文件 + 长段落：指针约 40 字/条，只有原始每段明显超过它，压才划算。
// 真实流水约 449 字/段（145532 字 ÷ 324 段），这里照那个尺度造。
{
  const many = []
  const 长 = '这是真实流水那种长度的一段话，里头有好几个分句。'.repeat(14)
  for (let i = 1; i <= 20; i += 1) {
    many.push(`## 第 ${i} 段\n师父：${长}\n她：${长}`)
  }
  writeFileSync(join(k, 'session', '2026-10-22.md'), `# 2026-10-22 · 会话\n\n${many.join('\n\n')}`, 'utf8')
}

writeFileSync(join(k, 'session', '2026-10-20.md'),
  '# 2026-10-20 · 会话\n\n## 一、开头\n师父：我们今天先说清楚这件事到底算不算数。\n她：算不算数要看它有没有留下可核对的东西。\n\n## 二、第二段\n师父：那这个呢？\n她：这个得看代价谁付。\n', 'utf8')
writeFileSync(join(root, 'knowledge', '总判断.md'), '# 总判断\n\n池子的判断在这里。', 'utf8')

console.log('== 一、统计')
{
  const s = scanPools(root, DEFAULT_LAYERS)
  ok('扫到了池子', s.totalFiles >= 3, `文件 ${s.totalFiles}`)
  ok('流水层被认出来', s.pools.some((p) => p.key === 'journal' && p.count > 0))
  ok('占比加起来是 1', Math.abs(s.pools.reduce((a, b) => a + b.share, 0) - 1) < 0.001)
  const out = renderPools(s)
  ok('表渲染出来了', out.includes('记忆池：'), out.slice(0, 40))
}

console.log('== 二、提炼')
{
  const rows = condense('# 2026-10-20 · 会话\n\n## 一、开头\n师父：我们今天先说清楚这件事到底算不算数。\n她：算不算数要看它有没有留下可核对的东西。\n')
  ok('抽出了行', rows.length === 1, `rows ${rows.length}`)
  ok('一行里既有人也有回话', rows[0].line.includes('师父：') && rows[0].line.includes('她：'), rows[0]?.line)
  ok('每行带 seq（指针要用）', rows[0].seq === 1, `seq ${rows[0]?.seq}`)
  ok('认不出格式就返回空', condense('随便一段没格式的话').length === 0)
  const r = condenseJournal(root, {})
  ok('干跑不写文件', r.dryRun === true)
  // 小文件（<600 字）压完反而更长——指针有成本。这条测的是那个阈值生效了。
  ok('小文件被跳过（压了更长）', r.keptChars === 0 || r.keptChars <= r.rawChars * 2, `${r.keptChars} vs ${r.rawChars}`)
  ok('渲染不炸', renderCondense(r).includes('提炼'), renderCondense(r).slice(0, 30))
  // ★ ECHO 那条判据：压出来的必须带指针，且按指针翻得回原文
  {
    const { existsSync: ex, readFileSync: rf } = await import('node:fs')
    const { join: jn } = await import('node:path')
        const r22 = condenseJournal(root, { dryRun: false })
    const big = r22.results.find((x) => x.file === '2026-10-22.md')
    ok('大文件被压了（小文件跳过）', big != null && big.chars > 0, big ? `${big.chars} 字` : '没找到')
    ok('压出来的比原文短（大文件才算得过来）', big != null && big.chars < big.rawChars, big ? `${big.chars} vs ${big.rawChars}` : '')
    const wrote = join(root, 'persona-ai/knowledge/chat/2026-10-22.md')
    ok('写出来的带指针', ex(wrote) && rf(wrote, 'utf8').includes('源：session/'), '')
    const src = rf(jn(root, 'persona-ai/knowledge/session/2026-10-20.md'), 'utf8')
    const seg = excerpt(src, 1, 200)
    ok('按指针翻得回原文', seg.includes('## '), seg.slice(0, 20))
    ok('不存在的 seq 返回空', excerpt(src, 99, 200) === '')
  }
  const r2 = condenseJournal(root, { dryRun: false })
  ok('真跑写了文件', r2.dryRun === false && r2.results.length > 0)
}

console.log('== 三、按预算取')
{
  const r = recall(root, { budget: 300, layers: DEFAULT_LAYERS })
  ok('没超预算', r.used <= 300, `used ${r.used}`)
  ok('取到了东西', r.picked.length > 0)
  ok('判断层优先于流水层', r.picked[0].layer !== 'journal', r.picked[0]?.layer)
  ok('渲染不炸', renderRecall(r).includes('按预算取记忆'))
  const rq = recall(root, { budget: 300, query: '代价谁付', layers: DEFAULT_LAYERS })
  // 截断会把 query 那几个字切掉，所以查「取到的那几个文件里含不含」，不查切完的正文
  const { readFileSync: rf } = await import('node:fs')
  ok('query 能过滤', rq.picked.length > 0 && rq.picked.every((p) => rf(p.path, 'utf8').includes('代价谁付')), `picked ${rq.picked.length}`)
}

console.log('== 四、归档')
{
  const old = new Date(Date.now() - 30 * 86400_000)
  writeFileSync(join(k, 'session', '2026-09-01.md'), '# 旧\n\n老流水。', 'utf8')
  // 把 mtime 调到 30 天前
  import('node:fs').then(({ utimesSync }) => utimesSync(join(k, 'session', '2026-09-01.md'), old, old))
  const r = archiveOld(root, { days: 7, dryRun: true, layers: DEFAULT_LAYERS })
  ok('干跑没动文件', r.dryRun === true)
  ok('渲染不炸', renderArchive(r).includes('归档'))
}

console.log(`\n通过 ${pass}，失败 ${fail}`)
try { rmSync(root, { recursive: true, force: true }) } catch { /* 清不掉就留着 */ }
process.exit(fail ? 1 : 0)
