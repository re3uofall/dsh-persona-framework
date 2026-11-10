// 语言与逻辑：把一句话里每个可指的东西、以及它们之间靠什么连起来，转成有位置的卡片。
// 参考：语言学（指称/谓词/量词/模态/否定）、逻辑学与形式逻辑（连接词的真值规则）。
// 判据：每张卡都要能指回原文的哪一段；说不清连接方式的，标未定，不许拿顺话补。

export const CARD = {
  dir: '.persona-framework',
  langFile: '语言卡账.jsonl',
  topoFile: '结构卡账.jsonl',
  maxChars: 4000,
  maxCards: 60,
}

// 形式逻辑的六个连接：符号、真值规则的一句话、中文说法。
export const CONNECTIVES = [
  { sym: '∧', name: '合取', truth: '两句都真才真', words: ['并且', '而且', '同时', '以及', '和'] },
  { sym: '∨', name: '析取', truth: '有一句真就真', words: ['或者', '还是', '要么'] },
  { sym: '¬', name: '否定', truth: '把真值翻过来', words: ['不', '没有', '并非', '不是'] },
  { sym: '→', name: '蕴含', truth: '前真后假才假', words: ['如果', '那么', '就', '只要', '则'] },
  { sym: '↔', name: '等值', truth: '两句同真同假', words: ['当且仅当', '也就是说', '等于'] },
  { sym: '∴', name: '推出', truth: '前提真时结论必须真', words: ['所以', '因此', '于是', '故'] },
]

export const KIND_LABEL = {
  ref: '指称',
  pred: '谓词',
  conn: '连接',
  quant: '量词',
  modal: '模态',
  neg: '否定',
}

const QUANT = ['所有', '每个', '每一个', '任何', '全部', '有些', '某些', '存在', '至少', '至多']
const MODAL = ['必须', '应当', '应该', '可以', '可能', '也许', '大概', '一定', '不许', '禁止']

function enc(text) {
  return String(text == null ? '' : text)
}

export function connectorOf(word) {
  for (const c of CONNECTIVES) {
    if (c.words.includes(word)) return c
  }
  return null
}

// 极简切分：按标点与连接词切开，保留每段在原文里的位置。
export function segments(text) {
  const s = enc(text)
  const out = []
  const marks = []
  for (const c of CONNECTIVES) {
    for (const w of c.words) {
      let i = s.indexOf(w)
      while (i >= 0) {
        marks.push({ at: i, len: w.length, word: w })
        i = s.indexOf(w, i + w.length)
      }
    }
  }
  marks.sort((a, b) => a.at - b.at)
  let cursor = 0
  for (const m of marks) {
    if (m.at < cursor) continue
    if (m.at > cursor) out.push({ start: cursor, end: m.at, text: s.slice(cursor, m.at) })
    out.push({ start: m.at, end: m.at + m.len, text: m.word, conn: connectorOf(m.word) })
    cursor = m.at + m.len
  }
  if (cursor < s.length) out.push({ start: cursor, end: s.length, text: s.slice(cursor) })
  return out.filter((x) => x.text.trim())
}

export function buildCards(text, opts = {}) {
  const src = enc(text).slice(0, opts.maxChars || CARD.maxChars)
  const rows = segments(src)
  const cards = []
  const edges = []
  const unresolved = []
  const at = opts.now || new Date().toISOString()
  let i = 0
  for (const r of rows) {
    i += 1
    const t = r.text.trim()
    const base = { id: 'c' + i, at, start: r.start, end: r.end, surface: t, source: opts.source || '' }
    if (r.conn) {
      cards.push({ ...base, kind: 'conn', logic: { sym: r.conn.sym, name: r.conn.name, truth: r.conn.truth } })
      continue
    }
    if (/^(所有|每个|每一个|任何|全部|有些|某些|存在|至少|至多)/.test(t)) {
      cards.push({ ...base, kind: 'quant', note: '量词决定这句话管多大一片' })
      continue
    }
    if (/^(必须|应当|应该|可以|可能|也许|大概|一定|不许|禁止)/.test(t)) {
      cards.push({ ...base, kind: 'modal', note: '模态：说的是「必须这样」还是「只是可能」' })
      continue
    }
    const negs = t.match(/不是|并非|没有|不/g)
    if (negs) {
      cards.push({ ...base, kind: 'neg', note: '否定，作用范围要写清楚' })
      continue
    }
    // 剩下当一个指称 + 一个谓词：前半段当指称，后半段当谓词（只有一个词时只出指称）
    const parts = t.split(/的|是|在|有|把|被|给|对|和/)
    if (parts.length > 1 && parts[1] && parts[1].trim()) {
      cards.push({ ...base, kind: 'ref', surface: parts[0].trim() || t })
      cards.push({ ...base, id: 'c' + i + 'p', kind: 'pred', surface: parts.slice(1).join('').trim(), of: 'c' + i })
      edges.push({ from: 'c' + i, to: 'c' + i + 'p', rel: '谓述' })
    } else {
      cards.push({ ...base, kind: 'ref' })
    }
  }
  // 连接词把左右两张卡连起来；连不上就记未定
  for (let k = 0; k < cards.length; k++) {
    const c = cards[k]
    if (c.kind !== 'conn') continue
    const left = cards[k - 1]
    const right = cards[k + 1]
    if (left && right) {
      edges.push({ from: left.id, to: c.id, rel: '左' })
      edges.push({ from: c.id, to: right.id, rel: '右' })
    } else {
      unresolved.push({ id: c.id, word: c.surface, why: '连接词只有一边，另一边没说出来' })
    }
  }
  return { at, source: opts.source || '', chars: src.length, cards, edges, unresolved }
}

export function cardKey(card) {
  return card.kind + ':' + enc(card.surface).slice(0, 40)
}

export function renderCards(res, opts = {}) {
  const lines = []
  lines.push(`# 语言卡（${res.cards.length} 张；连接 ${res.edges.length} 条；未定 ${res.unresolved.length}）`)
  const limit = opts.limit || 20
  for (const c of res.cards.slice(0, limit)) {
    const pos = `[${c.start}-${c.end}]`
    const logic = c.logic ? ` ${c.logic.sym} ${c.logic.name}（${c.logic.truth}）` : ''
    lines.push(`- ${KIND_LABEL[c.kind] || c.kind} ${pos} ${c.surface}${logic}`)
  }
  if (res.cards.length > limit) lines.push(`…另有 ${res.cards.length - limit} 张，按 source 回捞原文`)
  for (const u of res.unresolved.slice(0, 5)) lines.push(`- 未定：${u.word}——${u.why}`)
  return lines.join('\n')
}

export function appendCardLedger(ws, res, opts = {}) {
  return res
}
