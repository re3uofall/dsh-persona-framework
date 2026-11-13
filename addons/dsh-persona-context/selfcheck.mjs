// dsh-persona-context 自检：按盘上真实签名断言，不按写代码时的记忆。
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const mod = await import(pathToFileURL(join(HERE, 'lib', 'ctx.mjs')).href)
const { CTX, KINDS, KIND_LABEL, SIDES, SIDE_LABEL, ctxDir, ledgerPath, noteRead, readLedger, stats, renderStats, unremembered, check, renderCheck, renderSection, cardOf, dismiss } = mod

let pass = 0
const fails = []
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; return }
  fails.push(detail ? `${name} — ${detail}` : name)
}
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`)

// ── 包与入口 ───────────────────────────────────────────
const pkg = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'))
ok('包名 dsh-persona-context', pkg.name === 'dsh-persona-context')
ok('package.json 声明 cordis 补丁', pkg.dsh?.bundle?.patch === './cordis.patch.yml')
ok('补丁文件在', existsSync(join(HERE, 'cordis.patch.yml')))
ok('图标在', existsSync(join(HERE, 'icon.svg')))
ok('README 在', existsSync(join(HERE, 'README.md')))

// ── 常量 ───────────────────────────────────────────────
ok('段 order 是 49', CTX.order === 49, String(CTX.order))
ok('账文件名', CTX.ledger === '上下文账.jsonl')
eq('六类 kind', KINDS, ['dialog', 'file', 'tool', 'memory', 'web', 'other'])
eq('两侧 side', SIDES, ['own', 'external'])
ok('kind 有中文名', KINDS.every((k) => typeof KIND_LABEL[k] === 'string' && KIND_LABEL[k]))
ok('side 有中文名', SIDES.every((s) => typeof SIDE_LABEL[s] === 'string' && SIDE_LABEL[s]))

// ── 临时工作区 ─────────────────────────────────────────
const ws = mkdtempSync(join(tmpdir(), 'ctx-check-'))
ok('ctxDir 落在 .persona-framework 下', ctxDir(ws).endsWith('persona-framework'))
ok('ledgerPath 以账名收尾', ledgerPath(ws).endsWith(CTX.ledger))

// ── noteRead ──────────────────────────────────────────
const bad = noteRead(ws, { kind: 'file' })
ok('没来源就不收', bad && bad.ok === false, JSON.stringify(bad))

const r1 = noteRead(ws, { source: 'persona-ai/knowledge/理论/x.md', kind: 'file', pointer: 'knowledge/理论/x.md#1', chars: 120, note: '读一段原文' })
ok('有来源就收', r1 && r1.ok === true, JSON.stringify(r1))
ok('默认没进记忆', r1.row.entered === false, String(r1.row.entered))
ok('有 pointer 算自己的', r1.row.side === 'own', String(r1.row.side))
ok('行里有时间', typeof r1.row.at === 'string' && r1.row.at.includes('T'))

const r2 = noteRead(ws, { source: '某段会话里顺出来的话', kind: 'dialog', chars: 40, entered: true })
ok('没 pointer 算外部的', r2.row.side === 'external', String(r2.row.side))
ok('显式 entered 保留', r2.row.entered === true)

const r3 = noteRead(ws, { source: '网页', kind: 'web', chars: 900, side: 'external' })
ok('显式 side 优先', r3.row.side === 'external')

// ── 读账与统计 ─────────────────────────────────────────
const rows = readLedger(ws)
eq('账上三行', rows.length, 3)
const st = stats(ws)
ok('stats.rows 对得上', st.rows === 3, String(st.rows))
ok('stats 有进没进记忆的计数', typeof st.entered === 'number', JSON.stringify(st))
ok('stats 按侧分组', st.bySide && typeof st.bySide.own === 'number', JSON.stringify(st.bySide))

const un = unremembered(ws)
eq('没进记忆的只有两条', un.length, 2)

// ── 查一条 ─────────────────────────────────────────────
const c1 = check(ws, '顺出来的')
ok('查到在上下文里', c1 && c1.inCtx === 1, JSON.stringify(c1))
ok('这条也进过记忆', c1.inMem === 1, JSON.stringify(c1))
const c2 = check(ws, '原文')
ok('另一条只在上下文', c2.inCtx === 1 && c2.inMem === 0, JSON.stringify(c2))
ok('判断里有「上下文」字样', /上下文/.test(c2.verdict), c2.verdict)
const c3 = check(ws, '从没读过的词')
ok('没读过就明说', c3.inCtx === 0 && /不在上下文/.test(c3.verdict), JSON.stringify(c3))

// ── 渲染 ───────────────────────────────────────────────
const sec = renderSection(ws, {})
ok('段首是「## 上下文」', String(sec).startsWith('## 上下文'), String(sec).slice(0, 40))
ok('段里写了「读过 ≠ 记住」或同义句', /读.*不.*记|读过/.test(String(sec)), String(sec).slice(0, 120))
ok('账能打成字', typeof renderStats(ws) === 'string')
ok('查账能打成字', typeof renderCheck(c2) === 'string')
eq('空串还是空串', cardOf('', 200), '')
const card = cardOf('第一行\n第二行\n第三行', 6)
ok('卡片有截断提示', card.length < 200 && /余下|…/.test(card), card)

// ── 文案 ───────────────────────────────────────────────
for (const lang of ['zh', 'en']) {
  const loc = JSON.parse(readFileSync(join(HERE, 'locale', `${lang}.json`), 'utf8'))
  const tools = loc.tools || {}
  ok(`${lang} 有四个工具名`, ['context_note', 'context_status', 'context_check', 'context_forget'].every((t) => typeof tools[t] === 'string' && tools[t]), Object.keys(tools).join(','))
  ok(`${lang} 有标题`, Boolean(loc.meta?.title))
}

// ── 收尾 ───────────────────────────────────────────────
writeFileSync(join(ws, '.check'), 'ok')
mkdirSync(join(ws, '.persona-framework'), { recursive: true })

const gone = dismiss(ws, '网页', '自检：标掉，不进统计')
ok('标掉写回账', gone.ok === true && gone.n === 1, JSON.stringify(gone))
const after = stats(ws)
ok('标掉的不再进统计', after.rows === 2 && readLedger(ws).length === 3, JSON.stringify(after))

const total = pass + fails.length
if (fails.length) {
  console.log(`过了：${pass} 项，没过 ${fails.length} 项（共 ${total}）`)
  for (const f of fails) console.log('  FAIL ' + f)
  process.exit(1)
}
console.log(`全部过了：${pass} 项，0 项没过`)
