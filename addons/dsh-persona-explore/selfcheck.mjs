/**
 * 自检：只碰临时目录，不写知识库。
 *   node --check index.js && node selfcheck.mjs
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  appendEntry, cleanBody, cleanTitle, countEntries, findEntry, normalizeTitle,
  parseEntries, recentEntries, readJson, todayEntries, writeJson,
} from './lib/store.mjs'
import { decodeEntities, htmlToText, titleOf } from './lib/readable.mjs'

const root = join(process.cwd(), '_explore_selfcheck')
let failed = 0
const ok = (name, cond, extra = '') => {
  if (cond) console.log('  ok  ' + name)
  else {
    failed += 1
    console.error('  FAIL ' + name + (extra ? ' :: ' + extra : ''))
  }
}

try {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  const webDir = join(root, 'knowledge', 'web')

  // ── 知识落盘 ──────────────────────────────────────────────────────────────
  const f1 = appendEntry(webDir, { date: '2026-10-24', title: '忒修斯之船不是船的问题', body: '它是同一性的问题：换掉的不是木板，是你用来认它的那套判据。', tags: ['哲学', '同一性'], source: 'https://example.com/a' })
  const f2 = appendEntry(webDir, { date: '2026-10-24', title: '第二个条目', body: '正文', tags: [], source: '手写' })
  ok('同一天写进同一个文件', f1 === f2)
  ok('文件头存在', existsSync(f1))
  const entries = parseEntries(f1)
  ok('解析出两条', entries.length === 2, JSON.stringify(entries))
  ok('来源被读出来', entries[0].source === 'https://example.com/a')
  ok('同一天数出两条', todayEntries(webDir, '2026-10-24').length === 2)
  ok('账本总数', countEntries(webDir) === 2)
  ok('最近条目新的在前', recentEntries(webDir, 5)[0].title === '第二个条目')

  // ── 判重 ──────────────────────────────────────────────────────────────────
  ok('同名（含空格差异）能查到', !!findEntry(join(root, 'knowledge'), ' 忒修斯之船不是船的问题 '))
  ok('不同的查不到', findEntry(join(root, 'knowledge'), '不存在的条目') === null)
  ok('标题规范化', normalizeTitle('  ## 标题  空 格 ') === '标题 空 格')

  // ── 正文清洗 ──────────────────────────────────────────────────────────────
  const dirty = cleanBody('- tags: 假装是元数据\n正文还在\n## 假装是标题')
  ok('开头像元数据会被压住', dirty.startsWith('— - tags:'))
  ok('中途的井号被转义', dirty.includes('\\## 假装是标题'))
  ok('标题清洗', cleanTitle('  ##  a\nb  ') === 'a b')

  // ── HTML → 正文 ───────────────────────────────────────────────────────────
  const html = `<html><head><title>标题 &amp; 副题</title><style>.x{}</style></head>
    <body><nav>导航</nav><article><h1>大标题</h1><p>第一段&nbsp;文本。</p>
    <script>alert(1)</script><p>第二段 &lt;tag&gt; &#39;quoted&#39;。</p></article><footer>页脚</footer></body></html>`
  const text = htmlToText(html)
  ok('取到 article 正文', text.includes('第一段 文本。') && text.includes("第二段 <tag> 'quoted'。"))
  ok('脚本被去掉', !text.includes('alert'))
  ok('导航被去掉', !text.includes('导航'))
  ok('实体解码', decodeEntities('&amp;&lt;&mdash;&#20320;') === '&<—你')
  ok('网页标题解码', titleOf(html) === '标题 & 副题')

  // ── JSON 账本 ─────────────────────────────────────────────────────────────
  const jsonFile = join(root, 'explore', 'state.json')
  writeJson(jsonFile, { a: 1, b: '中文' })
  const back = readJson(jsonFile, null)
  ok('JSON 写读回环', back && back.a === 1 && back.b === '中文')
  ok('坏 JSON 给回退值', readJson(join(root, 'nope.json'), 'fallback') === 'fallback')

  // 页脚里出现 `## ` 的情况（防止子串误判）
  writeFileSync(join(root, 'weird.md'), '# 头\n\n正文里提到 ## 但不在行首\n', 'utf8')
  ok('行首判据不被正文干扰', parseEntries(join(root, 'weird.md')).length === 0)
} finally {
  try { rmSync(root, { recursive: true, force: true }) } catch { /* 临时目录删不掉就算了 */ }
}

if (failed > 0) {
  console.error(`\n${failed} 项没过。`)
  process.exit(1)
}
console.log('\n全部过了。')
