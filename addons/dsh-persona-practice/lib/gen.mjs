// 生成：字级 n-gram，零依赖。
// 判据不是「像不像人写的」，是「拿同一批语料训练，能生成没见过、但口音一致的句子」。
// 两条硬规矩：①不能整句照抄训练样本；②该在句号处停就停。

const END = /[。！？!?]/
const PUNCT = /[。，！？、；：,.!?;:]/

export const GEN = {
  order: 3,
  maxChars: 60,
  temperature: 1.0,
  minStop: 8,
  copyRun: 5,
}

export function trainLM(samples = [], opts = {}) {
  const order = Math.max(2, Math.min(4, opts.order || GEN.order))
  const lines = samples.map((s) => String(s || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (!lines.length) return { ok: false, why: '没有样本，训练不出东西' }
  const tables = []
  const starts = new Map()
  for (let k = 1; k <= order; k++) tables.push(new Map())
  for (const line of lines) {
    const s = line + '。'
    if (s.length < 2) continue
    starts.set(s[0], (starts.get(s[0]) || 0) + 1)
    for (let i = 0; i < s.length - 1; i++) {
      const ch = s[i + 1]
      for (let k = 1; k <= order; k++) {
        if (i - k + 1 < 0) break
        const ctx = s.slice(i - k + 1, i + 1)
        const table = tables[k - 1]
        if (!table.has(ctx)) table.set(ctx, new Map())
        const bucket = table.get(ctx)
        bucket.set(ch, (bucket.get(ch) || 0) + 1)
      }
    }
  }
  const grams = new Set()
  for (const line of lines) { const t = line + '。'; for (let i = 0; i + 8 <= t.length; i++) grams.add(t.slice(i, i + 8)) }
  return { ok: true, order, tables, starts, grams, samples: lines.length, chars: lines.join('').length, lines }
}

function pick(bucket, temperature, exclude, ban) {
  const entries = [...bucket.entries()].filter(([ch]) => (!exclude || ch !== exclude) && (!ban || !ban.has(ch)))
  if (!entries.length) return null
  const t = Math.max(0.3, Math.min(2, temperature || 1))
  const weights = entries.map(([, n]) => Math.pow(n, 1 / t))
  const sum = weights.reduce((a, b) => a + b, 0)
  let r = Math.random() * sum
  for (let i = 0; i < entries.length; i++) {
    r -= weights[i]
    if (r <= 0) return entries[i][0]
  }
  return entries[entries.length - 1][0]
}

const topOf = (bucket) => {
  let best = null
  let n = -1
  for (const [ch, c] of bucket) if (c > n) { n = c; best = ch }
  return best
}

export function generate(model, opts = {}) {
  if (!model || !model.ok) return { ok: false, why: '还没有训练好的表' }
  const maxChars = Math.max(12, Math.min(200, opts.maxChars || GEN.maxChars))
  const temperature = opts.temperature || GEN.temperature
  const starts = [...model.starts.keys()]
  if (!starts.length) return { ok: false, why: '没记下开头，生不出句子' }

  let out = opts.seed ? String(opts.seed) : starts[Math.floor(Math.random() * starts.length)]
  let run = 0
  for (let step = 0; step < maxChars * 3 && out.length < maxChars; step++) {
    let bucket = null
    let ctx = ''
    for (let k = model.order; k >= 1; k--) {
      if (out.length < k) continue
      const c = out.slice(-k)
      const t = model.tables[k - 1].get(c)
      if (t && t.size) { bucket = t; ctx = c; break }
    }
    if (!bucket) break
    const top = topOf(bucket)
    // 连击 top-1 太久 = 在照抄样本，强制换一支
    const near = ctx && out.length
    if (top && out[out.length - 1] === top) run += 1
    else run = 0
    let ban = null
    if (model.grams && out.length >= 7) {
      const tail = out.slice(-7)
      for (const [c] of bucket) { if (model.grams.has(tail + c)) { ban = ban || new Set(); ban.add(c) } }
    }
    const chAll = ban && ban.size < bucket.size ? pick(bucket, temperature, null, ban) : pick(bucket, temperature, run >= GEN.copyRun ? top : null)
    const ch = chAll
    if (!ch) break
    out += ch
    if (END.test(ch) && out.length >= GEN.minStop) break
  }

  out = out.replace(/[。，]{2,}/g, '。').replace(/^[，。]+/, '')
  if (!END.test(out[out.length - 1] || '')) out += '。'
  return { ok: true, line: out, chars: out.length }
}

/** 训练样本里逐字出现过的句子不算生成，换温度重来；三次不成就不交。 */
const bare = (t) => String(t || '').replace(/[。！？!?，,]/g, '')
export function notCopy(line, lines = []) {
  const s = bare(line)
  if (s.length < 6) return false
  return !lines.some((x) => { const b = bare(x); return b.length > 4 && (b.includes(s) || s.includes(b)) })
}
export function recombine(lines = []) {
  if (lines.length < 2) return null
  const clauses = (t) => String(t || '').match(/[^，。！？、；：]+[，。！？、；：]?/g) || []
  const pickOne = () => clauses(lines[Math.floor(Math.random() * lines.length)])
  const a = pickOne(), b = pickOne()
  if (a.length + b.length < 3) return null
  const head = a.slice(0, Math.max(1, Math.floor(a.length / 2))).join('').replace(/[，、；：]$/, '')
  const tail = b.slice(Math.floor(b.length / 2)).join('').replace(/^[，、；：]/, '')
  if (!head || !tail) return null
  let out = (head + '，' + tail).replace(/[，、；：]{2,}/g, '，').replace(/[。！？]{2,}/g, '。').replace(/，。/g, '。')
  out = out.replace(/^[，。]/, '')
  return /[。！？!?]$/.test(out) ? out : out + '。'
}

export function generateFresh(model, opts = {}) {
  for (let i = 0; i < 6; i++) {
    const r = generate(model, { ...opts, temperature: (opts.temperature || 1) + i * 0.15 })
    if (r.ok && notCopy(r.line, model.lines) && r.line.length >= 6) return r
  }
  for (let i = 0; i < 8; i++) {
    const r = recombine(model.lines)
    if (r && notCopy(r, model.lines) && r.length >= 6) return { ok: true, line: r, chars: r.length, how: 'recombine' }
  }
  const last = generate(model, opts)
  return last.ok ? { ...last, how: 'fallback' } : { ok: false, why: last.why || '没能生成' }
}

export function imitatePassage(samples = [], opts = {}) {
  const model = trainLM(samples, { order: opts.order })
  if (!model.ok) return model
  const count = Math.max(1, Math.min(8, opts.count || 3))
  const seen = new Set()
  const lines = []
  for (let i = 0; i < count * 3 && lines.length < count; i++) {
    const r = generateFresh(model, { maxChars: opts.maxChars, temperature: opts.temperature })
    if (!r.ok) continue
    if (seen.has(r.line)) continue
    seen.add(r.line)
    lines.push(r.line)
  }
  return { ok: lines.length > 0, lines, model: { samples: model.samples, chars: model.chars, order: model.order } }
}

export function renderPassage(res, opts = {}) {
  if (!res || !res.ok) return res && res.why ? `生不出：${res.why}` : '生不出：没有样本'
  const head = `生成了 ${res.lines.length} 条（训练：${res.model.samples} 条 / ${res.model.chars} 字 / ${res.model.order} 阶）`
  return [head, ...res.lines.map((l, i) => `${i + 1}. ${l}`)].join('\n')
}
