// 抄自 @kenz1117/dsh-engram 0.13.10 的两样：RRF 融合检索、巩固蒸馏（含 SM-2 复习与衰减）。
// 抄的是算法形状，不是它的 SQLite/嵌入模型：这里的「向量道」是词袋向量（本地、零依赖），
// 只保证「同义词不命中时，语义相近的也能浮上来」这一层意思，不假装是模型嵌入。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

export const RRF_K = 60
export const MIN_COSINE = 0.2
export const CONTRADICTION_COSINE = 0.88
export const RANK_POOL = 64
export const CONFIDENCE_BUMP = 0.05
export const OUTCOME_PENALTY = 0.1
export const REVIEW = { firstDays: 1, secondDays: 6, ease: 2.5, minEase: 1.3 }
export const FUSION = {
  dir: '.persona-framework',
  beliefFile: '信念账.jsonl',
  reviewFile: '复习账.json',
  decayHalfLifeDays: 30,
  minSupport: 2,
  maxBeliefs: 40,
}

const pad = (n) => String(n).padStart(2, '0')
export function nowISO(now = Date.now()) {
  const d = new Date(now)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
export const DAY_MS = 86400000

export function fusionDir(ws, opts = {}) {
  return join(ws || process.cwd(), opts.dir || FUSION.dir)
}

// ── 词袋向量（零依赖的「语义道」替身） ──
export function terms(text) {
  const s = String(text || '').toLowerCase()
  const out = new Set()
  for (const w of s.match(/[a-z0-9_]{2,}/g) || []) out.add(w)
  const cjk = s.replace(/[^\u4e00-\u9fa5]/g, ' ')
  for (const run of cjk.split(/\s+/)) {
    if (run.length === 1) out.add(run)
    for (let i = 0; i < run.length - 1; i++) out.add(run.slice(i, i + 2))
  }
  return out
}
function vec(text, idf) {
  const t = terms(text)
  const v = new Map()
  let norm = 0
  for (const term of t) {
    const w = idf.get(term) || 1
    v.set(term, w)
    norm += w * w
  }
  return { v, norm: Math.sqrt(norm) || 1 }
}
export function cosine(a, b) {
  const [x, y] = a.v.size <= b.v.size ? [a, b] : [b, a]
  let dot = 0
  for (const [t, w] of x.v) if (y.v.has(t)) dot += w * y.v.get(t)
  return dot / (a.norm * y.norm)
}

/** 构建语料索引：每条 doc = { pointer, title, text } */
export function indexCorpus(docs) {
  const df = new Map()
  const toks = docs.map((d) => [d, terms(`${d.title || ''} ${d.text || ''}`)])
  for (const [, t] of toks) for (const term of t) df.set(term, (df.get(term) || 0) + 1)
  const n = docs.length || 1
  const idf = new Map()
  for (const [term, c] of df) idf.set(term, Math.log(1 + n / (1 + c)))
  const vectors = toks.map(([, t]) => vec([...t].join(' '), idf))
  return { docs, idf, vectors }
}

/** 关键词道：按 idf 加权命中数排序，最多 RANK_POOL 条 */
export function keywordLane(index, query, pool = RANK_POOL) {
  const q = terms(query)
  const hits = []
  index.docs.forEach((d, i) => {
    let score = 0
    for (const term of q) if (index.vectors[i].v.has(term)) score += index.idf.get(term) || 1
    if (score > 0) hits.push({ id: d.pointer, score, doc: d })
  })
  return hits.sort((a, b) => b.score - a.score).slice(0, pool)
}

/** 向量道：词袋余弦，低于 MIN_COSINE 不参与排序（照 engram 的语义门槛） */
export function vectorLane(index, query, pool = RANK_POOL) {
  const qv = vec(query, index.idf)
  const hits = []
  index.docs.forEach((d, i) => {
    const c = cosine(qv, index.vectors[i])
    if (c >= MIN_COSINE) hits.push({ id: d.pointer, score: c, doc: d })
  })
  return hits.sort((a, b) => b.score - a.score).slice(0, pool)
}

/**
 * RRF 融合：每个结果内按名次贡献 1/(rank+1+K) 分，同 id 累加；
 * 稳定排序（融合分 → 首次名次 → 首次道序号）；每道保底前 min(perQueryKeep, limit/道数) 名。
 */
export function fuseResults(lanes, { k = RRF_K, limit = 8, minPerQuery = 1 } = {}) {
  const entries = new Map()
  lanes.forEach((hits, laneIndex) => {
    hits.forEach((hit, rank) => {
      const add = 1 / (rank + 1 + k)
      const cur = entries.get(hit.id)
      if (!cur) {
        entries.set(hit.id, { id: hit.id, doc: hit.doc, score: add, firstRank: rank, firstLane: laneIndex, lanes: [laneIndex] })
        return
      }
      cur.score += add
      cur.firstRank = Math.min(cur.firstRank, rank)
      cur.firstLane = Math.min(cur.firstLane, laneIndex)
      if (!cur.lanes.includes(laneIndex)) cur.lanes.push(laneIndex)
      if (hit.score > (cur.best || 0)) cur.best = hit.score
    })
  })
  const ranked = [...entries.values()].sort((a, b) => b.score - a.score || a.firstRank - b.firstRank || a.firstLane - b.firstLane)
  const perQueryKeep = Math.min(minPerQuery, Math.max(1, Math.floor(limit / Math.max(1, lanes.length))))
  const reserved = new Set(lanes.flatMap((hits) => hits.slice(0, perQueryKeep).map((h) => h.id)))
  return [...ranked.filter((e) => reserved.has(e.id)), ...ranked.filter((e) => !reserved.has(e.id))].slice(0, Math.max(0, limit))
}

export function renderFused(rows, { query, lanes = 2 } = {}) {
  if (!rows.length) return `融合检索：没有命中（查询「${query || ''}」）`
  const head = `融合检索：${rows.length} 条（RRF K=${RRF_K}，${lanes} 道）`
  return [head, ...rows.map((r, i) => `${i + 1}. ${r.doc?.title || r.id}｜融合分 ${r.score.toFixed(4)}｜命中道 ${r.lanes.map((x) => (x === 0 ? '关键词' : '向量')).join('+')}｜${r.id}`)].join('\n')
}

// ── SM-2 复习（照 engram 的 intervalDays 规则） ──
export function reviewNext(state = {}, grade = 'good', now = Date.now()) {
  const ease0 = Number(state.easeFactor || REVIEW.ease)
  let ease = ease0
  let reps = Number(state.reps || 0)
  let intervalDays = Number(state.intervalDays || 0)
  const g = String(grade || 'good').toLowerCase()
  if (g === 'again') {
    reps = 0
    intervalDays = REVIEW.firstDays
    ease = Math.max(REVIEW.minEase, ease - 0.2)
  } else {
    reps += 1
    if (g === 'hard') ease = Math.max(REVIEW.minEase, ease - 0.15)
    else if (g === 'easy') ease = ease + 0.15
    intervalDays = reps === 1 ? REVIEW.firstDays : reps === 2 ? REVIEW.secondDays : Math.max(1, Math.round((intervalDays || REVIEW.secondDays) * ease))
  }
  return { easeFactor: Number(ease.toFixed(2)), reps, intervalDays, nextReviewAt: now + intervalDays * DAY_MS, lastGrade: g, at: nowISO(now) }
}
export function reviewDue(state, now = Date.now()) {
  return !state || !state.nextReviewAt || state.nextReviewAt <= now
}

// ── 衰减：半衰期权重 ──
export function decayWeight(ageMs, halfLifeDays = FUSION.decayHalfLifeDays) {
  const hl = Math.max(0.1, halfLifeDays) * DAY_MS
  return Math.pow(0.5, Math.max(0, ageMs) / hl)
}

// ── 置信度：只有「真实反馈」才动，检索曝光不算（照 engram 的 CONFIDENCE_BUMP 注释） ──
export function confidenceOf(entry = {}, outcome) {
  const base = Number(entry.confidence == null ? 0.5 : entry.confidence)
  if (outcome === 'success') return Math.min(1, Number((base + CONFIDENCE_BUMP).toFixed(2)))
  if (outcome === 'failure') return Math.max(0, Number((base - OUTCOME_PENALTY).toFixed(2)))
  return base
}

// ── 巩固蒸馏：把多条记忆压成一条信念（form/refine/confirm/refute） ──
export function loadBeliefs(ws, opts = {}) {
  const p = join(fusionDir(ws, opts), opts.beliefFile || FUSION.beliefFile)
  if (!existsSync(p)) return []
  const out = []
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line)
      if (row && typeof row === 'object') out.push(row)
    } catch {}
  }
  return out
}
function saveBeliefs(ws, rows, opts = {}) {
  const dir = fusionDir(ws, opts)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const p = join(dir, opts.beliefFile || FUSION.beliefFile)
  writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
  return p
}

/**
 * 蒸馏：同一组来源里，共享词达到门槛的卡片合成一条信念候选；
 * 已有信念若来源被包含 → confirm；若被新证据覆盖同类词但来源不同 → refine；否则 form。
 * 一个字都不编：信念正文取最长那张卡的标题，来源 id 全部保留。
 */
export function consolidate(cards, beliefs = [], opts = {}) {
  const minSupport = opts.minSupport || FUSION.minSupport
  const groups = new Map()
  for (const card of cards) {
    for (const term of terms(`${card.title || ''} ${card.summary || ''}`)) {
      if (term.length < 2) continue
      const g = groups.get(term) || []
      g.push(card)
      groups.set(term, g)
    }
  }
  const candidates = []
  const seen = new Set()
  for (const [term, g] of groups) {
    if (g.length < minSupport) continue
    const ids = g.map((c) => c.pointer).sort()
    const key = ids.join('|')
    if (seen.has(key)) continue
    seen.add(key)
    const best = g.slice().sort((a, b) => (b.summary || '').length - (a.summary || '').length)[0]
    candidates.push({ term, belief: best.title || best.summary || term, sourceIds: ids, support: g.length })
  }
  candidates.sort((a, b) => b.support - a.support)
  const actions = []
  const out = beliefs.slice()
  for (const cand of candidates.slice(0, opts.maxBeliefs || FUSION.maxBeliefs)) {
    const hit = out.find((b) => b.status !== 'refuted' && (b.term === cand.term || cand.sourceIds.every((id) => (b.sourceIds || []).includes(id))))
    if (hit && cand.sourceIds.every((id) => (hit.sourceIds || []).includes(id))) {
      hit.confirmCount = (hit.confirmCount || 1) + 1
      hit.lastConfirmedAt = nowISO()
      actions.push({ action: 'confirm', id: hit.id, belief: hit.belief })
      continue
    }
    if (hit) {
      hit.status = 'refuted'
      hit.refutedAt = nowISO()
      actions.push({ action: 'refute', id: hit.id, belief: hit.belief })
      const id = 'b' + Math.random().toString(36).slice(2, 10)
      out.push({ id, action: 'refine', term: cand.term, belief: cand.belief, sourceIds: cand.sourceIds, confidence: 0.5, status: 'active', at: nowISO() })
      actions.push({ action: 'refine', id, belief: cand.belief })
      continue
    }
    const id = 'b' + Math.random().toString(36).slice(2, 10)
    out.push({ id, action: 'form', term: cand.term, belief: cand.belief, sourceIds: cand.sourceIds, confidence: 0.5, status: 'active', confirmCount: 1, at: nowISO() })
    actions.push({ action: 'form', id, belief: cand.belief })
  }
  return { beliefs: out, actions, cards: cards.length, candidates: candidates.length }
}

export function renderConsolidation(res) {
  const by = (k) => res.actions.filter((a) => a.action === k).length
  const head = `巩固蒸馏：扫 ${res.cards} 张卡、${res.candidates} 个候选 → 形成 ${by('form')}｜修订 ${by('refine')}｜确认 ${by('confirm')}｜推翻 ${by('refute')}`
  const tail = res.actions.slice(0, 6).map((a) => `- ${a.action}: ${a.belief}`)
  return [head, ...tail].join('\n')
}

export function saveConsolidation(ws, res, opts = {}) {
  return saveBeliefs(ws, res.beliefs, opts)
}

// ── 语料：把一棵目录里的文本文件走成「可检索的卡」 ──
export function walkFiles(root, { maxFiles = 400, maxDepth = 4 } = {}) {
  const out = []
  const skip = new Set(['node_modules', '.git', '_archive', '_quarantine', '.persona-framework'])
  const walk = (dir, depth) => {
    if (out.length >= maxFiles || depth > maxDepth) return
    let names = []
    try { names = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const ent of names) {
      if (out.length >= maxFiles) return
      if (skip.has(ent.name)) continue
      const p = join(dir, ent.name)
      if (ent.isDirectory()) walk(p, depth + 1)
      else if (/\.(md|jsonl|txt|json)$/i.test(ent.name)) out.push({ path: p, pointer: relative(root, p).replace(/\\/g, '/'), title: ent.name })
    }
  }
  walk(root, 0)
  return out
}

export function corpusFromFiles(paths, { perFileChars = 4000 } = {}) {
  const docs = []
  for (const e of paths) {
    try {
      const text = readFileSync(e.path, 'utf8').slice(0, perFileChars)
      const head = text.match(/^#\s+(.+)$/m)
      docs.push({ pointer: e.pointer, title: head ? head[1].trim() : e.title, text })
    } catch {}
  }
  return docs
}

/** 一次融合检索：传 root，返回 { rows, docs } */
export function fuseFromRoot(root, query, { limit = 8, maxFiles = 400 } = {}) {
  const docs = corpusFromFiles(walkFiles(root, { maxFiles }))
  const index = indexCorpus(docs)
  const rows = fuseResults([keywordLane(index, query), vectorLane(index, query)], { limit })
  return { rows, docs }
}
