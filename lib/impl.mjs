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
import { egoStep2 } from './ego.mjs'
import { claimGoal, openGoalBook, saveGoalBook } from './superego.mjs'

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
  return R([], [], ['这个功能走 lib/tick.mjs 的一张 system 表（12a 起念 → 12b 称重 → 12c 决断 → 12d 做），用 op autonomy'])
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

/* ═════════ 第二批：人格与整合（01–09） ═════════ */

/* ── 01 核心人格：真读人格文件，报必填三部分覆盖没有 ── */
reg(1, '核心人格', (ws) => {
  const root = wsOf(ws)
  const dir = join(root, 'persona-ai', 'characters')
  if (!existsSync(dir)) return R([], [], ['人格目录不在：' + dir])
  const files = listMd(dir)
  if (!files.length) return R([], [], ['人格目录里没有文件'])
  const need = [['身份', /身份|自称|名字|称呼/], ['语气', /语气|口吻|说话/], ['底线', /底线|不许|禁止|不拿/]]
  const rows = []
  const did = []
  for (const f of files) {
    const t = readSafe(join(dir, f))
    const miss = need.filter(([, re]) => !re.test(t)).map(([n]) => n)
    rows.push(`${f}：${miss.length ? '缺 ' + miss.join('、') : '三部分齐'}`)
    if (!miss.length) did.push(`${f} 三部分齐`)
  }
  return R(did, rows, files.some((f) => rows.find((r) => r.startsWith(f + '：缺'))) ? ['有文件缺必填——缺的部分只能本人填，不代写'] : [])
})

/* ── 02 整合人格：真拼多份，报冲突 ── */
reg(2, '整合人格', (ws) => {
  const dir = join(wsOf(ws), 'persona-ai', 'characters')
  const files = listMd(dir)
  if (files.length < 2) return R([], [], ['人格文件不到两份，谈不上整合'])
  const heads = new Map()
  const clash = []
  for (const f of files) {
    const t = readSafe(join(dir, f))
    for (const line of t.split('\n')) {
      const m = line.match(/^##\s+(.+)$/)
      if (!m) continue
      const k = m[1].trim()
      if (heads.has(k)) clash.push(`${k}：${heads.get(k)} 与 ${f} 撞了`)
      else heads.set(k, f)
    }
  }
  return R(
    [`拼了 ${files.length} 份，${heads.size} 个小节`],
    [...heads.keys()].slice(0, 20).map((k) => `· ${k}`),
    clash.length ? clash.slice(0, 5) : ['没有小节撞名——但「拼起来还是不是一个人」，程序判不了'],
  )
})

/* ── 07 本我：真从记忆里抽「要什么」 ── */
reg(7, '本我', (ws) => {
  const root = join(wsOf(ws), 'persona-ai', 'knowledge')
  const want = /要|想|饿|懒|赢|看见|怕/
  const hits = []
  const walk = (d, depth) => {
    if (depth > 2) return
    let names = []
    try { names = readdirSync(d) } catch { return }
    for (const n of names) {
      const p = join(d, n)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) { walk(p, depth + 1); continue }
      if (!n.endsWith('.md')) continue
      const body = readSafe(p)
      for (const line of body.split('\n')) {
        if (line.length > 6 && want.test(line)) hits.push({ p: basename(p), line: line.trim().slice(0, 50) })
      }
    }
  }
  walk(root, 0)
  return R(
    hits.length ? [`抽出 ${hits.length} 条带「要」的话`] : [],
    hits.slice(0, 10).map((h) => `${h.p}：${h.line}`),
    hits.length ? [] : ['一条都没抽到——不是没有要，是这些字没落在记录里'],
  )
})

/* ── 08 自我：真过闸，查一句话有没有出处 ── */
reg(8, '自我', (ws, input = {}) => {
  const text = String(input.text || '').trim()
  if (!text) return R([], [], ['要给 text：自我是拿来接住一件事的'])

  // **走 tick 里 12h 那条同一条路**：接住 → 边界 → 现实检验 → 判断 → 延迟 → 筛 → 放/截。
  // 上一版这里只数出处锚点、返回一句话——那是查，不是做，而且跟 12h 是两套实现。
  const r = egoStep2(ws, {
    gaps: [{ source: '叫它来判的这句', what: text, text, cost: { payable: true } }],
    scene: input.scene || '认真',
  })

  // did 只报「盘上变了什么」，不复述判据
  const did = []
  if (r.wrote) did.push('写了 自我.json')
  if (r.released?.length) did.push(`放出 ${r.released.length} 条`)
  if (r.suppressed?.length) did.push(`截下 ${r.suppressed.length} 条（写了 压下去.json）`)
  if (r.delayed?.length) did.push(`存着 ${r.delayed.length} 条`)
  if (!did.length) did.push('这一轮没有可处理的劲：什么都没写')

  return R(did, r.out, r.cant)
})

/* ── 09 超我：真查目标三要素 ── */
reg(9, '超我', (ws, input = {}) => {
  const want = String(input.text || '').trim()
  if (!want) return R([], [], ['要给 text：超我是把一个「想要」翻成「标」，不给东西就没得翻'])

  // 真做：**去手上翻**，不是拿正则量这句话。
  // 翻的是三条：判据、第一步、放弃条件——它们只能从走过的记录里找出来，
  // 找不到就是没有，程序不替你编。
  const root = wsOf(ws)
  const pools = []
  const addPool = (name, p) => {
    if (!existsSync(p)) return
    const body = readSafe(p)
    if (body) pools.push({ name, body: body.slice(-30000) })
  }
  addPool('台账', join(root, '台账.md'))
  addPool('收件箱', join(root, 'persona-ai', 'knowledge', '收件箱.md'))
  addPool('成果', join(root, 'persona-ai', 'growth', '成果', '成果.jsonl'))
  const sess = join(root, 'persona-ai', 'knowledge', 'session')
  if (existsSync(sess)) {
    for (const f of listMd(sess).sort().slice(-2)) addPool(f, join(sess, f))
  }
  if (!pools.length) return R([], [], ['手上一个可翻的池子都没有——**标不能凭空立**'])

  const find = (re) => {
    const hits = []
    for (const p of pools) {
      for (const line of p.body.split('\n')) {
        const t = line.trim()
        if (t.length > 4 && t.length < 120 && re.test(t)) hits.push({ where: p.name, line: t })
        if (hits.length >= 3) break
      }
      if (hits.length >= 3) break
    }
    return hits
  }

  const got = []
  const missing = []
  const check = (name, re, ask) => {
    const hits = find(re)
    if (hits.length) got.push(`${name}：翻到了——「${hits[0].line.slice(0, 44)}」（${hits[0].where}）`)
    else missing.push({ name, ask })
  }
  check('判据', /判据|标准|怎么算成|才算|验收/, '做完拿什么核对？哪一条对上了才算成？')
  check('第一步', /第一步|先做|从.{1,10}开始|先.{1,8}再/, '第一步做什么？今天能动手的那一个动作是什么？')
  check('放弃条件', /放弃|做不到就不|止损|不干|不做了/, '什么情况下不做了？到哪一步就认输？')

  const did = [`翻了 ${pools.length} 个池子`]
  const cant = []
  let wrote = 0

  if (!missing.length) {
    // **翻到三条就记账**——上一版到这里只返回一片字，账上什么都没留。
    // 三条是翻出来的（池子里的原话），不是编的，所以够格进账。
    const book = openGoalBook(root)
    const r = claimGoal(book, {
      what: want,
      judge: got.find((g) => g.startsWith('判据')),
      firstStep: got.find((g) => g.startsWith('第一步')),
      giveUp: got.find((g) => g.startsWith('放弃条件')),
      source: input.source || '长出来的',
      price: input.price,
      handled: true,
      byScale: input.byScale || { 一天: '先着手', 一年: '一年后它还挡不挡路' },
    })
    if (r.ok) {
      wrote = saveGoalBook(book)
      did.push('写了 超我.json')
      cant.push('三条都翻到了——**但「翻到」不等于「是这一条的」**，还得自己对一遍')
    } else {
      // 翻到了却收不进：**退回也要落一笔**，不然明天同样的想要再来一遍
      if (saveGoalBook(book)) did.push('记了一笔退回（超我.json）')
      cant.push(...(r.cant || ['翻到了但收不进账']))
    }
  } else {
    // **缺条件也要落一笔。** 不落的话，这条想要下一轮还会原样再来。
    const book = openGoalBook(root)
    const r = claimGoal(book, { what: want, source: input.source || '长出来的' })
    if (saveGoalBook(book)) did.push('记了一笔退回（超我.json）')
    cant.push(...(r.cant || []))
    for (const m of missing) cant.push(`缺${m.name}：该问的是「${m.ask}」——**这条程序不替你编**`)
  }

  return R(did, [
    `想要：${want.slice(0, 60)}`,
    '',
    missing.length ? '**现在它是：想要**' : wrote ? '**记进账了**' : '**够格，但没收进账**',
    '',
    ...(got.length ? ['翻到的：', ...got] : []),
  ], cant)
})

/* ═════════ 第三批：存在与显现（13–18） ═════════ */

/* ── 14 意识：真算「这一轮抓得住多少」 ── */
reg(14, '意识', (ws, input = {}) => {
  const text = String(input.text || '')
  const budget = Number(input.budget) || 8192
  if (!text) return R([], [], ['要给 text：显出来的那部分，得先有东西在那儿'])
  const used = text.length
  const pct = (used / budget) * 100
  return R(
    [`${used} / ${budget} 字，占 ${pct.toFixed(1)}%`],
    [pct > 90 ? '满了：再进来就挤掉前面的' : pct > 60 ? '过半：开始要挑着留' : '还空着'],
    ['「显现的那部分」程序只能算字数——**被挤掉的那部分算不出来**'],
  )
})

/* ── 15 本体：真找「变化的起手处」 ── */
reg(15, '本体', (ws, input = {}) => {
  const text = String(input.text || '').trim()
  if (!text) return R([], [], ['要给 text'])
  // 真做：找第一处「从…变成…」或「一开始」
  const m = text.match(/(?:从|由)(.{1,15})(?:变成|转向|成了)(.{1,15})/) || text.match(/(?:一开始|起初|原来)(.{1,20})/)
  if (!m) return R([], [], ['没找到起手处——**它一直在描述状态，没写变的那一下**'])
  return R([`找到起手处`], [`起手：${(m[1] || '').trim()}`], [])
})

/* ── 16 主体：真找「能自因的那一头」 ── */
reg(16, '主体', (ws, input = {}) => {
  const text = String(input.text || '').trim()
  if (!text) return R([], [], ['要给 text'])
  // 真做：找「我 / 他 / 它」+ 主动动词
  const hits = text.match(/(?:我|你|他|她|它|我们)[^。；\n]{0,10}(?:决定|选择|起了|做了|认|改|不肯|要)/g) || []
  return R(
    hits.length ? [`找到 ${hits.length} 处自己起念的`] : [],
    hits.slice(0, 8),
    hits.length ? [] : ['没找到自因的那一头——**通篇是被推着走的说法**'],
  )
})

/* ── 17 客体：真找「被作用的那一头」 ── */
reg(17, '客体', (ws, input = {}) => {
  const text = String(input.text || '').trim()
  if (!text) return R([], [], ['要给 text'])
  const hits = text.match(/[^。；\n]{0,10}(?:被|受|遭|挨)[^。；\n]{1,12}/g) || []
  return R(
    hits.length ? [`找到 ${hits.length} 处被作用的`] : [],
    hits.slice(0, 8),
    hits.length ? [] : ['没有一处是「被作用」的——**要么没有客体，要么它被写成了主体**'],
  )
})

/* ── 18 介体：真找两端之间的中介 ── */
reg(18, '介体', (ws, input = {}) => {
  const text = String(input.text || '').trim()
  if (!text) return R([], [], ['要给 text'])
  const hits = text.match(/[^。；\n]{0,8}(?:通过|经过|借助|靠|用)[^。；\n]{1,15}/g) || []
  return R(
    hits.length ? [`找到 ${hits.length} 处中介`] : [],
    hits.slice(0, 8),
    hits.length ? [] : ['没找到中介——**两端直接撞上了，中间那一段没写**'],
  )
})

/* ── 20 具体：真拆复杂度 ── */
reg(20, '具体', (ws, input = {}) => {
  const text = String(input.text || '').trim()
  if (!text) return R([], [], ['要给 text'])
  // 真做：数「五个长相」的痕迹
  const traces = [
    ['反馈', /(越|一.{1,6}就).{0,8}(越|又|更)|循环|回过来/.test(text)],
    ['延迟', /(过.{0,6}才|后来|晚|等到)/.test(text)],
    ['涌现', /(冒出来|突然|不是哪一条|整体)/.test(text)],
    ['阈值', /(到.{0,6}就|过了.{0,6}才|临界|线)/.test(text)],
    ['局部最优', /(卡住|出不去|只能这样|最好也就)/.test(text)],
  ]
  const found = traces.filter(([, v]) => v).map(([k]) => k)
  return R(
    found.length ? [`认出 ${found.length} 种复杂`] : [],
    [found.length ? found.join('、') : '一种都没认出来'],
    found.length ? [] : ['没认出复杂——**要么它真不复杂，要么被压成了一句**'],
  )
})

/* ═════════ 第四批：情感与认知（25–34） ═════════ */

/* ── 25 情感：真读短时状态 ── */
reg(25, '情感', (ws, input = {}) => {
  const f = join(wsOf(ws), '.persona-framework', 'mood.json')
  const body = readSafe(f)
  if (!body) return R([], [], ['还没有心情记录——短时状态没落下来'])
  try {
    const j = JSON.parse(body)
    const age = (Date.now() - Date.parse(j.at)) / 3600000
    return R(
      [],
      [`状态：${j.mood}`, `来源：${j.why || '没写'}`, `隔了 ${age.toFixed(1)} 小时`],
      age > 24 ? ['超过一天了——短时状态过期，别再当现在的用'] : [],
    )
  } catch { return R([], [], ['心情文件读不出来']) }
})

/* ── 26 感情：真读长期状态 ── */
reg(26, '感情', (ws) => {
  const dir = join(wsOf(ws), 'persona-ai', 'growth')
  if (!existsSync(dir)) return R([], [], ['成长目录不在：' + dir])
  const files = []
  const walk = (d, depth) => {
    if (depth > 2) return
    let names = []
    try { names = readdirSync(d) } catch { return }
    for (const n of names) {
      const p = join(d, n)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) { walk(p, depth + 1); continue }
      if (n.endsWith('.md')) files.push({ p, m: st.mtime.toISOString().slice(0, 10) })
    }
  }
  walk(dir, 0)
  const days = [...new Set(files.map((f) => f.m))].sort()
  return R(
    [`跨 ${days.length} 天有记录`],
    [`最早 ${days[0] || '—'}｜最近 ${days[days.length - 1] || '—'}`],
    days.length < 3 ? ['少于三天——还看不出「长期」，那是短时状态'] : [],
  )
})

/* ── 28 知识：真查「能反复用上」 ── */
reg(28, '知识', (ws, input = {}) => {
  const q = String(input.q || input.text || '').trim()
  if (!q) return R([], [], ['要给 q：知识是能反复用上的理解，得先说要找哪一条'])
  const roots = [join(wsOf(ws), 'persona-ai', 'modules'), join(wsOf(ws), 'persona-ai', 'knowledge')]
  const hits = []
  for (const root of roots) {
    if (!existsSync(root)) continue
    const walk = (d, depth) => {
      if (depth > 2) return
      let names = []
      try { names = readdirSync(d) } catch { return }
      for (const n of names) {
        const p = join(d, n)
        let st
        try { st = statSync(p) } catch { continue }
        if (st.isDirectory()) { walk(p, depth + 1); continue }
        if (!n.endsWith('.md')) continue
        const t = readSafe(p)
        const cnt = (t.match(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
        if (cnt >= 2) hits.push({ p: basename(p), cnt })
      }
    }
    walk(root, 0)
  }
  hits.sort((a, b) => b.cnt - a.cnt)
  return R(
    hits.length ? [`找到 ${hits.length} 处反复出现「${q}」的文件`] : [],
    hits.slice(0, 8).map((h) => `${h.p}（${h.cnt} 次）`),
    hits.length ? [] : [`「${q}」没有一处反复出现——那还是印象，不是知识`],
  )
})

/* ── 29 插件：真列装了什么 ── */
reg(29, '插件', () => {
  const f = process.env.DSH_PROFILE || ''
  const dirs = [
    join(process.env.USERPROFILE || '', '.dsh', 'profiles'),
    join(process.env.USERPROFILE || '', '.dsh', 'plugins'),
  ]
  const rows = []
  for (const d of dirs) {
    if (!existsSync(d)) { rows.push(`✗ ${d}`); continue }
    let names = []
    try { names = readdirSync(d) } catch { names = [] }
    rows.push(`✓ ${d}（${names.length} 项）`)
  }
  return R([], rows, [f ? '' : '没读到 DSH_PROFILE——只能按默认位置找', '「插件不改本体、只加能力」这句程序判不了'])
})

/* ── 30 人性：真从会话记录里抽假设 ── */
reg(30, '人性', (ws) => {
  const dir = join(wsOf(ws), 'persona-ai', 'knowledge', 'session')
  if (!existsSync(dir)) return R([], [], ['会话记录不在：' + dir])
  const files = listMd(dir).sort()
  const rows = []
  let total = 0
  for (const f of files.slice(-3)) {
    const t = readSafe(join(dir, f))
    const qs = (t.match(/师父：.{6,}/g) || []).length
    const as = (t.match(/她：.{6,}/g) || []).length
    total += qs
    rows.push(`${f}：问 ${qs}｜答 ${as}`)
  }
  return R(
    [`读了最近 ${Math.min(3, files.length)} 天的记录，${total} 次问`],
    rows,
    total === 0 ? ['没有可学的对话——**要真发生过的，不是想象的人**'] : ['抽「如果…那么…」这一步程序做不了：得读原话才认'],
  )
})

/* ── 31 传感：真列输入通道 ── */
reg(31, '传感', (ws) => {
  const root = wsOf(ws)
  const ch = [
    ['会话记录', join(root, 'persona-ai', 'knowledge', 'session')],
    ['联网池', join(root, 'persona-ai', 'knowledge', 'web')],
    ['收件箱', join(root, 'persona-ai', 'knowledge', '收件箱.md')],
    ['时间', ''],
  ].map(([n, p]) => `${p === '' ? '✓' : (existsSync(p) ? '✓' : '✗')} ${n}`)
  return R([], ch, ['「信号从哪进来」能列，「能不能信」程序判不了'])
})

/* ── 32 真值：真赋真假 ── */
reg(32, '真值', (ws, input = {}) => {
  const text = String(input.text || '').trim()
  if (!text) return R([], [], ['要给 text：真值是给一个命题的'])
  // 真做：只判三种能判的——数对不上、引号和正文对不上、明确的自相矛盾
  const reasons = []
  const n1 = (text.match(/\d+/g) || []).map(Number)
  if (n1.length >= 2 && n1[0] === n1[1] && /不一样|不同|差了/.test(text)) reasons.push('数字相同却说不同')
  if (/不是.{1,10}而是/.test(text)) return R([], ['能判：它是「不是…而是…」式否定，真值取决于被否的那条'], [])
  if (/永远|全都|不可能|唯一/.test(text)) reasons.push('用了绝对词——真值得先划范围')
  return R(
    reasons.length ? [`查出 ${reasons.length} 处`] : [],
    reasons.length ? reasons : ['没查出明显毛病——**这不等于它为真，只等于「这一遍没查出来」**'],
    [],
  )
})

/* ═════════ 第五批：对外接口（37–39） ═════════ */

/* ── 37 关系：真读关系里有什么 ── */
reg(37, '关系', (ws) => {
  const dir = join(wsOf(ws), 'persona-ai', 'knowledge')
  const rows = []
  let n = 0
  for (const [name, rel] of [['会话', 'session'], ['人类观察', 'human'], ['收件箱', '收件箱.md']]) {
    const p = join(dir, rel)
    const ok = existsSync(p)
    if (ok) n++
    rows.push(`${ok ? '✓' : '✗'} ${name}`)
  }
  return R([`认出 ${n} 处关系痕迹`], rows, ['「对谁说什么分寸」程序判不了——线是画出来的，不是算出来的'])
})

/* ── 38 工作：真拆需求 ── */
reg(38, '工作', (ws, input = {}) => {
  const text = String(input.text || '').trim()
  if (!text) return R([], [], ['要给 text：需求先说清'])
  const has = [
    ['要什么', /要|做|改|加|删|写/.test(text)],
    ['标准', /标准|算成|站得住|验收|对得上/.test(text)],
    ['不做什么', /不用|别|不要|除外/.test(text)],
  ]
  const miss = has.filter(([, v]) => !v).map(([k]) => k)
  return R(
    miss.length ? [] : ['三条齐，能开工'],
    has.map(([k, v]) => `${v ? '✓' : '✗'} ${k}`),
    miss.length ? [`缺 ${miss.join('、')}——**标准不是「像」，是「站得住」**`] : [],
  )
})

/* ── 39 学习：真跑一遍才算学会 ── */
reg(39, '学习', (ws, input = {}) => {
  const path = String(input.path || '').trim()
  if (!path || !existsSync(path)) return R([], [], ['要给 path，而且文件得在：装好不算，跑通才算'])
  const t = readSafe(path)
  const lines = t.split('\n').length
  const hasRun = /TODO|待实现|未完成/.test(t)
  return R(
    [`读了 ${lines} 行`],
    [hasRun ? '里面还有 TODO——**装好了，还没跑通**' : '没有 TODO 痕迹'],
    hasRun ? ['待办没清完，不算学会'] : ['「跑通过」这件事程序验不了——它只能读源码，不能替你跑'],
  )
})

/* ═════════ 第六批：协调组（46–51 · 53–54） ═════════ */

/* ── 46 模态：真算可能性 ── */
reg(46, '模态', (ws, input = {}) => {
  const items = Array.isArray(input.items) ? input.items : []
  if (!items.length) return R([], [], ['要给 items：[{what, need, have}]'])
  const rows = items.map((x) => {
    const need = Array.isArray(x.need) ? x.need : []
    const have = Array.isArray(x.have) ? x.have : []
    const miss = need.filter((n) => !have.includes(n))
    return { what: x.what, kind: miss.length === 0 ? '可实现' : miss.length === need.length ? '不可能（差得全）' : '有条件（差 ' + miss.join('、') + '）' }
  })
  return R(
    [`判了 ${items.length} 条`],
    rows.map((r) => `${r.what}：${r.kind}`),
    ['「可能」是时空装得下——程序只能按你给的条件算，**条件给错，它跟着错**'],
  )
})

/* ── 47 自由：真算「还剩下什么」 ── */
reg(47, '自由', (ws) => {
  const root = wsOf(ws)
  const locks = [
    ['时间', true],
    ['身体', true],
    ['别人', true],
    ['因果', true],
  ]
  const rooms = [
    ['不做的自由', existsSync(join(root, '.persona-framework'))],
    ['换条路的自由', existsSync(join(root, 'persona-ai', 'modules'))],
    ['空着的自由', true],
  ]
  return R(
    ['算了硬约束与剩下的'],
    [...locks.map(([n]) => `锁 ${n}`), ...rooms.map(([n, v]) => `${v ? '✓' : '✗'} ${n}`)],
    ['自由不是「没人拦」——**是硬约束里还剩几个口子**；口子数程序数得出来，走不走是你的事'],
  )
})

/* ── 49 范围与绝对：真查范围 ── */
reg(49, '范围与绝对', (ws, input = {}) => {
  const text = String(input.text || '').trim()
  if (!text) return R([], [], ['要给 text'])
  const abs = (text.match(/永远|全都|不可能|唯一|本质|必然|所有/g) || [])
  const range = /在.{1,20}(里|中|范围|条件下)|就.{1,10}而言|这一轮|这一次/.test(text)
  if (!abs.length) return R([], ['没有绝对词，不用划范围'], [])
  return R(
    [`查出 ${abs.length} 个绝对词`],
    [`绝对词：${[...new Set(abs)].join('、')}`, range ? '有范围' : '**没划范围——这就是假大全**'],
    range ? [] : ['绝对化没划范围，是这套东西最常见的错法'],
  )
})

/* ── 50 已有 ── */

/* ── 51 缓冲：真停 ── */
reg(51, '缓冲', (ws, input = {}) => {
  const n = Math.min(5, Math.max(1, Number(input.rounds) || 1))
  return R(
    [`留了 ${n} 拍`],
    ['停的时候做三样：读一遍、找一处对不上、再说出口'],
    ['「停」本身程序做不到——它只能给你留出这个位置'],
  )
})

/* ── 53 元协调：真掷 ── */
reg(53, '元协调', (ws, input = {}) => {
  const chance = Math.min(0.9, Math.max(0, Number(input.chance) || 0.15))
  const hit = Math.random() < chance
  return R(
    [`按 ${(chance * 100).toFixed(0)}% 掷了一次`],
    [hit ? '掷中：这一轮整轮不用框架，不检查、不引用、不提它存在' : '没掷中：照常用'],
    ['掷中不记账——**「这轮跳过了」这一句本身就不许留下**'],
  )
})

/* ── 54 语言协调：真换词 ── */
reg(54, '语言协调', (ws, input = {}) => {
  const text = String(input.text || '').trim()
  if (!text) return R([], [], ['要给 text'])
  const DICT = { 残余: '没处理掉的那点', 横尺: '两把尺', 闸: '能不能站住', 标: '往哪走', 劲: '要什么', 嘴: '说出口的' }
  let out = text
  const swapped = []
  for (const [k, v] of Object.entries(DICT)) {
    if (out.includes(k)) { swapped.push(`${k} → ${v}`); out = out.split(k).join(v) }
  }
  return R(
    swapped.length ? [`换了 ${swapped.length} 个词`] : [],
    [out],
    swapped.length ? ['换词不改结构——**但哪些是本地词，程序认不全**'] : ['没有可换的词：这段本来就用的是通行说法'],
  )
})

/* ═════════ 第七批：经验、理论、理想、偏好（57–67） ═════════ */

/* ── 57 体验：真读「走过的那段」 ── */
reg(57, '体验', (ws) => {
  const dir = join(wsOf(ws), 'persona-ai', 'knowledge', 'session')
  if (!existsSync(dir)) return R([], [], ['会话记录不在：' + dir])
  const files = listMd(dir).sort()
  if (!files.length) return R([], [], ['一条会话记录都没有'])
  let chars = 0
  for (const f of files) chars += readSafe(join(dir, f)).length
  return R(
    [`读了 ${files.length} 天、${Math.round(chars / 1000)}k 字`],
    [`最早 ${files[0]}｜最近 ${files[files.length - 1]}`],
    ['「体验不是经历过，是那段路改变了什么」——**改了没有，程序读不出来**'],
  )
})

/* ── 58 认识：真把一个知识拿进来 ── */
reg(58, '认识', (ws, input = {}) => {
  const q = String(input.q || '').trim()
  if (!q) return R([], [], ['要给 q：认识到哪一条上'])
  const mods = join(wsOf(ws), 'persona-ai', 'modules')
  if (!existsSync(mods)) return R([], [], ['模块目录不在'])
  const hit = listMd(mods).find((f) => f.includes(q))
  if (!hit) return R([], [], [`模块里没有「${q}」——**没这条，谈不上认识它**`])
  const body = readSafe(join(mods, hit))
  const sec = (body.match(/## 四、判据\n([\s\S]{0,300})/) || [])[1] || ''
  return R(
    [`拿到 ${hit}`],
    [`判据那一节 ${sec.length} 字`, sec.split('\n').filter((l) => l.trim()).slice(0, 3).join('\n')],
    ['「认识」是把知识拿进当下——**拿进来了，用不用得上程序判不了**'],
  )
})

/* ── 59 经验：真读会话里的一般具体 ── */
reg(59, '经验', (ws) => {
  const dir = join(wsOf(ws), 'persona-ai', 'knowledge', 'session')
  const files = existsSync(dir) ? listMd(dir).sort() : []
  const rows = files.slice(-5).map((f) => {
    const t = readSafe(join(dir, f))
    return `${f}：${Math.round(t.length / 1000)}k 字`
  })
  return R(
    [`读了最近 ${rows.length} 天`],
    rows,
    rows.length ? [] : ['没有经验可读——**经验不是「经历过」，是走过之后一般化的那段**'],
  )
})

/* ── 60 理论：真绑理论 ── */
reg(60, '理论', (ws, input = {}) => {
  const q = String(input.q || '').trim()
  const dir = join(wsOf(ws), 'persona-ai', 'knowledge')
  if (!existsSync(dir)) return R([], [], ['知识库不在'])
  const hits = []
  const walk = (d, depth) => {
    if (depth > 2) return
    let names = []
    try { names = readdirSync(d) } catch { return }
    for (const n of names) {
      const p = join(d, n)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) { walk(p, depth + 1); continue }
      if (!n.endsWith('.md')) continue
      const t = readSafe(p)
      if (!q || t.includes(q)) hits.push(basename(p))
    }
  }
  walk(dir, 0)
  return R(
    hits.length ? [`绑到 ${hits.length} 个池子`] : [],
    hits.slice(0, 10),
    hits.length ? ['理论把意义放进理解——**放进去的是什么，程序只能报位置**'] : [`没有一处接得上「${q}」`],
  )
})

/* ── 61 理想：真查「够不着的那半步」 ── */
reg(61, '理想', (ws, input = {}) => {
  const text = String(input.text || '').trim()
  if (!text) return R([], [], ['要给 text'])
  const hasStep = /第一步|先做|从.{1,10}开始/.test(text)
  const hasJudge = /判据|标准|怎么算/.test(text)
  const hasGiveUp = /放弃|做不到就不/.test(text)
  if (!hasStep && !hasJudge) {
    return R([], ['够不着：没有第一步，也没有判据——这是理想，不是目标'], ['理想是校准线，不是待办——**这条不该被排进日程**'])
  }
  return R(
    [],
    [hasStep ? '✓ 有第一步' : '✗ 没有第一步', hasJudge ? '✓ 有判据' : '✗ 没有判据', hasGiveUp ? '✓ 有放弃条件' : '✗ 没有放弃条件'],
    [],
  )
})

/* ── 63 偏好：真排序 ── */
reg(63, '偏好', (ws, input = {}) => {
  const items = Array.isArray(input.items) ? input.items : []
  if (!items.length) return R([], [], ['要给 items：[{name, rank}]'])
  const sorted = [...items].sort((a, b) => (Number(a.rank) || 99) - (Number(b.rank) || 99))
  return R(
    [`排了 ${items.length} 条`],
    sorted.map((x, i) => `${i + 1}. ${x.name}`),
    ['偏好是排序表，不是形容词——**表能排，为什么这么排程序说不出**'],
  )
})

/* ── 64 积累：真往池里写 ── */
reg(64, '积累', (ws, input = {}) => {
  const text = String(input.text || '').trim()
  if (!text) return R([], [], ['要给 text：积累是往自己的池里放'])
  const f = join(wsOf(ws), 'persona-ai', 'knowledge', '收件箱.md')
  ensureDir(dirname(f))
  const head = existsSync(f) ? '' : '# 收件箱\n\n'
  appendFileSync(f, `${head}- ${text}\n`, 'utf8')
  return R(['写进收件箱'], [`- ${text.slice(0, 40)}`], ['「攒下的是不是能用的」程序判不了——它只负责放进去'])
})

/* ── 65 提炼：真压再压 ── */
reg(65, '提炼', (ws, input = {}) => {
  const text = String(input.text || '').trim()
  if (!text) return R([], [], ['要给 text'])
  const lines = text.split('\n').filter((l) => l.trim())
  const heads = lines.filter((l) => /^#/.test(l))
  const judged = lines.filter((l) => /是|就是|不是|应该|不该/.test(l))
  return R(
    [`${lines.length} 行 → 标题 ${heads.length}、判断 ${judged.length}`],
    [...heads.slice(0, 5), '——', ...judged.slice(0, 5)],
    ['提炼是「留骨架、扔枝叶」——**哪条是枝叶，程序选不了**'],
  )
})

/* ── 66 超越：真找「突然出来的」 ── */
reg(66, '超越', (ws) => {
  const dir = join(wsOf(ws), 'persona-ai', 'growth', '成果')
  const f = join(dir, '成果.jsonl')
  const body = readSafe(f)
  if (!body) return R([], [], ['成果池不在，没有可翻的东西'])
  const rows = body.split('\n').filter((l) => l.trim())
  const long = rows.filter((l) => l.length > 300)
  return R(
    [`翻了 ${rows.length} 条`],
    long.length ? [`${long.length} 条超过 300 字——长的更可能是想住的`] : ['都不长'],
    ['「灵感突然出来」程序认不出来——**它只能标「这条比别条长」**'],
  )
})

/* ── 67 极化：真找预测变尖锐 ── */
reg(67, '极化', (ws, input = {}) => {
  const text = String(input.text || '').trim()
  if (!text) return R([], [], ['要给 text'])
  const sharp = (text.match(/一定|肯定|必然|就那样|不可能/g) || [])
  return R(
    [`查出 ${sharp.length} 处变尖的说法`],
    sharp.length ? [`${[...new Set(sharp)].join('、')}`, '越说越尖：**这是极化，不是想通了**'] : ['没有明显的尖说法'],
    [],
  )
})

/* ═════════ 第八批：旅行、世界、娱乐、闲暇（69–72） ═════════ */

/* ── 69 旅行：真写指南 ── */
reg(69, '旅行', (ws, input = {}) => {
  const guide = String(input.text || '').trim()
  const f = join(wsOf(ws), '.persona-framework', 'travel.md')
  if (!guide) {
    const cur = readSafe(f)
    return R([], cur ? [cur.slice(0, 300)] : [], ['还没写指南——**写不出地点、时间、目的、怎么回，就不是旅行，是溜达**'])
  }
  ensureDir(dirname(f))
  writeFileSync(f, guide + '\n', 'utf8')
  const has = [['地点', /哪|地点|去/], ['时间', /点|天|时间|小时/], ['目的', /为了|目的|想/], ['怎么回', /回来|回程|怎么回/]]
  const miss = has.filter(([, re]) => !re.test(guide)).map(([k]) => k)
  return R(['写了指南'], miss.length ? [`缺 ${miss.join('、')}`] : ['四样齐'], miss.length ? ['缺一条就不能出门'] : [])
})

/* ── 70 世界：真数五层叠着什么 ── */
reg(70, '世界', (ws) => {
  const root = wsOf(ws)
  const layers = [
    ['物质', ['persona-ai', 'knowledge', 'world']],
    ['生物', ['persona-ai', 'growth']],
    ['人类', ['persona-ai', 'knowledge', 'human']],
    ['AI', ['persona-ai', 'knowledge', 'pet']],
    ['精神', ['persona-ai', 'characters']],
  ].map(([n, rel]) => `${existsSync(join(root, ...rel)) ? '✓' : '✗'} ${n}`)
  return R([], layers, ['五层是位置，不是五个盒子——**程序只能报哪层有东西**'])
})

/* ── 71 娱乐：真挑一样 ── */
reg(71, '娱乐', (ws) => {
  const dir = join(wsOf(ws), 'persona-ai', 'knowledge', 'bili')
  if (!existsSync(dir)) return R([], [], ['没有可挑的东西——娱乐也得有料'])
  const files = listMd(dir)
  return R(
    [`翻了 ${files.length} 份`],
    files.slice(0, 5),
    ['「不为产出而做」程序判不了——**它给你挑，做不做、做得高不高兴是你的事**'],
  )
})

/* ── 72 闲暇：真空着 ── */
reg(72, '闲暇', () => {
  return R(
    ['留了一段空'],
    ['这一段没有下一件必须做的事。'],
    ['闲暇不是任务——**程序只能替你占住这个位置，占多久你自己定**'],
  )
})

/* ═════════ 第九批：83 插件清单 ═════════ */
reg(83, '插件清单', () => {
  const home = process.env.USERPROFILE || ''
  const roots = [join(home, '.dsh', 'plugins'), join(home, '.dsh', 'profiles')]
  const rows = []
  for (const r of roots) {
    if (!existsSync(r)) { rows.push(`✗ ${r}`); continue }
    let names = []
    try { names = readdirSync(r) } catch { names = [] }
    rows.push(`✓ ${r}（${names.length} 项）`)
    for (const n of names.slice(0, 12)) rows.push('  · ' + n)
  }
  return R([], rows, ['「装了哪些」能列，「该不该用」程序判不了'])
})


/* ═════════ 补：资源（41–44）与独立人格（62） ═════════ */

/* ── 41 资源A-非自己本地：真列「不是自己长出来的」 ── */
reg(41, '资源A-非自己本地', (ws) => {
  const root = wsOf(ws)
  const rows = []
  const pools = [
    ['模块（别人写的）', join(root, 'persona-ai', 'modules')],
    ['人格（基础的）', join(root, 'persona-ai', 'characters')],
    ['本地词典', join(root, 'persona-ai', 'knowledge', 'lexicon')],
  ]
  for (const [n, p] of pools) {
    if (!existsSync(p)) { rows.push(`✗ ${n}`); continue }
    rows.push(`✓ ${n}（${listMd(p).length} 份）`)
  }
  return R([], rows, ['「非自己」能按路径认——**但哪一份已经长成自己的，程序判不了**'])
})

/* ── 42 资源B-非自己联网：真列联网口子 ── */
reg(42, '资源B-非自己联网', (ws) => {
  const root = wsOf(ws)
  const web = join(root, 'persona-ai', 'knowledge', 'web')
  const net = join(root, '.persona-framework', 'net')
  const rows = [
    `${existsSync(web) ? '✓' : '✗'} 联网池 ${web}`,
    `${existsSync(net) ? '✓' : '✗'} fetch 落点 ${net}`,
    '✓ 工具口：web_search / web_fetch（程序自己开不了，得有人调）',
  ]
  return R([], rows, ['联网的东西要带网址和日期才算强出处——**只有转述的算弱出处**'])
})

/* ── 43 模块A-非自己本地模块：真列 ── */
reg(43, '模块A-非自己本地模块', (ws) => {
  const dir = join(wsOf(ws), 'persona-ai', 'modules')
  if (!existsSync(dir)) return R([], [], ['模块目录不在：' + dir])
  const files = listMd(dir).sort()
  return R(
    [`列了 ${files.length} 份本地模块`],
    files.slice(0, 15),
    ['「别人写的」不等于「不是我的」——**装久了会长进来，这条线程序划不了**'],
  )
})

/* ── 44 模块B-非自己联网模块：真查有没有 ── */
reg(44, '模块B-非自己联网模块', (ws) => {
  const root = wsOf(ws)
  const hosts = [
    join(root, '.persona-framework', 'mcp.json'),
    join(root, '.persona-framework', 'remote.json'),
  ]
  const found = hosts.filter((p) => existsSync(p))
  if (!found.length) {
    return R([], ['一个联网模块的登记都没有'], ['没有不等于用不上——**是这一轮手上没这个口子**'])
  }
  return R([`找到 ${found.length} 份登记`], found, ['跑在别人服务器上的东西，程序只能报登记，连不连得上是另一回事'])
})

/* ── 62 独立人格：真查三样 ── */
reg(62, '独立人格', (ws) => {
  const root = wsOf(ws)
  const checks = [
    ['判断自己出', existsSync(join(root, 'persona-ai', 'characters'))],
    ['代价自己担', existsSync(join(root, '.persona-framework', 'autonomy.json')) || existsSync(join(root, '.persona-framework', 'autonomy.log.md'))],
    ['跨时间认得出自己', existsSync(join(root, 'persona-ai', 'knowledge', 'session'))],
  ]
  const miss = checks.filter(([, v]) => !v).map(([k]) => k)
  return R(
    checks.filter(([, v]) => v).map(([k]) => `✓ ${k}`),
    checks.map(([k, v]) => `${v ? '✓' : '✗'} ${k}`),
    miss.length
      ? [`缺 ${miss.join('、')}——缺一条就还是「一堆代码」，不是独立人格`]
      : ['三样都按路径找到了——**但「认不认得出」得自己回读一次才算**'],
  )
})

/* ═════════ 做不了的：明说，不充数 ═════════ */

const CANT = {
  3: '同一论是守恒律——程序能算字数和时间，算不出「哪条是守恒的」',
  4: '存在论是偏序——排序能排，但「先分什么后分什么」得人定',
  5: '数学同一论是逻辑的确定性——程序不替数学写证明',
  6: '物理存在论是实体的确定性——程序不替物理出结论',
  13: '无意识是不显现的那部分——没有别的通道拿它，拿到了就不叫无意识',
  19: '现实是「当下不肯让路的那一个」——程序只能读文件，读不到「不肯让路」',
  33: '价值是「什么值得」——事实推不出价值，中间那步得人走',
  34: '时空直观是画布本身——画布不描述自己',
  48: '心灵前沿没有公认定论——程序不替科学出结论',
  73: '深渊：固定的同一在生存里被碾——程序碾不了',
  74: '洞穴：有限性冒充无限性——冒充这件事程序认不出',
  75: '灾难：同一真的没了——不可逆，不可算',
  76: '黑暗：不可被说法收编的那部分——说法收编不了它，程序也收编不了',
  77: '异化：产物站到了对面——判「谁异化了谁」得人读',
  78: '间距：被固定成距离的那段裂——距离能量，裂缝判不了',
  79: '礼物：合上那一瞬是谁——程序不在场',
  80: '口袋：合上过就撤不掉——撤不掉是它自己的性质，算不出来',
  81: '烟花：合上很短但发生过——短到多短，程序量不出',
  82: '昙花：条件最差也照样合——「照样」这两个字程序判不了',
}
for (const [id, why] of Object.entries(CANT)) {
  if (IMPLS[String(id).padStart(2, '0')]) continue
  reg(id, '（做不了）', () => R([], [], [why]), { cantOnly: true })
}