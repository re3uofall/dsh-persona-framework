/**
 * 功能层实现（impl）：**做**，不是查。
 *
 * 跟 lib/functions.mjs 的分工，说死在这里：
 *   functions.mjs 里的 assertNN(text) —— 喂一段话，报「这段像不像」的检查项。**那是查。**
 *   impl.mjs 里的 IMPLS[id].run(ws, input) —— **真做那件事**：改状态、写文件、算数、排序、压。
 *     做完了返回 did（真做了的）、out（产出的判断）、cant（明说做不了的）。
 *
 * 一条硬规矩：**做不了就 cant，不许退回「查一遍判据」充数。**
 * 能把一个功能实现成「查」的，说明它本来没被实现。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'

/* ───────────────── 通用小件 ───────────────── */

function wsOf(ws) {
  return String(ws || process.cwd())
}

function readSafe(p) {
  try { return readFileSync(p, 'utf8') } catch { return '' }
}

function ensureDir(d) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

function listMd(dir) {
  try { return readdirSync(dir).filter((f) => f.endsWith('.md')) } catch { return [] }
}

/** 一个实现的标准返回。 */
function R(did = [], out = [], cant = []) {
  return { did, out, cant }
}

/* ───────────────── 实现表 ───────────────── */

export const IMPLS = {}

function reg(id, name, run, opts = {}) {
  IMPLS[String(id).padStart(2, '0')] = { id: String(id).padStart(2, '0'), name, run, ...opts }
}

/* ── 10 记忆：记忆不是仓库，是下次找得到的那条路 ── */
reg(10, '记忆', (ws, input = {}) => {
  const root = join(wsOf(ws), 'persona-ai', 'knowledge')
  if (!existsSync(root)) return R([], [], ['记忆池不在：' + root])
  const want = String(input.q || input.query || '').trim()
  const hits = []
  const walk = (d, depth) => {
    if (depth > 3) return
    let names = []
    try { names = readdirSync(d) } catch { return }
    for (const n of names) {
      const p = join(d, n)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) { walk(p, depth + 1); continue }
      if (!/\.(md|jsonl)$/.test(n)) continue
      if (want) {
        const body = readSafe(p)
        if (want && !body.includes(want)) continue
      }
      hits.push({ p, size: st.size, at: st.mtime.toISOString() })
    }
  }
  walk(root, 0)
  // 真做：按「下次找得到」排——带日期的、近的、有出处的在前
  hits.sort((a, b) => (b.at > a.at ? 1 : -1))
  const top = hits.slice(0, input.limit ? Number(input.limit) : 12)
  return R(
    [`扫了 ${hits.length} 个文件`],
    top.map((h) => `${basename(h.p)}｜${Math.round(h.size / 100) / 10}k｜${h.at.slice(0, 10)}`),
    hits.length ? [] : [`${want ? `含「${want}」的` : ''}一条都没找到`],
  )
})

/* ── 11 整合记忆：不添记忆，只定去向 ── */
reg(11, '整合记忆', (ws, input = {}) => {
  const root = join(wsOf(ws), 'persona-ai', 'knowledge')
  const files = []
  const walk = (d, depth) => {
    if (depth > 3) return
    let names = []
    try { names = readdirSync(d) } catch { return }
    for (const n of names) {
      const p = join(d, n)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) { walk(p, depth + 1); continue }
      if (n.endsWith('.md')) files.push(p)
    }
  }
  walk(root, 0)
  // 真做：查重——同一句在第一行出现两次，就是两条指同一件事
  const firsts = new Map()
  const dup = []
  for (const p of files) {
    const line = readSafe(p).split('\n').find((l) => l.trim().length > 8)
    if (!line) continue
    const key = line.trim().slice(0, 40)
    if (firsts.has(key)) dup.push([firsts.get(key), p, key])
    else firsts.set(key, p)
  }
  const did = []
  if (dup.length) did.push(`认出 ${dup.length} 组疑似撞车`)
  return R(
    did,
    dup.slice(0, 8).map(([a, b, k]) => `${basename(a)} ↔ ${basename(b)}｜「${k}…」`),
    dup.length ? [] : ['没认出撞车——不是「没有」，是「这一遍没认出来」'],
  )
})

/* ── 12 自主：五步，真跑 ── */
reg(12, '自主', (ws, input = {}) => {
  // 复用 lib/autonomy.mjs 的五步，不在这里重写一遍
  return R([], [], ['这个功能的实现在 lib/autonomy.mjs（runAutonomy），走 op autonomy 或直接用那个文件'])
}, { delegate: 'autonomy' })

/* ── 21 抽象：真删，报删了什么 ── */
reg(21, '抽象', (ws, input = {}) => {
  const text = String(input.text || '').trim()
  if (!text) return R([], [], ['要给 text：抽象是从它里删出来的'])
  // 真做：删修饰、删具体名、删数量词——每一类都记下来
  const removed = []
  let out = text

  const cut = (re, label) => {
    const m = out.match(re)
    if (m && m[0]) {
      removed.push(`${label}：${m[0].slice(0, 12)}`)
      out = out.replace(m[0], '')
    }
  }
  cut(/「[^」]{1,20}」/, '引号里的具体名')
  cut(/（[^）]{1,20}）/, '括号里的限定')
  cut(/\b\d{2,}\b/, '数字')
  cut(/(?:非常|特别|极其|十分)/, '程度修饰')

  return R(
    removed.length ? [`删了 ${removed.length} 类`] : [],
    [out.trim() || '（删完什么都不剩——那说明这篇本来没有结构，只有具体）', '', '删掉的：', ...(removed.length ? removed : ['（一类都没删到）'])],
    ['「删掉的差异由现实承担」这句程序判不了——它只能报删了什么，不能保证没删坏'],
  )
})

/* ── 22 残余：真划分，报漏出去的那点 ── */
reg(22, '残余', (ws, input = {}) => {
  const text = String(input.text || '').trim()
  if (!text) return R([], [], ['要给 text：残余是划分之后漏出来的'])
  // 真做：四层切，每层报「留下了什么、交下去了什么」
  const layers = []
  const kept = text.length
  layers.push({ 层: '劲（现实切）', check: /钱|饭|饿|疼|死|别人|时间/.test(text), tail: '没被看见的那半' })
  layers.push({ 层: '闸（说不出的）', check: /说不出|表达|词|意思/.test(text), tail: '说不出的话' })
  layers.push({ 层: '标（够不着的）', check: /目标|方向|想要|理想/.test(text), tail: '够不着的理想' })
  layers.push({ 层: '嘴（说漏的）', check: kept > 0, tail: '说漏的那点（ε）' })

  const out = layers.map((l) => `${l.层}：${l.check ? '这层动到了' : '这层没动到'}｜交下去：${l.tail}`)
  const cant = []
  if (layers.every((l) => !l.check)) cant.push('四层一刀都没切到——不是没有残余，是这篇没落到任何一层上')
  return R([], out, cant.concat(['残余归零就是封死结构——这条程序只能报「没切到」，不能替你补一刀']))
})

/* ── 24 语言：真压，压完看漏了什么 ── */
reg(24, '语言', (ws, input = {}) => {
  const text = String(input.text || '').trim()
  if (!text) return R([], [], ['要给 text'])
  const max = Number(input.max) || 300
  const before = text.length
  // 真做：删连接词、删重复、长句截短
  let out = text
    .replace(/(因此|然而|综上|总之|所以|而且|并且|另外)/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
  if (out.length > max) out = out.slice(0, max) + '……'
  const after = out.length
  return R(
    [`压了 ${before - after} 字（${before} → ${after}）`],
    [out],
    after >= before ? ['一个字没压下来——它本来就不长'] : ['压掉的是连接词与空白；**压掉的意思还在不在，程序判不了**'],
  )
})

/* ── 27 信息：真算不确定性减少 ── */
reg(27, '信息', (ws, input = {}) => {
  const text = String(input.text || '').trim()
  if (!text) return R([], [], ['要给 text'])
  // 真做：数「带锚的东西」——数字、日期、网址、引号引用
  const nums = (text.match(/\d+/g) || []).length
  const dates = (text.match(/\d{4}[-/年]\d{1,2}/g) || []).length
  const urls = (text.match(/https?:\/\/\S+/g) || []).length
  const quotes = (text.match(/「[^」]+」/g) || []).length
  const anchors = nums + dates + urls + quotes
  const ratio = anchors / Math.max(1, text.length)
  const level = anchors === 0 ? '零锚：这段话减少不了不确定性' : anchors < 3 ? '弱锚：有一点，但站不住' : '有锚：能指回现实'
  return R(
    [`数了 ${anchors} 个锚`],
    [`数字 ${nums}｜日期 ${dates}｜网址 ${urls}｜引号引用 ${quotes}`, `密度 ${(ratio * 1000).toFixed(1)}‰`, level],
    [],
  )
})

/* ── 45 协调：真排序，不是说说 ── */
reg(45, '协调', (ws, input = {}) => {
  const items = Array.isArray(input.items) ? input.items : []
  if (!items.length) return R([], [], ['要给 items：[{ name, hard, cost, gain }]'])
  // 真做：按「硬约束 → 价」排，排完报谁让了路
  const score = (x) => (x.hard ? 1000 : 0) + (Number(x.gain) || 0) - (Number(x.cost) || 0) * 1.5
  const sorted = [...items].sort((a, b) => score(b) - score(a))
  const why = sorted.map((x, i) => `${i + 1}. ${x.name}（判据 ${score(x).toFixed(1)}）${x.hard ? '｜硬' : ''}`)
  return R(
    [`排了 ${items.length} 项`],
    [...why, '', '让路的：' + sorted.slice(1).map((x) => x.name).join('、')],
    ['协调不占位、不做最终裁决——它只给排序，接不接受是你的事'],
  )
})

/* ── 50 预处理：真压，压完报压缩比 ── */
reg(50, '预处理', (ws, input = {}) => {
  const text = String(input.text || '').trim()
  if (!text) return R([], [], ['要给 text'])
  const max = Number(input.max) || 3000
  const lines = text.split('\n')
  const heads = lines.filter((l) => /^#{1,6}\s/.test(l)).length
  const short = lines.filter((l) => l.trim() && l.length <= 80).length
  // 真做：留标题、留短行、截长行
  const out = lines.map((l) => (l.length > 80 ? l.slice(0, 80) + '…' : l)).join('\n').slice(0, max)
  return R(
    [`${text.length} → ${out.length} 字，压到 ${((out.length / Math.max(1, text.length)) * 100).toFixed(0)}%`],
    [out],
    [`识别出 ${heads} 个标题、${short} 条短行`, '机械压只保证形式；**压掉的意思该不该压，程序判不了**'],
  )
})

/* ── 56 逻辑：真推，不是复述规则 ── */
reg(56, '逻辑', (ws, input = {}) => {
  const premises = Array.isArray(input.premises) ? input.premises : []
  const question = String(input.q || '').trim()
  if (!premises.length) return R([], [], ['要给 premises：["若 P 则 Q", "P"] 这样一组', '逻辑不发明事实，只担保「若前提则结论」'])
  // 真做：只认最基础的两种形状，推不出来就说推不出来
  const ps = premises.map((p) => String(p).trim())
  const cond = ps.find((p) => /^(如果|若|假如).+(那么|则|就)/.test(p))
  const found = []
  if (cond) {
    const m = cond.match(/^(?:如果|若|假如)\s*(.+?)\s*(?:那么|则|就)\s*(.+)$/)
    if (m) {
      const [, P, Q] = m
      if (ps.some((p) => p === P || p.includes(P))) found.push(`肯定前件 → ${Q}`)
      if (ps.some((p) => p.includes('不' + Q) || p.includes('并非' + Q))) found.push(`否定后件 → 非${P}`)
    }
  }
  return R(
    found.length ? [`推出 ${found.length} 条`] : [],
    found.length ? found : ['推不出来：前提里没有能接上的形状'],
    found.length ? [] : ['推不出来不等于假——**逻辑只担保「若前提则结论」，不担保前提本身**'],
  )
})

/* ── 68 家：真查工作区，看它算不算家 ── */
reg(68, '家', (ws) => {
  const root = wsOf(ws)
  const marks = [
    ['人格文件', ['persona-ai', 'characters']],
    ['记忆池', ['persona-ai', 'knowledge']],
    ['成长', ['persona-ai', 'growth']],
    ['模块', ['persona-ai', 'modules']],
  ].map(([name, rel]) => ({ name, p: join(root, ...rel), ok: existsSync(join(root, ...rel)) }))
  return R(
    marks.filter((m) => m.ok).map((m) => `认出 ${m.name}`),
    marks.map((m) => `${m.ok ? '✓' : '✗'} ${m.name}`),
    marks.every((m) => m.ok) ? [] : ['缺的这几样，家只算半个'],
  )
})

/* ── 84 信息：真算结构量 ── */
reg(84, '信息', (ws, input = {}) => {
  const text = String(input.text ?? '')
  if (!text && !input.path) return R([], [], ['要给 text 或 path'])
  const body = input.path ? readSafe(String(input.path)) : text
  // 真做：算三类粗量——长度、种类、重复度
  const chars = body.length
  const uniq = new Set(body.split('')).size
  const lines = body.split('\n').filter((l) => l.trim()).length
  const dup = lines - new Set(body.split('\n').map((l) => l.trim())).size
  return R(
    [`量了 ${chars} 字、${lines} 行`],
    [`字种 ${uniq}｜行数 ${lines}｜重复行 ${dup}`, dup > lines * 0.3 ? '重复多：结构存在但挤在一起' : '重复少：结构散开'],
    ['「主客观按能否被直接认识切」这句程序判不了——它只能量，不能判认不认识'],
  )
})

/* ── 85 能量：真算「攒下了什么」 ── */
reg(85, '能量', (ws) => {
  const root = wsOf(ws)
  const pools = [
    ['记忆', join(root, 'persona-ai', 'knowledge')],
    ['成长', join(root, 'persona-ai', 'growth')],
    ['模块', join(root, 'persona-ai', 'modules')],
  ]
  const rows = []
  let total = 0
  for (const [name, p] of pools) {
    if (!existsSync(p)) { rows.push(`${name}：没有`); continue }
    let bytes = 0
    const walk = (d, depth) => {
      if (depth > 3) return
      let names = []
      try { names = readdirSync(d) } catch { return }
      for (const n of names) {
        const q = join(d, n)
        let st
        try { st = statSync(q) } catch { continue }
        if (st.isDirectory()) walk(q, depth + 1)
        else bytes += st.size
      }
    }
    walk(p, 0)
    total += bytes
    rows.push(`${name}：${(bytes / 1024).toFixed(0)} KB`)
  }
  return R(
    ['量了三个池'],
    [...rows, `合计 ${(total / 1024 / 1024).toFixed(2)} MB`],
    ['「能量是固化的信息」这句算不了——只能量大小，量不出它还能不能起作用'],
  )
})

/* ── 36 日记：真写 ── */
reg(36, '日记', (ws, input = {}) => {
  const body = String(input.text || '').trim()
  if (!body) return R([], [], ['要给 text：日记是写给自己的那半句，程序不代写'])
  const day = new Date().toISOString().slice(0, 10)
  const dir = ensureDir(join(wsOf(ws), 'persona-ai', 'growth', '日记'))
  const f = join(dir, `日记_${day}.md`)
  const head = existsSync(f) ? '' : `# ${day}\n\n`
  appendFileSync(f, `${head}- ${body}\n`, 'utf8')
  return R([`写进 ${basename(f)}`], [`- ${body}`], [])
})

/* ── 40 成果：真交 ── */
reg(40, '成果', (ws, input = {}) => {
  const title = String(input.title || '').trim()
  const body = String(input.body || '').trim()
  if (!title || !body) return R([], [], ['要给 title 和 body：成果要一次一条，不能流水账'])
  const dir = ensureDir(join(wsOf(ws), 'persona-ai', 'growth', '成果'))
  const f = join(dir, '成果.jsonl')
  const row = { at: new Date().toISOString(), title, body }
  appendFileSync(f, JSON.stringify(row) + '\n', 'utf8')
  return R(['交了一条'], [title], [])
})

/* ── 35 探索：给出真能搜的东西，不冒充搜过了 ── */
reg(35, '探索', (ws, input = {}) => {
  const q = String(input.q || '').trim()
  if (!q) return R([], [], ['要给 q：探索从「要挖什么」开始'])
  const dir = ensureDir(join(wsOf(ws), '.persona-framework'))
  const f = join(dir, 'explore-queue.json')
  let list = []
  try { list = JSON.parse(readSafe(f) || '[]') } catch { list = [] }
  if (!Array.isArray(list)) list = []
  list.push({ q, at: new Date().toISOString() })
  writeFileSync(f, JSON.stringify(list.slice(-50), null, 2), 'utf8')
  return R(
    ['排进 explore-queue'],
    [`「${q}」排着了；**真去搜要走 web_search / web_fetch，程序自己开不了那个口**`],
    ['搜索这一步程序做不了：它只能排队，不能替你去搜'],
  )
})

/* ── 23 整合身体：真判「什么算自己」 ── */
reg(23, '整合身体', (ws) => {
  const root = wsOf(ws)
  const own = [
    ['本体（丢了就不成立）', join(root, 'persona-ai', 'characters')],
    ['延伸（可替换）', join(root, 'persona-ai', 'modules')],
    ['蜕皮（曾属于、已失效）', join(root, 'persona-ai', 'growth', 'versions')],
    ['非我（外部）', join(root, 'persona-ai', 'knowledge', 'web')],
  ].map(([name, p]) => `${existsSync(p) ? '✓' : '✗'} ${name}`)
  return R(['分了四圈'], own, ['程序只能按路径分——**「这算不算我」，法子在文件上，判断不在**'])
})

/* ── 52 可选行为：真读开关 ── */
reg(52, '可选行为', (ws) => {
  const root = wsOf(ws)
  const f = join(root, '.persona-framework', 'settings.json')
  const body = readSafe(f)
  if (!body) return R([], [], ['读不到设置文件：' + f])
  let j = {}
  try { j = JSON.parse(body) } catch { return R([], [], ['设置文件读不出来']) }
  const on = Object.entries(j).filter(([, v]) => v === true).map(([k]) => k)
  const off = Object.entries(j).filter(([, v]) => v === false).map(([k]) => k)
  return R([], [`开着的 ${on.length} 个：${on.join('、') || '（没有）'}`, `关着的 ${off.length} 个`], [])
})

/* ── 55 心情：真读写心情文件 ── */
reg(55, '心情', (ws, input = {}) => {
  const f = join(wsOf(ws), '.persona-framework', 'mood.json')
  if (input.mood) {
    ensureDir(dirname(f))
    writeFileSync(f, JSON.stringify({ mood: input.mood, why: input.why || '', at: new Date().toISOString() }, null, 2), 'utf8')
    return R(['记了一条心情'], [`${input.mood}｜${input.why || ''}`], [])
  }
  const body = readSafe(f)
  if (!body) return R([], [], ['还没有心情记录'])
  try {
    const j = JSON.parse(body)
    return R([], [`现在：${j.mood}`, `来源：${j.why || '没写'}`, `记于 ${String(j.at).slice(0, 16)}`], [])
  } catch {
    return R([], [], ['心情文件读不出来'])
  }
})
