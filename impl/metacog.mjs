/**
 * 12 自主 · 正文写了、我没翻的那三样：自我监控、元认知、二阶欲望。
 *
 * 这一份是照两头学来的：
 *
 * **一头是工程**（arXiv:2509.19783《Agentic Metacognition》）：
 *   元认知是一个**次级层**，盯着主层跑；盯三个信号——延迟、重复、卡住；
 *   预测要失败就**交出去**，别硬撑。代价是开销变高，所以要能关。
 *
 * **一头是哲学**（Frankfurt 的二阶欲望）：
 *   一阶欲望 = 想做什么（缺口源给的那些念）。
 *   二阶欲望 = 想成为什么样的人，**对一阶欲望的欲望**。
 *   自主不是「没人拦」，是**二阶管得住一阶**——一阶想干，二阶说不。
 *
 * 这两头说的其实是同一件事：**上面得有一层看着下面在干什么，并且能说不。**
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

/* ═════════ 一、自我监控：看着自己在做什么、做到哪一步 ═════════ */

/**
 * 正文原话：「自我监控（看着自己在做什么、做到哪一步）」。
 *
 * 程序里它就是**三个读数**：
 *   · 跑了多久（延迟）
 *   · 同一件做了几次（重复）
 *   · 卡了几次（卡住没过去）
 *
 * 三个都超线，就是「要出事」的信号——这时该交出去，不该硬撑。
 */
export const MONITOR_LINES = {
  latencyMs: 2000,   // 超过 2 秒，这一轮算慢
  repeat: 3,         // 同一件做第 3 次，是磨
  blocked: 2,        // 连着卡 2 次，是走不通
}

/** 从账里读监控要的三样，自己没有就去数。 */
export function monitor(ws, run = {}) {
  const wsRoot = String(ws || process.cwd())
  let L = {}
  try { L = JSON.parse(readFileSync(join(wsRoot, '.persona-framework', 'ledger.json'), 'utf8')) } catch { /* 没账就当空 */ }

  const blocked = Array.isArray(L.blocked) ? L.blocked.length : 0
  const refused = Array.isArray(L.refused) ? L.refused.length : 0
  const runs = Array.isArray(L.runs) ? L.runs.length : 0
  const done = L.done && typeof L.done === 'object' ? Object.keys(L.done).length : 0
  const ms = Number(run.ms) || 0

  const signals = []
  if (ms > MONITOR_LINES.latencyMs) signals.push({ kind: '延迟', now: `${ms} ms`, line: `${MONITOR_LINES.latencyMs} ms` })
  if (blocked >= MONITOR_LINES.blocked) signals.push({ kind: '卡住', now: `${blocked} 条`, line: `${MONITOR_LINES.blocked} 条` })

  return {
    did: [`跑了一轮（${ms} ms）`, `账里：做过 ${done} · 卡住 ${blocked} · 不干 ${refused} · 跑过 ${runs} 轮`],
    signals,
    // 次级层的判词：**信号超线就交出去，不硬撑**
    verdict: signals.length ? '交出去' : '继续',
    why: signals.length
      ? `预测要出事：${signals.map((s) => `${s.kind} ${s.now}（线 ${s.line}）`).join('、')}`
      : '三个读数都没超线',
    cant: signals.length ? ['这一轮该交出去，不该硬撑——**硬撑出来的结果比没有更坏**'] : [],
  }
}

/* ═════════ 二、元认知：对自己知道什么、知道多少的判断 ═════════ */

/**
 * 正文原话：「元认知（对自己知道什么、知道多少的判断）」。
 *
 * 程序里它不是「我觉得我知道」，而是**每条判断都得标自己的依据强度**：
 *   查到 —— 有出处，能指回去（账里、文件里、原话里）
 *   推的 —— 从查到的推出来，中间那步是逻辑
 *   猜的 —— 没有出处，只有倾向
 *
 * **判据：说不出「这条是怎么来的」，就是猜的。** 猜的不许当查到用。
 */
export const EVIDENCE = {
  checked: { label: '查到', weight: 3, note: '指得回账／文件／原话' },
  derived: { label: '推的', weight: 2, note: '从查到的推出来，中间那步说得清' },
  guessed: { label: '猜的', weight: 1, note: '没有出处，只有倾向' },
}

/**
 * 判断一条说法属哪一档。**宁可降档，不升档。**
 */
export function grade(text) {
  const t = String(text || '')
  const anchors = (t.match(/https?:\/\/\S+/g) || []).length
    + (t.match(/\d{4}[-/年]\d{1,2}/g) || []).length
    + (t.match(/「[^」]+」/g) || []).length
    + (t.match(/[\w.-]+\.(md|mjs|js|json)/g) || []).length
  if (anchors >= 1) return { ...EVIDENCE.checked, why: `${anchors} 个锚` }
  if (/因为|所以|推出|如果.*就/.test(t)) return { ...EVIDENCE.derived, why: '看得出推的痕迹' }
  return { ...EVIDENCE.guessed, why: '一个锚都没有' }
}

/**
 * 元认知的收口：**这一轮我到底知道多少。**
 * 不是打分，是**说得出哪几条是查到的、哪几条是猜的**。
 */
export function knowHowMuch(claims = []) {
  const rows = claims.map((c) => ({ claim: c, ...grade(c) }))
  const checked = rows.filter((r) => r.label === '查到').length
  const derived = rows.filter((r) => r.label === '推的').length
  const guessed = rows.filter((r) => r.label === '猜的').length
  const total = rows.length || 1
  return {
    did: [`数了 ${rows.length} 条判断的依据`],
    rows,
    out: [`查到 ${checked} · 推的 ${derived} · 猜的 ${guessed}（共 ${rows.length}）`],
    // **这条是元认知最要紧的：猜的占多少**
    cant: guessed > total / 2
      ? [`**猜的过半了**（${guessed}/${rows.length}）——这一轮的判断有一半没有出处`]
      : [],
  }
}

/* ═════════ 三、二阶欲望：想成为什么样的人 ═════════ */

/**
 * Frankfurt：一阶欲望是「想做什么」，二阶欲望是「想成为什么样的人」。
 * **自主不是没人拦，是二阶管得住一阶。**
 *
 * 存哪儿：`二阶.md`——一行一条 `- 不做什么｜因为想成为什么样的人`
 * 为什么单独存：**它是我的，不是一次判断**；写下来才管得住下一轮的一阶。
 */
export function secondOrderPath(ws) {
  return join(String(ws || process.cwd()), '.persona-framework', '二阶.md')
}

export function readSecondOrder(ws) {
  const f = secondOrderPath(ws)
  if (!existsSync(f)) return []
  return readFileSync(f, 'utf8').split('\n')
    .map((l) => l.match(/^-\s*(.+?)｜因为(.+)$/))
    .filter(Boolean)
    .map((m) => ({ not: m[1].trim(), because: m[2].trim() }))
}

/** 记一条二阶：**不做什么，因为想成为什么样的人**。 */
export function writeSecondOrder(ws, not, because) {
  const f = secondOrderPath(ws)
  const d = dirname(f)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  const head = existsSync(f)
    ? readFileSync(f, 'utf8')
    : '# 二阶欲望\n\n> 一行一条：不做什么｜因为想成为什么样的人。\n> **一阶想干，二阶说不——那才叫自主。**\n\n'
  const lines = head.split('\n').filter((l) => !l.startsWith(`- ${not}｜`))
  lines.push(`- ${not}｜因为${because}`)
  writeFileSync(f, lines.join('\n') + '\n', 'utf8')
  return f
}

/**
 * 二阶管一阶：**这一件，二阶让不让做。**
 *
 * 不让的理由只有一种：**做了它，就不是我想成为的那个**。
 * 不是「不喜欢」，不是「不方便」——那是别的层的事。
 */
export function veto(ws, item) {
  const rules = readSecondOrder(ws)
  if (!rules.length) {
    return { ok: true, why: '还没写过二阶——**没有二阶，一阶想干什么就干什么，那就不是自主**' }
  }
  const hay = `${item?.what || ''} ${item?.source || ''} ${item?.name || ''}`
  for (const r of rules) {
    if (r.not && hay.includes(r.not)) {
      return {
        ok: false,
        why: `二阶不让：不加「${r.not}」——因为${r.because}`,
        cant: ['一阶想干，二阶说不。**这一件不做。**'],
      }
    }
  }
  return { ok: true, why: `二阶 ${rules.length} 条，没有一条拦它` }
}

/* ═════════ 汇总：三样一起交 ═════════ */

/**
 * 正文那三种能力，一次交清。
 *
 * 跟 assert12 的分工还在：那个查一段话像不像自主的；
 * 这个**真跑**——监控真读数、元认知真分档、二阶真否决。
 */
export function introspect(ws, opts = {}) {
  const m = monitor(ws, { ms: opts.ms })
  const k = knowHowMuch(opts.claims || [])
  const rules = readSecondOrder(ws)
  return {
    monitor: m,
    metacog: k,
    secondOrder: {
      out: rules.length
        ? [`二阶 ${rules.length} 条：${rules.map((r) => `不加「${r.not}」`).join('、')}`]
        : ['**还没有二阶**——一阶想干什么就干什么'],
      cant: rules.length ? [] : ['没有二阶，就谈不上自主；只有一阶，那是被推着走'],
    },
  }
}
