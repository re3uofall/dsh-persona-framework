/**
 * 按字查：这段话到底在不在这本账上、是谁说的、在哪一节。
 *
 * 思路抄自 dsh-hippocampus 的 `trace`（它那套把「他说的 / 他转发的 / 我说的 /
 * 只是手上的操作」分开的做法是对的：`recall` 按意思找，只能给「很像」，
 * 而「他说过这句没有」「我答应过他吗」要的是一字不差）。但实现按我们这边重写，
 * 四处不同，都写在下面——不是嫌它写得不好，是池子形状不一样。
 *
 * 一、**不建第二份索引。** 它把每句话再抄进一张 traces 表，表里带 sid 和行号。
 *     那是原话的第二份拷贝：原件改了它不跟，就成了「对但不准」。
 *     我们的池子本来就是 md，逐字扫一遍就有；零存储、零同步、不可能跟原文对不上。
 *
 * 二、**出处直接是 memory_source 的指针**（`session/2026-10-31.md#7`），不用库内行号。
 *     它给的是自己库里的行号，拿到手没法核对；我们的指针喂回 memory_source
 *     就拿到逐字全文——查完能当场回去对一遍，这才叫「翻得回那一句」。
 *
 * 三、**两种口径都试，而且要说清是哪种命中的。** 先按原样找；找不到再按
 *     「去掉空白和引号」找。人抄话时常把引号一起抄进来，或者中间折了行——
 *     只认原样就会假报「没有」。
 *
 * 四、**扫不完就说扫不完。** 设了文件数和字节上限；触到上限又没命中，
 *     输出「没扫完」而不是「没有」。**「没有」是个很硬的结论，付不起假阴性。**
 *
 * 归属按我们 md 的形状分：`师父：` / `她：` / 元数据行（`- tags:` 之类，不算话）。
 * 「她引了师父的话」单列一格——那是转述，不能拿来认师父答应过什么。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const MD = /\.md$/i
const META = /^-\s*(tags|kind|source|updated|weight|state|date|at)\s*[:：]/i

/** 我们这边说话人的前缀。导出给别人加自己的。 */
export const SPEAKERS = { he: ['师父', '用户', '你'], me: ['她', '我', '思思'] }

/** 归一：全角空格 → 半角，连续空白压成一个，去首尾。 */
export function norm(s) {
  return String(s || '').replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim()
}

/** 去掉引号与空白——第二种口径用。只用在「原样找不到」之后。 */
export function loose(s) {
  return norm(s).replace(/[「」『』“”"‘’'`《》〈〉【】\[\]()（）]/g, '').replace(/\s+/g, '')
}

function listMd(dir) {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir).filter((f) => MD.test(f)).sort().map((f) => join(dir, f))
  } catch {
    return []
  }
}

/**
 * 按 `## ` 切节。返回 [{ no, title, body }]，no 从 1 起——
 * 和 memory_source 的 `文件#序号` 是同一个坐标系，不是另起一套。
 */
export function sectionsOf(text) {
  // ★ 先归一换行，再切节。这一条是踩出来的：池子里的 md 是 CRLF，
  //   而 `/^##\s+(.*)$/` 里的 `.` 不吃 `\r`、`$` 又要求行尾正好在那儿，
  //   于是满篇 `## 标题` 一个都认不出来，整篇被当成「没分节」的第 1 节——
  //   指针全成 `#1`，翻回去对不上任何一节。假阴性比查不到更坏。
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n')
  const out = []
  let cur = null
  for (const line of lines) {
    const m = /^##\s+(.*)$/.exec(line)
    if (m) {
      if (cur) out.push(cur)
      cur = { no: out.length + 1, title: m[1].trim(), lines: [] }
      continue
    }
    if (cur) cur.lines.push(line)
  }
  if (cur) out.push(cur)
  // ★ 没分节的整篇算第 1 节。这一条是判据不是格式：
  //   流水层有的文件是整段落的，没有 `## ` 标题；要是因此整篇跳过，
  //   「按字查」就会对着一句明明写着的话报「没有」——假阴性比漏查更坏。
  if (!out.length) {
    const body = String(text || '').trim()
    if (body) return [{ no: 1, title: '（整篇，没分节）', body, whole: true }]
  }
  return out.map((s) => ({ no: s.no, title: s.title, body: s.lines.join('\n') }))
}

/** 一节里的正文行——去掉元数据行和空行，剩下才算「话」。 */
function speechLines(body) {
  const out = []
  for (const line of String(body || '').split('\n')) {
    const t = line.trim()
    if (!t) continue
    if (t.startsWith('#')) continue
    if (t.startsWith('>')) continue
    if (META.test(t)) continue
    if (/^[-*_]{3,}$/.test(t)) continue
    out.push(t)
  }
  return out
}

/**
 * 把一节切成「说话人段」：遇到 `师父：` / `她：` 开新段，没前缀的行并进上一段。
 * 返回 [{ who: 'he'|'me'|'other', text }]。
 */
export function turnsOf(body, speakers = SPEAKERS) {
  const turns = []
  for (const line of speechLines(body)) {
    let who = null
    let rest = line
    for (const [k, names] of Object.entries(speakers)) {
      for (const n of names) {
        const p = n + '：'
        const p2 = n + ':'
        if (line.startsWith(p)) { who = k; rest = line.slice(p.length); break }
        if (line.startsWith(p2)) { who = k; rest = line.slice(p2.length); break }
      }
      if (who) break
    }
    if (who) turns.push({ who, text: rest })
    else if (turns.length) turns[turns.length - 1].text += '\n' + line
    else turns.push({ who: 'other', text: line })
  }
  return turns
}

/**
 * 在整本池子里按字找。
 *
 * @returns {{
 *   hits: Array<{mode:string, who:string, file:string, pointer:string, title:string, text:string}>,
 *   mode: 'exact'|'loose'|'none',
 *   scannedFiles:number, scannedBytes:number, truncated:boolean, dirs:string[]
 * }}
 */
export function findVerbatim(root, dirs, query, opts = {}) {
  const maxFiles = opts.maxFiles ?? 4000
  const maxBytes = opts.maxBytes ?? 96 * 1024 * 1024
  const q = norm(query)
  const qLoose = loose(query)

  const files = []
  for (const d of dirs) for (const f of listMd(join(root, d))) files.push(f)

  const scannedDirs = dirs.filter((d) => existsSync(join(root, d)))
  let scannedFiles = 0
  let scannedBytes = 0
  let truncated = false

  /** 一轮扫一种口径。exact 优先——命中就停，不拿第二种去污染第一种的结论。 */
  const scan = (mode) => {
    const hits = []
    for (const abs of files) {
      if (scannedFiles >= maxFiles || scannedBytes >= maxBytes) { truncated = true; break }
      let text
      let size = 0
      try {
        size = statSync(abs).size
        if (mode === 'exact' && !hits.length) scannedBytes += size
        text = readFileSync(abs, 'utf8')
      } catch {
        continue
      }
      if (mode === 'exact') scannedFiles += 1
      const rel = relative(root, abs).replace(/\\/g, '/')
      // 指针按 memory_source 认的形状给：剥掉 `persona-ai/knowledge/` 那一段，
      // 出来的就是 `session/2026-10-31.md#7`——查完能直接喂回去，不用再换算一次。
      const ptr = rel.replace(/^persona-ai\/knowledge\//, '')
      for (const sec of sectionsOf(text)) {
        for (const turn of turnsOf(sec.body, opts.speakers)) {
          const hay = mode === 'exact' ? norm(turn.text) : loose(turn.text)
          const needle = mode === 'exact' ? q : qLoose
          if (!needle || !hay.includes(needle)) continue
          hits.push({
            mode,
            who: turn.who,
            file: rel,
            pointer: `${ptr}#${sec.no}`,
            title: sec.title,
            text: norm(turn.text),
          })
        }
      }
    }
    return hits
  }

  const exact = q ? scan('exact') : []
  if (exact.length) {
    return { hits: exact, mode: 'exact', scannedFiles, scannedBytes, truncated, dirs: scannedDirs }
  }
  const looseHits = qLoose ? scan('loose') : []
  return {
    hits: looseHits,
    mode: looseHits.length ? 'loose' : 'none',
    scannedFiles,
    scannedBytes,
    truncated,
    dirs: scannedDirs,
  }
}

/**
 * 一节的「上一条」= 他刚说了什么。空指针时用它补上下文，别让人只看半句。
 * 只在命中那一节里找，不跨节——跨节就成了猜。
 */
export function renderTrace(query, result, opts = {}) {
  const maxPer = opts.maxPer ?? 3
  const q = norm(query)
  const qLoose = loose(query)
  const { hits, mode, scannedFiles, truncated } = result

  if (!hits.length) {
    const scope = result.dirs.length
      ? `扫了 ${result.dirs.length} 个目录、${scannedFiles} 个文件`
      : '这条路径下没有能扫的目录'
    if (truncated) {
      return [
        '【没扫完 · 别当成「没有」】',
        `（${scope}，触到了上限就停了）`,
        `要查的「${q.slice(0, 80)}」没扫到，但**没扫完**——所以不能说它没有。`,
        '要么给个小一点的片段再查，要么直接 memory_recall 翻一下。',
      ].join('\n')
    }
    return [
      '【这本账上没有这段话】',
      `（${scope}，一字不差翻过了；去掉空白和引号也翻过了）`,
      `没有「${q.slice(0, 80)}」。`,
      '**这条结论只管「账上有没有」，不管「有没有发生过」。**',
      '刚说完的话可能还没进池——流水是每 30 分钟从会话里导一次的，导之前账上是空的。',
      '所以：要么没人说过，要么说过但还没落盘，要么当时用的是别的字。',
    ].join('\n')
  }

  const he = hits.filter((h) => h.who === 'he')
  const me = hits.filter((h) => h.who === 'me')
  const other = hits.filter((h) => h.who !== 'he' && h.who !== 'me')

  const line = (h, i) => {
    const body = h.text.length > 220 ? h.text.slice(0, 170) + '……' + h.text.slice(-40) : h.text
    return `${i + 1}. 指针 \`${h.pointer}\` · ${h.title}\n　「${body}」`
  }

  const out = [
    `【按字查过 · ${mode === 'exact' ? '一字不差' : '去掉空白和引号后一字不差'} · 一共 ${hits.length} 处】`,
    `师父说的 ${he.length} 处 · 她说的 ${me.length} 处 · 认不出是谁的 ${other.length} 处`,
  ]

  if (!he.length) {
    out.push('')
    out.push(me.length
      ? `※ 没有「师父说的」。有 ${me.length} 处是她说的，或是她引师父的话——**引用不算师父答应过什么**。`
      : '※ 没有「师父说的」。要认承诺，就没有可以认的东西。')
  } else {
    out.push('')
    out.push(`※ 师父说的这句，一共 ${he.length} 处。但「说过」不等于「承诺过」——得看上下文：是在答应，还是在聊这件事本身。`)
  }

  const block = (label, arr) => {
    if (!arr.length) return
    out.push('')
    out.push(`${label}（${arr.length} 处）`)
    out.push(...arr.slice(0, maxPer).map(line))
    if (arr.length > maxPer) out.push(`（还有 ${arr.length - maxPer} 处没列。）`)
  }

  block('师父说的', he)
  block('她说的', me)
  block('认不出是谁说的', other)

  out.push('')
  out.push(`想翻回逐字全文：拿到指针去问 memory_source，用的就是上面那个（${hits[0].pointer} 这种形状）。`)
  return out.join('\n')
}
