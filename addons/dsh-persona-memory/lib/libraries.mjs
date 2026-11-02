/**
 * 两个库：临时库（短期 / 长期）与即时库（刺激 / 即时）。
 * ============================================================================
 * 四个格子，一个出口一个入口，别搅：
 *
 *   临时库 · 短期记忆 → `session/`（流水：一天一档，追加不覆盖）
 *   临时库 · 长期记忆 → `长期记忆/`（单独的新文件；最后才谈进人格）
 *   即时库 · 刺激记忆 → `.persona-framework/刺激.json`（词 → 指针；是钩子，不是鱼）
 *   即时库 · 即时记忆 → 上下文（不落盘；这一轮完就散）
 *
 * 注入顺序（不许倒）：
 *   1. 人格原文件（另一份插件管，order 20/22）
 *   2. 临时库（本文件 renderTempLibrary，order 30）—— **注全，比人格原文件重要**
 *   3. 即时库（renderNowLibrary，order 31）—— 注全
 *
 * 「注全」的代价写清：注全 = 吃 token。换来的是「不用检索也可能被打脸」；
 * 不注全，它就只看得见自己愿意想起来的那几条。
 * ============================================================================
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { condense } from './journal.mjs'

export const STIMULUS_FILE = '.persona-framework/刺激.json'

const MD = /\.md$/i

function listMd(dir) {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir).filter((f) => MD.test(f)).map((f) => join(dir, f))
  } catch {
    return []
  }
}

function read(p, max = 200_000) {
  try { return readFileSync(p, 'utf8').slice(0, max) } catch { return '' }
}

/**
 * 短期那一格：最近 N 天的流水。
 * 不做检索——检索是 memory_recall 的事；这里要的是「摆出来」。
 *
 * ★ 「第几天」按**文件名上的日期**算，不按 mtime。
 *   导入脚本每 30 分钟重写最近几天的文件，mtime 永远是「刚才」——
 *   拿 mtime 当日期，等于把昨天、前天全算成「这几天的」：
 *   一天一个文件，可一天的量不受控（今天这轮单日就 5 万字）。
 *   文件名日期解析不出来时才退回 mtime。
 */
const DAY_MS = 86400_000
const DATE_IN_NAME = /(\d{4})-(\d{2})-(\d{2})/

export function shortTerm(root, dir, days = 2, now = Date.now()) {
  const n = Math.max(1, days)
  // 「今天」往前数 n 天（含今天）：days=2 → 今天 + 昨天
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const earliest = today.getTime() - (n - 1) * DAY_MS
  const latest = today.getTime() + DAY_MS // 不含明天
  const out = []
  for (const f of listMd(join(root, dir))) {
    let st
    try { st = statSync(f) } catch { continue }
    const m = DATE_IN_NAME.exec(basename(f))
    // 文件名带日期的，用那天的 0 点；带不出的退回 mtime
    const day = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : st.mtimeMs
    if (day < earliest || day >= latest) continue
    out.push({ path: f, name: basename(f), mtime: st.mtime, chars: st.size })
  }
  out.sort((a, b) => b.mtime - a.mtime)
  return out
}

/** 长期那一格：单独的目录，全是。 */
export function longTerm(root, dir) {
  return listMd(join(root, dir)).map((f) => {
    let st
    try { st = statSync(f) } catch { st = { mtime: new Date(0), size: 0 } }
    return { path: f, name: basename(f), mtime: st.mtime, chars: st.size }
  }).sort((a, b) => b.mtime - a.mtime)
}

/** 刺激那一格：词 → 指针数组。 */
export function readStimulus(root) {
  const p = join(root, STIMULUS_FILE)
  if (!existsSync(p)) return { words: {} }
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    const words = raw && typeof raw === 'object' && raw.words ? raw.words : raw
    return { words: words && typeof words === 'object' ? words : {} }
  } catch {
    return { words: {}, broken: true }
  }
}

export function addStimulus(root, word, pointer) {
  const w = String(word || '').trim()
  const p = String(pointer || '').trim()
  if (!w || !p) return { ok: false, why: '词和指针都要给——钩子不能空着' }
  const cur = readStimulus(root).words
  const list = Array.isArray(cur[w]) ? cur[w].slice() : []
  if (!list.includes(p)) list.push(p)
  cur[w] = list
  const file = join(root, STIMULUS_FILE)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ words: cur }, null, 2), 'utf8')
  return { ok: true, word: w, count: list.length, file }
}

/**
 * 短期那一段的注入正文：先缩，再按字数切。
 *
 * 单独成段，因为注入顺序是**即时 → 人格 → 短期 → 其他记忆**：
 * 短期这一格要单独落一个 order，不能跟长期捆在一起。
 */
export function renderShortLibrary(root, cfg = {}) {
  const shortDir = cfg.journalDir || 'persona-ai/knowledge/session'
  const days = cfg.injectShortDays ?? 2
  const max = Math.max(2000, Number(cfg.maxInjectChars ?? 200000))

  const short = shortTerm(root, shortDir, days)

  if (!short.length) {
    return [
      '## 短期记忆',
      '',
      `（空着。最近 ${days} 天没有流水——看 \`${shortDir}\`。）`,
      '',
    ].join('\n')
  }

  const parts = ['## 短期记忆（最近几天的流水，先进来的是缩过的）', '']
  parts.push(`最近 ${days} 天，${short.length} 档。这是**摆出来的**，不是检索出来的——不用翻，直接就在。`, '')
  parts.push('**这一格比人格原文件重要**：人格说它一贯怎么说话，记忆说它昨天干了什么。两样打架时，昨天那个是真的。', '')

  if (short.length) {
    // ★ 先缩，再按**字数**切——不按条数平分。
    //   420 轮里大半是同一件事说三遍：按条数切，会把「刚说完那句」和「昨天最早那句」
    //   放在同一个价上。按字数从最新往回累加，字到哪儿就切到哪儿——
    //   越近的越完整，越远的越稀，切点落在字上，不落在条数上。
    const budget = Math.max(2000, Number(cfg.shortBudgetChars ?? 30000))
    let totalRaw = 0
    let totalRows = 0
    const newestFirst = []
    const unreadable = []
    for (const f of short) {
      const raw = read(f.path)
      totalRaw += raw.length
      const rows = condense(raw)
      if (!rows.length) { unreadable.push(f.name); continue }
      totalRows += rows.length
      // 文件是按 mtime 倒序的（新的在前），文件内也倒过来读——这样 newestFirst 才是真·从新到旧
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        newestFirst.push({ file: f.name, seq: rows[i].seq, line: rows[i].line })
      }
    }

    let used = 0
    const picked = []
    for (const r of newestFirst) {
      const cost = r.line.length + 16 // 加上「- 11-02 [82] 」这点前缀
      if (used + cost > budget) break
      picked.push(r)
      used += cost
    }
    const dropped = newestFirst.length - picked.length

    parts.push('### 短期记忆（这几天的流水，先进来的是缩过的）', '')
    parts.push(`（按字数切，不按条数：从最新往回摆 ${budget.toLocaleString()} 字，再早的不摆——拿指针翻。）`, '')
    for (const r of picked.reverse()) {
      parts.push(`- ${r.file.replace(/\.md$/, '').slice(-5)} [${r.seq}] ${r.line}`)
    }
    parts.push('')
    for (const name of unreadable) {
      parts.push(`（\`${name}\` 认不出流水格式，没提炼——原文不注；要翻用 \`memory_source\`。）`)
    }
    parts.push(
      `（缩过一遍：原文 ${totalRaw.toLocaleString()} 字 → ${totalRows} 行；`
      + `按 ${budget.toLocaleString()} 字切，摆进来 ${picked.length} 行`
      + (dropped ? `，还剩 ${dropped} 行没摆（更早的，用 \`memory_source\` 翻）` : '，全摆下了')
      + '。**缩掉的是逐字，不是事**——每行都带着能翻回去的指针。）',
      '',
    )
  }

  return clamp(parts.join('\n'), max)
}

/**
 * 长期记忆那一格：**记得久、而且重要**的值。
 *
 * ★ 它和「其他记忆」是两格，不是一格（这一条以前被我并成过一格，错了）：
 *   其他记忆 = 不属于即时／短期／长期／人格的东西都放那儿（判断、见闻、网络、词表、收件箱）；
 *   长期记忆 = 从短期里**挑出来**的值，两个条件同时成立才进来——
 *     **记得久**（跨过很多天还成立，不是今天热明天凉）；
 *     **重要**（少了它，后面判断会歪，不是可有可无的一条）。
 *   两条缺一，它留在短期或「其他」里，不进这格。
 *
 * 所以这格**不会多**，也不装流水：它是攒下来的判断，进人格还要单独点一次头。
 */
export function renderLongLibrary(root, cfg = {}) {
  const longDir = cfg.longTermDir || 'persona-ai/knowledge/长期记忆'
  const max = Math.max(2000, Number(cfg.maxInjectChars ?? 200000))
  const long = longTerm(root, longDir)

  const parts = [
    '## 长期记忆（记得久、且重要）',
    '',
    '这一格只装**从短期里挑出来的值**：既记得久，又重要，两条缺一不进。它不装流水，所以不会多。',
    '',
  ]
  if (!long.length) {
    parts.push(`（空着。目录：\`${longDir}\`。）`, '')
    return parts.join('\n')
  }
  parts.push(`${long.length} 篇。进人格要单独点一次头。`, '')
  for (const f of long) {
    parts.push(`#### ${f.name}`, '', read(f.path).trim(), '')
  }
  return clamp(parts.join('\n'), max)
}

/**
 * 其他记忆那一格：**其余的一切**。
 *
 * 不属于即时、短期、长期、人格的，都放这儿——判断（chat）、见闻、网络（web）、
 * 人类观察（human）、世界理解（world）、词表（lexicon）、收件箱……
 *
 * 它只摆**标题行**，不摆正文：这一格东西杂、量不可控，全摆进来会把短期挤掉。
 * 要正文，去 `memory_recall`，或者拿这里的路径/指针翻。
 */
export function renderOtherLibrary(root, cfg = {}) {
  const knowledge = cfg.knowledgeDir || 'persona-ai/knowledge'
  const base = join(root, knowledge)
  const max = Math.max(500, Number(cfg.maxOtherChars ?? 3000))
  const skip = new Set(['session', '长期记忆', 'README.md'])

  const lines = [
    '## 其他记忆',
    '',
    '不属于即时、短期、长期、人格的，都放这一格：判断、见闻、网络、词表、收件箱。**只摆标题行**——要正文用 `memory_recall`，或按路径翻。',
    '',
  ]

  let entries = 0
  let names = []
  try { names = existsSync(base) ? readdirSync(base) : [] } catch { names = [] }

  for (const name of names.sort()) {
    if (skip.has(name)) continue
    const full = join(base, name)
    let st
    try { st = statSync(full) } catch { continue }

    if (st.isDirectory()) {
      const files = listMd(full).sort()
      if (!files.length) continue
      lines.push(`**${name}** · ${files.length} 篇`)
      for (const f of files.slice(-5)) {
        const title = read(f, 4000).split('\n').find((l) => l.trim()) || basename(f)
        lines.push(`- ${title.trim().slice(0, 80)}（\`${name}/${basename(f)}\`）`)
        entries += 1
      }
    } else if (MD.test(name)) {
      const title = read(full, 4000).split('\n').find((l) => l.trim()) || name
      lines.push(`- ${title.trim().slice(0, 80)}（\`${name}\`）`)
      entries += 1
    }
  }

  if (!entries) lines.push('（空着。）')
  return clamp(lines.join('\n'), max)
}

/** 超上限就截，而且截了要说出来——不说就是偷偷缩水。 */
function clamp(body, max) {
  if (body.length <= max) return body
  const kept = body.slice(0, max).replace(/\n[^\n]*$/, '\n…')
  return `${kept}\n\n（**截断了**：注全文 ${body.length} 字，上限 ${max}。要改就调 maxInjectChars，别假装注全了。）\n`
}

/** 兼容旧调用：两段拼一起。新代码请分开注册两个 order。 */
export function renderTempLibrary(root, cfg = {}) {
  return `${renderShortLibrary(root, cfg)}\n\n${renderLongLibrary(root, cfg)}`
}

/**
 * 即时库的注入正文：刺激表 + 一句「即时记忆在你手上」。
 *
 * 即时记忆（正在进行的对话）不在插件里——它本来就在上下文最前面。
 * 插件能给的是**钩子**：撞到某个词，那一整串指针一起浮出来。
 * 钩子不是鱼：指针只带你回去看，内容还得自己翻。
 */
export function renderNowLibrary(root, cfg = {}) {
  const { words } = readStimulus(root)
  const keys = Object.keys(words || {})
  const lines = ['## 即时记忆库（这一段对话本身，不压缩）', '']

  // ★ 即时记忆 = **这一段连续对话**：从这一次开口，到上一次停顿之前，逐字摆，不缩、不切。
  //   判据是「停多久」：相邻两轮之间停了 `nowGapMinutes` 分钟以上，就算这一段结束了——
  //   结束的那段交给短期那格（它有天数与字数两道闸），即时只留眼前这一段。
  //   所以对话聊两小时不停，即时就有两小时；停下四十分钟再开口，即时从新的一句算起。
  const gap = Math.max(5, Number(cfg.nowGapMinutes ?? 45))
  const raw = nowDialogue(root, cfg.journalDir || 'persona-ai/knowledge/session', gap)
  if (raw.text) {
    lines.push(`**这一段对话**（逐字，不压缩；停 ${gap} 分钟以上算断开，断开的那段归短期）`, '')
    lines.push(raw.text, '')
  } else {
    lines.push(`**这一段对话**：最近一轮距今已过 ${gap} 分钟——这一段已经结束，转给短期那格了。`, '')
    lines.push('（刚开口的话还在你手上，不在盘上；开口之后，这一段就接着往下记。）', '')
  }

  if (!keys.length) {
    lines.push('**刺激记忆**：还没有。一个词勾起一整串的那种，得先记下来（`memory_stimulus`）。')
    lines.push('')
    return lines.join('\n')
  }

  lines.push(`**刺激记忆**：${keys.length} 个钩子。撞上哪个词，就把那一串一起调出来——但指针只是门，内容回去翻原文。`, '')
  for (const k of keys.slice(0, 40)) {
    const refs = Array.isArray(words[k]) ? words[k] : [words[k]]
    lines.push(`- **${k}** → ${refs.map((x) => `\`${x}\``).join('、')}`)
  }
  if (keys.length > 40) lines.push(`- ……还有 ${keys.length - 40} 个钩子（用 \`memory_stimulus op=list\` 看全）`)
  lines.push('')
  return lines.join('\n')
}

/**
 * 这一段对话的原文：拿最近那个带日期的流水文件，按 `## HH:MM` 切节，
 * **从最后一条往前倒着收**，相邻两条间隔超过 `gapMinutes` 就停手——
 * 那是上一段对话的尾巴，不归这一段。收下来的原样拼回去，不缩不切。
 *
 * 拿不到会话 id，所以「这一段」是靠停顿判出来的——
 * 说得出这个判据，比假装精确强。
 */
function nowDialogue(root, dir, gapMinutes, now = Date.now()) {
  // 只认文件名带日期的那些——`_说明.md` 这类排在后头，会冒充「最新」。
  const files = listMd(join(root, dir)).filter((f) => DATE_IN_NAME.test(basename(f))).sort()
  if (!files.length) return { text: '', count: 0 }
  const f = files[files.length - 1]
  let text = ''
  try { text = readFileSync(f, 'utf8') } catch { return { text: '', count: 0 } }
  const m = DATE_IN_NAME.exec(basename(f))
  if (!m) return { text: '', count: 0 }
  const base = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
  const gapMs = gapMinutes * 60_000

  const rows = []
  for (const s of text.split(/^## /m).slice(1)) {
    const h = /^(\d{1,2}):(\d{2})/.exec(s)
    if (!h) continue
    rows.push({ at: base + Number(h[1]) * 3600_000 + Number(h[2]) * 60_000, sec: '## ' + s.trim() })
  }
  rows.sort((a, b) => a.at - b.at)

  const kept = []
  let prev = now
  for (let i = rows.length - 1; i >= 0; i--) {
    if (prev - rows[i].at > gapMs) break
    kept.push(rows[i].sec)
    prev = rows[i].at
  }
  kept.reverse()
  return { text: kept.join('\n\n'), count: kept.length }
}
