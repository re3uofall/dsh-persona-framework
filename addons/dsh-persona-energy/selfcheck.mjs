#!/usr/bin/env node
// dsh-persona-energy · 自检
// ============================================================================
// 只测纯函数（lib/energy.mjs）。手跑：node selfcheck.mjs
// 全绿才算改完；只加功能不加自检等于没验收。
// ============================================================================
import {
  burnEffect,
  clamp01,
  compose,
  decay,
  describe,
  DEFAULT_STATE,
  EVENT_EFFECT,
  EVENT_KINDS,
  fmtPct,
  HALF_MIN,
  levelOf,
  phaseFactor,
  replay,
  SLOTS,
} from './lib/energy.mjs'
import {
  fmtPct01,
  fmtTokens,
  headline,
  NEVER_SKIMP,
  skimpVerdict,
  summarizeUsage,
  usageOfEvent,
} from './lib/cost.mjs'

let pass = 0
const fails = []

function ok(name, cond, detail) {
  if (cond) {
    pass += 1
    return
  }
  fails.push(`${name}${detail ? ` —— ${detail}` : ''}`)
}

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps

const NOW = Date.parse('2026-11-06T16:00:00+08:00')
const at = (minBefore) => new Date(NOW - minBefore * 60000).toISOString()

// ── 1. 夹具 ─────────────────────────────────────────────────────────────
ok('三个槽', SLOTS.length === 3)

// ── 2. clamp01 ──────────────────────────────────────────────────────────
ok('clamp01 上界', clamp01(1.7) === 1)
ok('clamp01 下界', clamp01(-0.3) === 0)
ok('clamp01 非数', clamp01('abc') === 0)

// ── 3. 衰减 ─────────────────────────────────────────────────────────────
ok('衰减一个半衰期正好一半', near(decay(1, HALF_MIN.atp, HALF_MIN.atp), 0.5))
ok('零分钟不衰减', decay(0.7, 0, 6) === 0.7)
ok('四个半衰期剩 1/16', near(decay(1, HALF_MIN.atp * 4, HALF_MIN.atp), 0.0625))
ok('衰减到不了负数', decay(1, 100000, 6) >= 0)
ok('一口气掉得比糖原快', decay(1, 60, HALF_MIN.atp) < decay(1, 60, HALF_MIN.glycogen))

// ── 4. 昼夜节律 ─────────────────────────────────────────────────────────
ok('14 点是峰', near(phaseFactor(14), 1))
ok('02 点是谷', near(phaseFactor(2), 0.85, 1e-12))
ok('节律不越界（全天扫一遍）', Array.from({ length: 24 }, (_, h) => phaseFactor(h)).every((v) => v >= 0.85 - 1e-12 && v <= 1 + 1e-12))
ok('节律跨零点连续', Math.abs(phaseFactor(23.9) - phaseFactor(0.1)) < 0.01)

// ── 5. 重放 ─────────────────────────────────────────────────────────────
const empty = replay([], NOW)
ok('空账＝默认值', SLOTS.every((k) => empty[k] === DEFAULT_STATE[k]))
ok('空账不衰减（一口气不会被算成空）', empty.atp > 0.5)

const justAte = replay([{ at: at(0), kind: 'meal' }], NOW)
ok('刚吃完一口气上去了', near(justAte.atp, 0.95))
ok('刚吃完糖原也上去', near(justAte.glycogen, 0.9))
ok('刚吃完储备不动', near(justAte.reserve, DEFAULT_STATE.reserve))
ok('槽不会超过 1', SLOTS.every((k) => justAte[k] <= 1))

const hourAgoAte = replay([{ at: at(60), kind: 'meal' }], NOW)
ok('一小时前吃的，一口气已经掉回来了', hourAgoAte.atp < 0.4)
ok('但糖原还高', hourAgoAte.glycogen > 0.8)
ok('所以拖后腿的是一口气', compose(hourAgoAte, NOW).limiting === 'atp')

const twoMeals = replay([{ at: at(120), kind: 'meal' }, { at: at(10), kind: 'meal' }], NOW)
ok('两笔都算进去了', twoMeals.glycogen > hourAgoAte.glycogen)
ok('乱序喂进去也能重放（先按时间排）', near(
  twoMeals.atp,
  replay([{ at: at(10), kind: 'meal' }, { at: at(120), kind: 'meal' }], NOW).atp,
))

const slept = replay([{ at: at(0), kind: 'sleep' }], NOW)
ok('睡一觉补储备', near(slept.reserve, 1))
ok('睡一觉不把糖原顶穿', slept.glycogen === 1)

const coffee = replay([{ at: at(0), kind: 'coffee' }], NOW)
ok('咖啡因是借支：储备往下走', coffee.reserve < DEFAULT_STATE.reserve)
ok('咖啡因确实提了一口气', coffee.atp > DEFAULT_STATE.atp)

const burned = replay([{ at: at(0), kind: 'burn', minutes: 30 }], NOW)
ok('耗 30 分钟掉一口气 0.3', near(burned.atp, 0.3))
ok('耗也动糖原', burned.glycogen < DEFAULT_STATE.glycogen)
ok('burnEffect 夹住下限', burnEffect(1).atp > -0.02)
ok('burnEffect 夹住上限', burnEffect(99999).atp >= -0.5)

ok('不认得的事件被丢掉，不瞎算', replay([{ at: at(0), kind: '飞升' }], NOW).atp === DEFAULT_STATE.atp)
ok('坏时间戳被丢掉', replay([{ at: '不是时间', kind: 'meal' }], NOW).atp === DEFAULT_STATE.atp)

// ── 6. 合成 ─────────────────────────────────────────────────────────────
const c = compose({ atp: 0.9, glycogen: 0.3, reserve: 0.9 }, Date.parse('2026-11-06T14:00:00+08:00'))
ok('取最小值不取平均', near(c.energy, 0.3))
ok('说得出谁在拖后腿', c.limiting === 'glycogen')
ok('节律当乘数', near(c.phase, 1))

const c2 = compose({ atp: 0.3, glycogen: 0.3, reserve: 0.3 }, Date.parse('2026-11-06T02:00:00+08:00'))
ok('深夜同样的槽，电量更低', c2.energy < 0.3)

// ── 7. 档位 ─────────────────────────────────────────────────────────────
ok('0.9 → 全量', levelOf(0.9).key === 'full')
ok('0.5 → 正常', levelOf(0.5).key === 'normal')
ok('0.3 → 瘦', levelOf(0.3).key === 'slim')
ok('0.1 → 极瘦', levelOf(0.1).key === 'minimal')
ok('边界 0.7 归全量', levelOf(0.7).key === 'full')
ok('边界 0.25 归瘦', levelOf(0.25).key === 'slim')

// ── 8. 输出 ─────────────────────────────────────────────────────────────
const d = describe(DEFAULT_STATE, NOW)
ok('描述有 8 行', d.lines.length === 8)
ok('描述里带电量', /电量 \d+%/.test(d.lines[0]))
ok('描述明说只报数', d.lines.some((l) => l.includes('只报数')))
ok('百分比不带小数', fmtPct(0.834) === '83%')
ok('每一类事件都有标签可用', EVENT_KINDS.every((k) => typeof EVENT_EFFECT[k] === 'object' || k === 'burn'))


// ── 9. token 账（口径抄 @sligqoer/dsh-usage-stats）─────────────────────
const ev = (time, turn, step, u, model = 'deepseek-flash') => ({
  type: 'assistant/message',
  time,
  data: { turn, step, message: { source: { provider: 'deepseek-account', model } }, usage: u },
})
const events = [
  ev(1000, 1, 1, { inputTokens: 100, outputTokens: 50, cacheReadTokens: 1000, cacheWriteTokens: 0, totalTokens: 1150 }),
  { type: 'tool/result', time: 1500, data: {} },
  ev(2000, 1, 2, { inputTokens: 20, outputTokens: 30, cacheReadTokens: 2000, cacheWriteTokens: 100, totalTokens: 2150 }),
]
ok('认出 usage', usageOfEvent(events[0]) !== null)
ok('不是助手消息就不算', usageOfEvent(events[1]) === null)
ok('没有 usage 就不算', usageOfEvent({ type: 'assistant/message', data: {} }) === null)

const sum = summarizeUsage(events)
ok('只数两条带 usage 的', sum.messages === 2)
ok('合计 token', sum.total === 3300)
ok('新付＝输入+输出', sum.fresh === 200)
ok('缓存读单算', sum.cacheRead === 3000)
ok('缓存写单算', sum.cacheWrite === 100)
ok('轮数按 turn 去重', sum.turns === 1)
ok('命中率＝缓存读/(新付+缓存读)', Math.abs(sum.cacheHitRate - 3000 / 3200) < 1e-9)
ok('平均每条', sum.avgPerMessage === 1650)
ok('since 过滤有效', summarizeUsage(events, { since: 1500 }).messages === 1)
ok('按时间排过（最后一条是 2000）', sum.last.at === 2000)

const sk = skimpVerdict(['truth'])
ok('要讲真相时不许省', sk.canSkimp === false && sk.hit.length === 1)
ok('没说情形就允许省', skimpVerdict([]).canSkimp === true)
ok('认不出标记也允许省', skimpVerdict(['随便']).canSkimp === true)
ok('五条不许省', NEVER_SKIMP.length === 5)
ok('千位缩写', fmtTokens(1500) === '1.5k')
ok('百万缩写', fmtTokens(2150000) === '2.15M')
ok('小数缩写', fmtTokens(42) === '42')
ok('百分比', fmtPct01(0.9375) === '94%')
ok('空账有话说', headline(summarizeUsage([])).includes('空'))

// ── 收口 ────────────────────────────────────────────────────────────────
if (fails.length) {
  console.log(`✗ ${fails.length} 项没过（过 ${pass} 项）`)
  for (const f of fails) console.log(`  - ${f}`)
  process.exit(1)
}
console.log(`✓ ${pass} 项全过`)
