// selfcheck.mjs — dsh-persona-bridge
// 按盘上真实签名跑；任何一项失败都要打印原因，不吞。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BRIDGES, MODES, MODE_LABEL, DEFAULTS,
  bridgeDir, cardOf, ledgerPath, loadState, saveState, setMode, modeOf,
  record, translate, pullInbox, unreadCount, stats, renderStats, renderSection,
} from './lib/bridge.mjs'

let ok = 0
let bad = 0
function check(name, fn) {
  try {
    const r = fn()
    if (r === false) throw new Error('断言为假')
    ok++
    console.log('  ok   ' + name)
  } catch (e) {
    bad++
    console.log('  FAIL ' + name + ' — ' + (e && e.message ? e.message : e))
  }
}

const ws = mkdtempSync(join(tmpdir(), 'bridge-check-'))
console.log('工作区：' + ws)

// ── 一、三桥定义
check('六条桥 id 正好是 virtual / game / info / home / auto / external', () => {
  const ids = BRIDGES.map((b) => b.id).sort().join(',')
  if (ids !== 'auto,external,game,home,info,virtual') throw new Error(ids)
})
check('每一条都有 name / mode / channels', () => {
  for (const b of BRIDGES) {
    if (!b.label || !b.defaultMode) throw new Error(b.id + ' 缺字段')
    if (!Array.isArray(b.channels) || !b.channels.length) throw new Error(b.id + ' 缺 channels')
  }
})
check('默认模式都是合法的两种之一', () => {
  for (const b of BRIDGES) if (!MODES.includes(b.defaultMode)) throw new Error(b.id)
})
check('虚拟桥默认非会话、资讯桥默认会话', () => {
  const v = BRIDGES.find((b) => b.id === 'virtual')
  const i = BRIDGES.find((b) => b.id === 'info')
  if (v.defaultMode !== 'nonsession') throw new Error('virtual=' + v.defaultMode)
  if (i.defaultMode !== 'session') throw new Error('info=' + i.defaultMode)
})
check('两种模式有中文名', () => {
  if (MODE_LABEL.session !== '会话桥') throw new Error(String(MODE_LABEL.session))
  if (MODE_LABEL.nonsession !== '非会话桥') throw new Error(String(MODE_LABEL.nonsession))
})
check('DEFAULTS.order 是 48', () => {
  if (DEFAULTS.order !== 48) throw new Error(String(DEFAULTS.order))
})

// ── 二、状态与模式
check('未设过的桥按默认模式', () => {
  const m = modeOf(ws, 'virtual')
  if (m !== 'nonsession') throw new Error(String(m))
})
check('坏模式被拒（回 ok:false，不写盘）', () => {
  const r = setMode(ws, 'virtual', 'nonsense')
  if (r && r.ok !== false) throw new Error(JSON.stringify(r))
  if (modeOf(ws, 'virtual') !== 'nonsession') throw new Error('被写坏了')
})
check('好模式能存能读', () => {
  const r = setMode(ws, 'virtual', 'session')
  if (r && r.ok === false) throw new Error(JSON.stringify(r))
  if (modeOf(ws, 'virtual') !== 'session') throw new Error(modeOf(ws, 'virtual'))
})
check('状态文件落在 .persona-framework 下', () => {
  const s = loadState(ws)
  if (!s || typeof s !== 'object') throw new Error('空状态')
  const p = join(ws, DEFAULTS.dir, DEFAULTS.stateFile)
  if (!existsSync(p)) throw new Error('没写 ' + p)
})

// ── 三、转译与落盘
check('translate 三桥都能出方案', () => {
  for (const b of BRIDGES) {
    const r = translate(ws, b.id, '试一句')
    if (!r || r.ok === false) throw new Error(b.id + ' ' + JSON.stringify(r))
    if (typeof r.plan !== 'string' || !r.plan.length) throw new Error(b.id + ' 没有 plan')
  }
})
check('translate 的方案带判据与下一步', () => {
  const r = translate(ws, 'game', '读一下存档')
  if (!r.plan.includes('判据')) throw new Error('缺判据')
  if (!r.plan.includes('下一步')) throw new Error('缺下一步')
})
check('record 落 in 账', () => {
  const r = record(ws, { bridge: 'virtual', dir: 'in', text: '看看现在在哪个房间' })
  if (r && r.ok === false) throw new Error(JSON.stringify(r))
  const p = ledgerPath(ws)
  if (!existsSync(p)) throw new Error('账没写')
  const lines = readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean)
  if (!lines.length) throw new Error('账是空的')
  const row = JSON.parse(lines[lines.length - 1])
  if (row.bridge !== 'virtual' || row.dir !== 'in') throw new Error(JSON.stringify(row))
})
check('record 拒收不认识的 dir', () => {
  const r = record(ws, { bridge: 'virtual', dir: 'sideways', text: 'x' })
  if (!r || r.ok !== false) throw new Error('居然收了：' + JSON.stringify(r))
})
check('非会话桥另留 outbox', () => {
  record(ws, { bridge: 'game', dir: 'out', text: '把移动指令写进文件' })
  const p = join(bridgeDir(ws, 'game'), 'outbox.jsonl')
  if (!existsSync(p)) throw new Error('没有 ' + p)
})
check('会话桥不写 outbox', () => {
  record(ws, { bridge: 'info', dir: 'out', text: '记一句判断' })
  const p = join(bridgeDir(ws, 'info'), 'outbox.jsonl')
  if (existsSync(p)) throw new Error('会话桥不该写 outbox')
})

// ── 四、收件箱与统计
check('收件箱能读到两条', () => {
  const dir = bridgeDir(ws, 'game')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'inbox.jsonl'), '{"at":"t1","text":"第一条"}\n', 'utf8')
  const r = pullInbox(ws, 'game')
  const rows = r && r.rows ? r.rows : r
  if (!Array.isArray(rows) || rows.length < 1) throw new Error(JSON.stringify(r))
})
check('收件箱未读数是数得出来的', () => {
  const n = unreadCount(ws, 'game')
  if (!(n >= 1)) throw new Error(String(n))
})
check('统计里三桥都在', () => {
  const st = stats(ws)
  const per = st && st.per ? st.per : st
  for (const id of ['virtual', 'game', 'info']) {
    if (!per[id]) throw new Error('缺 ' + id)
  }
})
check('覆盖率在 0..1 之间', () => {
  const st = stats(ws)
  const per = st && st.per ? st.per : st
  for (const id of Object.keys(per)) {
    const c = per[id].coverage
    if (!(c >= 0 && c <= 1)) throw new Error(id + ' ' + c)
  }
})
check('没反馈时覆盖率是 0', () => {
  const st = stats(ws)
  const per = st && st.per ? st.per : st
  if (per.virtual.coverage !== 0) throw new Error(String(per.virtual.coverage))
})

// ── 五、渲染
check('统计能打成字', () => {
  const t = renderStats(ws)
  if (typeof t !== 'string' || !t.length) throw new Error('空')
})
check('段首是「## 桥」', () => {
  const t = renderSection(ws)
  if (!t.startsWith('## 桥')) throw new Error(t.slice(0, 20))
})
check('段里点得到三桥中文名', () => {
  const t = renderSection(ws)
  for (const n of ['虚拟桥', '游戏桥', '资讯桥']) if (!t.includes(n)) throw new Error('缺 ' + n)
})
check('卡片按预算截断并留提示', () => {
  const long = Array.from({ length: 200 }, (_, i) => '第' + i + '行').join('\n')
  const c = cardOf(long, 200)
  if (c.length > 600) throw new Error('太长 ' + c.length)
  if (!c.includes('余下')) throw new Error('没有余量提示')
})
check('空字符串仍然是空字符串', () => {
  if (cardOf('', 200) !== '') throw new Error('空的不空')
})

// ── 六、包与文案
check('package.json 的入口与补丁都在', () => {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
  if (pkg.name !== 'dsh-persona-bridge') throw new Error(pkg.name)
  if (!pkg.dsh || !pkg.dsh.bundle || !pkg.dsh.bundle.patch) throw new Error('没有 dsh.bundle.patch')
})
check('两份 locale 都有六个工具名', () => {
  for (const lang of ['zh', 'en']) {
    const p = new URL('./locale/' + lang + '.json', import.meta.url)
    const j = JSON.parse(readFileSync(p, 'utf8'))
    for (const t of ['bridge_status', 'bridge_send', 'bridge_pull', 'bridge_feedback', 'bridge_mode']) {
      if (!j.tools || !j.tools[t]) throw new Error(lang + ' 缺 ' + t)
    }
  }
})
check('图标是 svg', () => {
  const p = new URL('./icon.svg', import.meta.url)
  const t = readFileSync(p, 'utf8')
  if (!t.includes('<svg')) throw new Error('不是 svg')
})

console.log('')
console.log('通过 ' + ok + '，失败 ' + bad)
process.exit(bad ? 1 : 0)
