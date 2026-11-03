/**
 * 检索层：切词 + BM25 打分。
 *
 * 抄自 `dsh-meow-memory` 的 `src/bm25.ts`（2026-11-03 读的，v0.32.5）。
 * 只留两样：分词、BM25 打分。它那套 SQLite 库、艾宾浩斯衰减、余弦偏离检测都没抄——
 * 记忆池在我这边是 md 文件，一条账进另一个库就成了第二本账。
 *
 * 为什么需要它：原来的 `recall()` 用 `text.includes(query)` 过滤——
 * 要求整串连续出现，且命中后层内仍按字数排。中文多词查询会漏，也不知道谁更相关。
 *
 * 分工：
 *   - CJK（汉字/假名）：连续段切相邻 bigram（单字不成词，防噪音）
 *   - 字母/数字：连续段整词、小写
 *   - 标点/符号/emoji：丢（信息量为零，只会稀释 IDF）
 *   - 先 NFKC 归一化（全角 ＢＭ２５ → bm25），Array.from 按码点迭代，不切半个 emoji
 */

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3005\u30fc]/u
const WORD = /[\p{L}\p{N}]/u

/** 英语功能词。中文不需要停用词表——bigram 已经自带过滤。 */
const EN_STOP = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'cannot', 'could', 'd', 'did', 'do', 'does', 'doing', 'don', 'down', 'during',
  'each', 'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers',
  'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself',
  'just', 'll', 'm', 'me', 'more', 'most', 'my', 'myself', 'no', 'nor', 'not', 'now',
  'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
  're', 's', 'same', 'she', 'should', 'so', 'some', 'such', 't', 'than', 'that', 'the', 'their', 'theirs',
  'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too',
  'under', 'until', 'up', 've', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while',
  'who', 'whom', 'why', 'will', 'with', 'would', 'you', 'your', 'yours', 'yourself', 'yourselves',
])

function classify(cp) {
  if (CJK.test(cp)) return 'cjk'
  if (WORD.test(cp)) return 'word'
  return 'skip'
}

/**
 * 切词。query 和文档必须走同一套，否则命中不了。
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  const cps = Array.from(String(text ?? '').normalize('NFKC'))
  const out = []
  let i = 0
  while (i < cps.length) {
    const cls = classify(cps[i])
    if (cls === 'skip') {
      i += 1
      continue
    }
    let j = i + 1
    while (j < cps.length && classify(cps[j]) === cls) j += 1
    const run = cps.slice(i, j)
    if (cls === 'cjk') {
      // 连续 CJK → 相邻 bigram；单字不成词，丢掉（否则「的/了/是」这类会拉高噪音）
      if (run.length >= 2) {
        for (let k = 0; k + 1 < run.length; k += 1) out.push(run[k] + run[k + 1])
      }
    } else {
      const w = run.join('').toLowerCase()
      if (!EN_STOP.has(w)) out.push(w)
    }
    i = j
  }
  return out
}

/**
 * BM25（k1=1.5, b=0.75）。返回 Map<key, score>，分数 ≤ 0 的不放进结果。
 *
 * 不乘时间衰减：池子那边已有 mtime / 加固分在管先后，这里只回答「谁跟这个词更相关」。
 * 两套权重叠在一起，就说不清是谁在起作用了。
 *
 * @param {string} query
 * @param {{key: string, text: string}[]} docs
 * @returns {Map<string, number>}
 */
export function rank(query, docs) {
  const q = tokenize(query)
  const out = new Map()
  if (!q.length || !docs.length) return out

  const n = docs.length
  const docToks = docs.map((d) => tokenize(d.text))
  const avgdl = docToks.reduce((s, t) => s + t.length, 0) / n || 1

  const df = new Map()
  const tfs = []
  for (const toks of docToks) {
    const m = new Map()
    const seen = new Set()
    for (const t of toks) {
      m.set(t, (m.get(t) ?? 0) + 1)
      if (!seen.has(t)) {
        seen.add(t)
        df.set(t, (df.get(t) ?? 0) + 1)
      }
    }
    tfs.push(m)
  }

  const k1 = 1.5
  const b = 0.75
  for (let di = 0; di < docs.length; di += 1) {
    let s = 0
    const len = docToks[di].length
    for (const term of q) {
      const f = tfs[di].get(term)
      if (!f) continue
      const d = df.get(term) ?? 0
      const idf = Math.log(1 + (n - d + 0.5) / (d + 0.5))
      s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * len) / avgdl)))
    }
    if (s > 0) out.set(docs[di].key, s)
  }
  return out
}
