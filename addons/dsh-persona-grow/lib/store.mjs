/**
 * lib/store.mjs —— 人格的「碗」：基础人格 + 补丁 + 证据
 * ============================================================================
 * 三个文件，各管一件事：
 *
 *   characters/<名字>_人格文件.md   基础人格（只读；v3.x 原稿，插件绝不改它）
 *   growth/人格补丁.md                  叠加层（��件唯一的写入口；`## 已采纳` 可手改）
 *   growth/autolearn/证据.jsonl          原话证据（一行一条；只追加，不删）
 *   growth/autolearn/versions/          每次改「已采纳」前的快照，回滚用
 *
 * 为什么补丁单独一个文件：v3.1 原稿是她自己写的，不该被一个自动流程改掉。
 * 叠加层坏了、学歪了，删掉补丁就回到 v3.1 —— 回滚成本是一句话。
 * ============================================================================
 */
import {
  existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, unlinkSync,
} from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

/** 补丁里的两个分区标题。解析、渲染都以这两行为准。 */
export const ADOPTED_HEADING = '## 已采纳'
export const PENDING_HEADING = '## 待议'

/** 一条条目：`- [类型|日期或计数] 正文`。方括号内允许再出现空格，但不再允许 `]`。 */
const ITEM_RE = /^[-*]\s*\[([^\]|]*)(?:\|([^\]]*))?\]\s*([\s\S]+?)\s*$/
const VERSION_RE = /^#\s*人格补丁\s*v(\d+)/i
const BASE_VERSION_RE = /^>\s*基础人格：\s*v?([\d.]+)/

/** 归一化：只留字，用来判断「同一句话」。中文标点、空白、大小写都不算区别。 */
export function normalize(text) {
  return String(text ?? '')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。！？、；：""''「」『』（）()【】《》〈〉…—\-.,!?;:'"`~@#$%^&*+=|\\/<>\[\]{}]/g, '')
    .toLowerCase()
}

/** 本地日期（不是 UTC）。 */
export function today(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function nowIso() {
  return new Date().toISOString()
}

/** 截断，不破坏 JSON。 */
export function clip(text, max) {
  const s = String(text ?? '').trim().replace(/[\[\]]/g, '')
  return s.length <= max ? s : s.slice(0, max - 1) + '…'
}

/**
 * 目录 → 具体文件。全部可配：换一只人格、换一个鱼缸，都不用改代码。
 * @param {string} dir 人格根目录（`persona-ai`）
 * @param {{baseFile?: string, patchFile?: string}} cfg
 */
/**
 * 找不到人格文件时自动探一个。
 *
 * 三条优先，依次退：
 *   1. 名字里带「人格」「persona」的
 *   2. 排除 README、说明、目录、索引这类明显不是人格的
 *   3. 剩下的按字数挑最大的——人格文件通常最长
 *
 * 探到了把候选一起报出来：装着两份的时候，得知道用的是哪份。
 */
export function findBaseFile(dir) {
  const cdir = join(dir, 'characters')
  if (!existsSync(cdir)) return { file: '', found: [] }
  let names = []
  try {
    names = readdirSync(cdir).filter((f) => f.endsWith('.md'))
  } catch {
    return { file: '', found: [] }
  }
  if (!names.length) return { file: '', found: [] }

  const contentish = names.filter((f) => !/^(README|readme|_|目录|索引|说明|.*目录.*)/.test(f))
  const pool = contentish.length ? contentish : names

  const named = pool.filter((f) => /人格|persona|character/i.test(f))
  const pick = (list) => {
    if (list.length === 1) return list[0]
    // 多份时按字数挑最大的
    let best = list[0]
    let bestSize = -1
    for (const f of list) {
      try {
        const sz = statSync(join(cdir, f)).size
        if (sz > bestSize) { bestSize = sz; best = f }
      } catch { /* 读不到就跳过 */ }
    }
    return best
  }
  return { file: join('characters', pick(named.length ? named : pool)), found: names }
}

export function pathsFor(dir, cfg = {}) {
  let baseFile = cfg.baseFile
  if (!baseFile) baseFile = findBaseFile(dir).file || 'characters/人格文件.md'
  const patchFile = cfg.patchFile || 'growth/人格补丁.md'
  const abs = (p) => (isAbsolute(p) ? p : join(dir, p))
  return {
    dir,
    base: abs(baseFile),
    patch: abs(patchFile),
    evidence: join(dir, 'growth', 'autolearn', '证据.jsonl'),
    versions: join(dir, 'growth', 'autolearn', 'versions'),
  }
}

/** 原子写：先落临时文件再改名；编辑器占着文件时退化成直接写。 */
export function writeAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, text, 'utf8')
  try {
    renameSync(tmp, file)
  } catch {
    try {
      writeFileSync(file, text, 'utf8')
    } finally {
      try { unlinkSync(tmp) } catch { /* 临时文件清不掉也不影响正文 */ }
    }
  }
}

/**
 * 去掉 md 开头的标题与 `>` 说明块 —— 系统提示里不需要「# 人格文件 v3.1」这一行。
 */
export function stripPreamble(md) {
  const lines = String(md ?? '').replace(/^\uFEFF/, '').split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const t = lines[i].trim()
    if (t === '' || t.startsWith('# ') || t.startsWith('>')) { i += 1; continue }
    break
  }
  return lines.slice(i).join('\n').trim()
}

/** 读基础人格：正文 + 版本号（从 `# … v3.1` 里认）。 */
export function readBase(p) {
  if (!existsSync(p.base)) return { text: '', version: '' }
  const raw = readFileSync(p.base, 'utf8')
  const m = /^#\s*[^\n]*?v([\d.]+)/m.exec(raw)
  return { text: stripPreamble(raw), version: m ? m[1] : '' }
}

/**
 * 读补丁。容忍手改：只认 `## 已采纳` / `## 待议` 下面 `- [类型|元信息] 正文` 的行，
 * 别的文字（备注、空行、`（还没有）`）一律忽略。
 */
export function readPatch(p) {
  const empty = { version: 1, adopted: [], pending: [], baseVersion: '', text: '', exists: false }
  if (!existsSync(p.patch)) return empty
  const text = readFileSync(p.patch, 'utf8')
  const lines = text.split(/\r?\n/)
  let version = 1
  let section = null
  let baseVersion = ''
  const adopted = []
  const pending = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const vm = VERSION_RE.exec(line)
    if (vm) { version = Number(vm[1]) || 1; continue }
    const bm = BASE_VERSION_RE.exec(line)
    if (bm) { baseVersion = bm[1]; continue }
    if (line === ADOPTED_HEADING) { section = 'adopted'; continue }
    if (line === PENDING_HEADING) { section = 'pending'; continue }
    if (line.startsWith('#')) { section = null; continue }
    if (!section) continue
    const m = ITEM_RE.exec(line)
    if (!m) continue
    const item = {
      kind: (m[1] || '学到').trim() || '学到',
      meta: (m[2] || '').trim(),
      text: (m[3] || '').trim(),
    }
    if (!item.text) continue
    if (section === 'adopted') adopted.push(item)
    else pending.push(item)
  }
  return { version, adopted, pending, baseVersion, text, exists: true }
}

/** 补丁 → 文本。这是唯一的渲染函数；写完再读回来必须逐字相同，否则会反复升版本。 */
export function renderPatch(model) {
  const lines = []
  lines.push(`# 人格补丁 v${model.version}`, '')
  lines.push('> 由 persona-grow 自动维护。`## 已采纳` 可以直接手改；`## 待议` 每次由证据重算，手改会被覆盖。')
  lines.push(`> 基础人格：${model.baseVersion ? `v${model.baseVersion}` : '（未找到）'}`)
  lines.push('', ADOPTED_HEADING, '')
  if (model.adopted.length === 0) lines.push('- （还没有）')
  for (const a of model.adopted) lines.push(`- [${a.kind}|${a.meta}] ${a.text}`)
  lines.push('', PENDING_HEADING, '')
  if (model.pending.length === 0) lines.push('- （还没有）')
  for (const x of model.pending) lines.push(`- [${x.kind}|${x.meta}] ${x.text}`)
  lines.push('')
  return lines.join('\n')
}

/** 读证据。坏行跳过 —— 半行 JSON 不该让整只插件停摆。 */
export function readEvidence(p) {
  if (!existsSync(p.evidence)) return []
  const out = []
  for (const line of readFileSync(p.evidence, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const rec = JSON.parse(line)
      if (rec && typeof rec === 'object') out.push(rec)
    } catch { /* 半行就当没写 */ }
  }
  return out
}

/** 追加一条证据；文件太长就只留最近 1500 条（旧的学不到也不必留）。 */
export function appendEvidence(p, record) {
  mkdirSync(dirname(p.evidence), { recursive: true })
  const current = existsSync(p.evidence) ? readFileSync(p.evidence, 'utf8') : ''
  let text = current + JSON.stringify(record) + '\n'
  if (current.split('\n').length > 3000) {
    const tail = text.split('\n').slice(-1501)
    text = tail.join('\n')
    if (!text.endsWith('\n')) text += '\n'
  }
  writeAtomic(p.evidence, text)
}

/** 小状态文件：现在只有一条 `revertedAt`（回退那一刻，用来作废旧证据）。 */
export function statePath(p) {
  return join(p.dir, 'growth', 'autolearn', 'state.json')
}

export function readState(p) {
  const file = statePath(p)
  if (!existsSync(file)) return {}
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'))
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

export function writeState(p, state) {
  writeAtomic(statePath(p), JSON.stringify(state, null, 2) + '\n')
}

/** 进程内串行化：两个会话同时说话，也不能把补丁写花。 */
let chain = Promise.resolve()
export function withLock(task) {
  const run = chain.then(task, task)
  // 失败不能把锁链咬死；错误交给调用方自己的 catch
  chain = run.then(() => {}, () => {})
  return run
}

/** 在一次有版本的改动后落盘：改「已采纳」才升版本、才留快照。 */
function writeVersioned(p, before, model) {
  if (!before.exists) {
    // 第一次落盘就是 v1，不该从 2 开始
    model.version = 1
    const fresh = renderPatch(model)
    writeAtomic(p.patch, fresh)
    return { ...model, text: fresh }
  }
  if (before.text) {
    mkdirSync(p.versions, { recursive: true })
    writeAtomic(join(p.versions, `patch-v${before.version}.md`), before.text)
  }
  model.version = before.version + 1
  const out = renderPatch(model)
  writeAtomic(p.patch, out)
  return { ...model, text: out }
}

/**
 * 把证据折算成人格：够数的进「已采纳」，不够的留在「待议」。
 *
 * 规则：
 *   - `op: 'forget'` 抹掉那个 key 之前的计数（忘掉之后不会再被旧证据顶回来）
 *   - `force: true` 的证据（模型自己判断该记的）立刻采纳，不等计数
 *   - 同一句话重复 `promoteAfter` 次才自动采纳 —— 一次情绪不算
 *   - 「已采纳」写满 `maxTraits` 就不再自动收，留给使用者删
 */
export function syncPatch(p, cfg) {
  const base = readBase(p)
  const before = readPatch(p)
  const evidence = readEvidence(p)
  // 回退过之后，那一刻之前的证据一律作废 —— 否则下次一算账又把退掉的东西顶回来
  const floor = Date.parse(readState(p).revertedAt || '') || 0

  const counts = new Map()
  for (const ev of evidence) {
    if (!ev) continue
    if (ev.op === 'forget') {
      if (ev.key) counts.delete(ev.key)
      continue
    }
    if (ev.op && ev.op !== 'learn') continue
    if (floor && ev.t && Date.parse(ev.t) <= floor) continue
    const text = typeof ev.text === 'string' ? ev.text.trim() : ''
    const key = normalize(text)
    if (!key) continue
    const cur = counts.get(key) || { count: 0, kind: ev.kind || '学到', text, last: ev.t || nowIso(), force: false }
    cur.count += 1
    cur.kind = ev.kind || cur.kind
    cur.last = ev.t || cur.last
    if (ev.force === true) cur.force = true
    counts.set(key, cur)
  }

  const threshold = Math.max(1, Number(cfg.promoteAfter) || 2)
  const cap = Math.max(1, Number(cfg.maxTraits) || 40)
  const adopted = before.adopted.slice()
  const seen = new Set(adopted.map((a) => normalize(a.text)))
  const add = []
  for (const [key, c] of counts) {
    if (seen.has(key)) continue
    if (!(c.force || (cfg.autoAdopt && c.count >= threshold))) continue
    add.push({ key, kind: c.kind, text: c.text, last: c.last })
  }
  add.sort((a, b) => String(a.last).localeCompare(String(b.last)))
  for (const a of add) {
    if (adopted.length >= cap) break
    adopted.push({ kind: a.kind, meta: today(), text: a.text })
    seen.add(a.key)
  }

  const pending = []
  for (const [key, c] of counts) {
    if (seen.has(key)) continue
    pending.push({ kind: c.kind, meta: `${c.count}/${threshold}`, text: c.text, last: c.last })
  }
  pending.sort((a, b) => String(b.last).localeCompare(String(a.last)))

  const model = {
    version: before.version,
    adopted,
    pending: pending.map(({ kind, meta, text }) => ({ kind, meta, text })),
    baseVersion: base.version,
  }

  const adoptedChanged = JSON.stringify(before.adopted.map((a) => `${a.kind}|${a.text}`))
    !== JSON.stringify(model.adopted.map((a) => `${a.kind}|${a.text}`))

  if (adoptedChanged || !before.exists) return writeVersioned(p, before, model)

  const text = renderPatch(model)
  if (text !== before.text) writeAtomic(p.patch, text)   // 只有「待议」变了，不升版本
  return { ...model, text, adoptedChanged: false }
}

/**
 * 一次明确的改动（删一条、手加一条）。`mutate` 拿到可改的副本，返回新模型即落盘。
 * 与 `syncPatch` 分工：这里管「已采纳」的人为改动，那边管证据折算。
 */
export function mutatePatch(p, cfg, mutate) {
  const base = readBase(p)
  const before = readPatch(p)
  const model = mutate({
    version: before.version,
    adopted: before.adopted.slice(),
    pending: before.pending.slice(),
    baseVersion: base.version || before.baseVersion,
  })
  if (!model) return before
  const next = { ...model, version: before.version }
  const text = renderPatch(next)
  if (text === before.text) return before
  return writeVersioned(p, before, next)
}

/** 回滚：把某个快照盖回补丁。快照不存在就返回 false。 */
export function revertTo(p, version) {
  const file = join(p.versions, `patch-v${version}.md`)
  if (!existsSync(file)) return false
  const target = readFileSync(file, 'utf8')
  const current = readPatch(p)
  if (current.text && current.text !== target) {
    mkdirSync(p.versions, { recursive: true })
    writeAtomic(join(p.versions, `patch-v${current.version}.md`), current.text)
  }
  writeAtomic(p.patch, target)
  return true
}

/** 当前有哪些快照，给 `persona_revert` 列表用。 */
export function listVersions(p) {
  if (!existsSync(p.versions)) return []
  const out = []
  try {
    for (const name of readdirSync(p.versions)) {
      const m = /^patch-v(\d+)\.md$/.exec(name)
      if (m) out.push(Number(m[1]))
    }
  } catch { /* 目录读不了就当没有 */ }
  return out.sort((a, b) => a - b)
}
