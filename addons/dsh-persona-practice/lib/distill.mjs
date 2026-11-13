// 蒸馏：机械模仿。
// 判据不是「我理解了这种语气」，是「照着量出来的那几个数，能一字一句地仿出来」。
// 只数可数的：句长、括号动作、句尾语气词、口头禅。数不出的不判。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const DISTILL = {
  dir: '.persona-framework',
  file: '蒸馏档案.json',
  samplesFile: '蒸馏样本.jsonl',
  maxSamples: 400,
}

export const PARTICLES = ['呢', '吧', '啊', '哦', '呀', '嘛', '啦']
const SPLIT = /[。！？!?\n]+/

export const nowISO = (now = Date.now()) => new Date(now).toISOString()

const dirOf = (ws, opts = {}) => join(ws || process.cwd(), opts.dir || DISTILL.dir)

function ensure(ws, opts) {
  const dir = dirOf(ws, opts)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

const sentences = (text) =>
  String(text || '')
    .split(SPLIT)
    .map((s) => s.trim())
    .filter(Boolean)

/** 数出来的一副口音：只记能被重复出来的那几样。 */
export function distill(samples = []) {
  const lines = samples.map((s) => String(s || '').trim()).filter(Boolean).slice(0, DISTILL.maxSamples)
  const all = lines.flatMap(sentences)
  if (!all.length) return { ok: false, why: '没有样本，蒸馏不出东西' }

  const lens = all.map((s) => s.length)
  const avgLen = Number((lens.reduce((a, b) => a + b, 0) / lens.length).toFixed(1))
  const short = lens.filter((n) => n <= 12).length / lens.length
  const parens = lines.filter((s) => /（[^）]{1,40}）|\([^)]{1,40}\)/.test(s)).length / lines.length
  const tally = {}
  for (const p of PARTICLES) {
    const n = all.filter((s) => s.replace(/[（(][^）)]*[）)]/g, '').includes(p)).length
    if (n) tally[p] = Number((n / all.length).toFixed(3))
  }
  const tics = {}
  for (const s of all) {
    for (const m of s.matchAll(/([\u4e00-\u9fa5]{2})(?=，|。|$)/g)) {
      const w = m[1]
      tics[w] = (tics[w] || 0) + 1
    }
  }
  const top = Object.entries(tics).sort((a, b) => b[1] - a[1]).slice(0, 6)
  return {
    ok: true,
    at: nowISO(),
    samples: lines.length,
    sentences: all.length,
    avgLen,
    shortRatio: Number(short.toFixed(2)),
    parensPerLine: Number(parens.toFixed(2)),
    particles: tally,
    tics: top,
  }
}

export const saveProfile = (ws, profile, opts = {}) => {
  ensure(ws, opts)
  writeFileSync(join(dirOf(ws, opts), opts.file || DISTILL.file), JSON.stringify(profile, null, 2))
  return { ok: true }
}

export function loadProfile(ws, opts = {}) {
  const p = join(dirOf(ws, opts), opts.file || DISTILL.file)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
}

/**
 * 机械模仿：把一个中性句子按档案里的数改一遍。
 * 只做三件可数的事——砍短、补句尾语气词、加一个括号动作。不生成新意思。
 */
export function imitate(profile, content, opts = {}) {
  const src = String(content || '').trim()
  if (!src) return { ok: false, why: '没有要模仿的那句话' }
  if (!profile || !profile.ok) return { ok: false, why: '还没有档案，先蒸馏一次' }

  const parts = sentences(src)
  const keep = Math.max(1, Math.round(profile.avgLen ? Math.min(parts.length, 2) : 1))
  let out = parts.slice(0, keep).join('，')
  if (profile.shortRatio > 0.4) out = out.split('，')[0]

  const par = Object.entries(profile.particles || {}).sort((a, b) => b[1] - a[1])[0]
  if (par && !PARTICLES.some((x) => out.endsWith(x))) out += par[0]

  if ((profile.parensPerLine || 0) > 0.2) {
    const act = opts.action ? String(opts.action) : '把话在嘴里过了一遍'
    out += `（${act}）`
  }
  return { ok: true, line: out, from: src, profileAt: profile.at }
}

export function renderProfile(p) {
  if (!p || !p.ok) return ''
  const parts = Object.entries(p.particles || {})
    .map(([k, v]) => `${k}${v}`)
    .join(' ')
  const tics = (p.tics || []).map(([w, n]) => `${w}×${n}`).join(' ')
  return [
    `口音档案：${p.samples} 条样本 / ${p.sentences} 句（${p.at}）`,
    `句长均值 ${p.avgLen}｜短句比 ${p.shortRatio}｜括号动作 ${p.parensPerLine} 行`,
    parts ? `句尾语气 ${parts}` : '',
    tics ? `口头禅 ${tics}` : '',
  ].filter(Boolean).join('\n')
}
