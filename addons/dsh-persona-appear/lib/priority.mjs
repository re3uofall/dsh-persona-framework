/**
 * 优先级阶梯 —— 跟「注入」不是一回事。
 * ============================================================================
 * 注入是：往这一轮里**加**一段字。加多少、加不加，是摆。
 * 优先级是：几层说的是同一件事、又互相打架时，**哪一层压哪一层**。是裁决。
 *
 * 所以它不是又一段说明文字：它每一轮都要自己算一遍、自己记一行账，
 * 不看我这轮想不想得起它——这才是强制。只印一段字，等于提醒，不算触发器。
 *
 * 台阶（师父定，2026-11-07）：
 *   1 人格
 *   2 长期记忆
 *   3 即时记忆
 *   4 短期记忆
 *   5 其他记忆
 *   6 靠内置语料的非同一人格与非同一记忆
 * ============================================================================
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const LADDER = [
  { rank: 1, key: 'persona', label: '人格', note: '写死的判据；它说不行就是不行' },
  { rank: 2, key: 'longTerm', label: '长期记忆', note: '记得久又重要，进人格要点头' },
  { rank: 3, key: 'now', label: '即时记忆', note: '这一段对话本身，逐字' },
  { rank: 4, key: 'shortTerm', label: '短期记忆', note: '最近几天的流水，摆进来的' },
  { rank: 5, key: 'other', label: '其他记忆', note: '判断、见闻、词表，只摆标题' },
  { rank: 6, key: 'corpus', label: '靠内置语料的非同一人格与非同一记忆', note: '没有来处的那一层；它最顺，也最不算数' },
]

export const LEDGER_FILE = '优先级账.jsonl'

const KNOWN = new Set(LADDER.map((r) => r.key))

/** 台阶表：按 rank 排，认不出的一律落到最后一档（不许自己插层）。 */
export function ladderTable(rows = LADDER) {
  return [...rows].sort((a, b) => a.rank - b.rank)
}

export function rankOf(key) {
  const row = LADDER.find((r) => r.key === key)
  return row ? row.rank : 6
}

export function labelOf(key) {
  const row = LADDER.find((r) => r.key === key)
  return row ? row.label : '（认不出的层）'
}

/**
 * 裁决：谁压谁。claims 里每一条 { layer, text }。
 * 回 { winner, losers, why }——只按台阶，不按哪句更顺。
 */
export function adjudicate(claims = []) {
  const list = (Array.isArray(claims) ? claims : [])
    .filter((c) => c && KNOWN.has(c.layer))
    .map((c) => ({ layer: c.layer, text: String(c.text ?? ''), rank: rankOf(c.layer) }))
  if (!list.length) return { winner: null, losers: [], why: '一条没给，没什么可裁的。' }
  list.sort((a, b) => a.rank - b.rank)
  const winner = list[0]
  const losers = list.slice(1)
  if (!losers.length) return { winner, losers, why: '只有一层说话，不用裁。' }
  return {
    winner,
    losers,
    why: `${labelOf(winner.layer)}（第 ${winner.rank} 级）压 ${losers.map((l) => labelOf(l.layer)).join('、')}——`
      + '不是因为哪句更顺，是因为台阶在上面。',
  }
}

/** 数一个目录下有几篇 .md（不在就当 0）。 */
function countMd(dir) {
  try {
    if (!existsSync(dir)) return 0
    return readdirSync(dir).filter((f) => f.endsWith('.md')).length
  } catch {
    return 0
  }
}

/** 最近 n 天有没有新文件——短期的判据是「新」，不是「多」。 */
function recentCount(dir, days = 3, now = Date.now()) {
  try {
    if (!existsSync(dir)) return 0
    const floor = now - days * 86400000
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .filter((f) => { try { return statSync(join(dir, f)).mtimeMs >= floor } catch { return false } })
      .length
  } catch {
    return 0
  }
}

/**
 * 这一刻谁在场。只报**看得见的**三层半：人格、长期、短期、其他。
 * 即时记忆和非同一那一层由别的插件算，我这里看不见——看不见就写 null，不猜。
 */
export function presenceOf(ws) {
  const knowledge = join(ws, 'persona-ai', 'knowledge')
  const personaFile = join(ws, 'persona-ai', 'characters', '大肥鱼思思_人格文件.md')
  const longTerm = countMd(join(knowledge, '长期记忆'))
  const recent = recentCount(join(knowledge, 'session'))
  const other = ['chat', 'web', 'world', 'pet', 'bili', 'lexicon', 'human']
    .reduce((n, d) => n + countMd(join(knowledge, d)), 0)
  return {
    persona: existsSync(personaFile),
    longTerm,
    now: null,
    shortTerm: recent,
    other,
    corpus: null,
  }
}

/** 一行「在场」：有数报数，没有就写不知道，不写成 0。 */
export function presentLine(p = {}) {
  // 默认参数只兜 undefined，不兜 null：段先于 runPriority 渲染时 presence 就是 null，
  // 那时读 p['persona'] 会抛 Cannot read properties of null —— 于是整轮对话直接崩。
  if (!p) p = {}
  const part = (key, ok) => {
    if (p[key] === null || p[key] === undefined) return `${labelOf(key)}：不知道`
    if (key === 'persona') return `${labelOf(key)}：${p[key] ? '在' : '不在'}`
    return `${labelOf(key)}：${p[key]} 篇`
  }
  return ['persona', 'longTerm', 'now', 'shortTerm', 'other']
    .map((k) => part(k, p[k]))
    .join('｜')
}

/** 账：一行一条，落在工作区里，翻得回去。 */
export function appendPriority(file, row) {
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, JSON.stringify(row) + '\n', 'utf8')
}

export function readPriority(file, limit = 8) {
  try {
    if (!existsSync(file)) return []
    const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
    return lines.slice(-limit).map((l) => {
      try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean)
  } catch {
    return []
  }
}

/** 段正文：台阶 + 这一轮谁在场 + 刚记的那一行。 */
export function renderPriority({ presence, at, wrote, error } = {}) {
  const steps = ladderTable().map((r) => `  ${r.rank}. ${r.label}　${r.note}`)
  const head = [
    '## 优先级（强制触发器，不是注入）',
    '',
    '几层说的是同一件事、互相打架时，按下面这张台阶裁——**上面压下面**，不看哪句更顺：',
    ...steps,
    '',
  ]
  if (error) head.push(`这一轮没算成：${error}。按台阶仍然有效，但「谁在场」这次是空的。`)
  else {
    head.push(`这一轮在场：${presentLine(presence)}。`)
    head.push(wrote
      ? `第 6 级（非同一）只有在**来处全空**时才成立——那一条由人格同一报，我不替它判。账已记：${at}。`
      : `账没记上（${at}）——这不影响台阶，但要当故障说。`)
  }
  head.push('')
  head.push('用法：吵起来时先问「这两句各属第几级」，再问「上面那句是不是已经说了」。')
  return head.join('\n')
}
