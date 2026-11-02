// 冒烟：挑帧 / 差分数 / 落账 / 输出话术。只碰临时目录，不碰真工作区。
// 不测截屏——那要真屏幕，跑不了 CI，留给手动联调。
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diffScore, pickFrames, FP_LEN } from './lib/sample.mjs'
import { appendVisionRecord } from './lib/ledger.mjs'
import { renderLook } from './index.js'

let fails = 0
const ok = (c, m) => {
  console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`)
  if (!c) fails += 1
}

/** 造一张指纹：n 个格子全填 v，长度钉成 FP_LEN */
const fp = (v = 0, n = FP_LEN) => Array.from({ length: n }, () => v)

// ── 差分数
ok(FP_LEN === 576, 'FP_LEN 是 576（32×18）')
ok(diffScore(fp(10), fp(10)) === 0, '同一张指纹差 0')
ok(Math.abs(diffScore(fp(0), fp(255)) - 1) < 1e-9, '全黑 vs 全白 差 1')
ok(Math.abs(diffScore(fp(0), fp(51)) - 0.2) < 1e-9, '差 51 灰度 → 0.2')

let threw = false
try { diffScore(fp(0), fp(0, 100)) } catch { threw = true }
ok(threw, '长度不一致 diffScore 要 throw（不许静默按短的比）')

threw = false
try { diffScore(fp(0), '不是数组') } catch { threw = true }
ok(threw, '非数组 diffScore 要 throw')

// ── 挑帧：一帧没变
const same = [1, 2, 3, 4, 5].map((i) => ({ fp: fp(100), at: `t${i}`, path: `p${i}.png` }))
const r0 = pickFrames(same)
ok(r0.kept.length === 1, '一帧没变时 kept 只剩基准那一帧')
ok(r0.kept[0].path === 'p1.png', '基准永远是第一帧')
ok(r0.changedRatio === 0, '一帧没变时 changedRatio 是 0')
ok(r0.dropped === 4, 'dropped 是数量：5 帧留 1，丢 4')

// ── 挑帧：变了
const moving = [
  { fp: fp(0), at: 't1', path: 'm1.png' },
  { fp: fp(120), at: 't2', path: 'm2.png' },
  { fp: fp(120), at: 't3', path: 'm3.png' },
]
const r1 = pickFrames(moving)
ok(r1.kept.length === 2, '三帧里有一帧变了 → kept 是基准 + 那一帧')
ok(r1.changedRatio > 0, '变了的时候 changedRatio 大于 0')

// ── 挑帧：超 maxFrames 按差异大的优先
const burst = [
  { fp: fp(0), at: 't1', path: 'b1.png' },
  { fp: fp(100), at: 't2', path: 'b2.png' },
  { fp: fp(110), at: 't3', path: 'b3.png' },
  { fp: fp(200), at: 't4', path: 'b4.png' },
]
const r2 = pickFrames(burst, { threshold: 0.001, maxFrames: 3 })
ok(r2.kept.length === 3, 'maxFrames=3 时最多留 3 帧')
ok(r2.kept[0].path === 'b1.png', '截断也不许把基准帧挤掉')
const keptPaths = r2.kept.map((k) => k.path)
ok(keptPaths.includes('b4.png'), '差异最大的那一帧要留下（按差异排，不按时间）')
ok(!keptPaths.includes('b3.png'), '差异最小那一帧先被丢掉')

// ── 挑帧：阈值卡得住噪声
const tiny = [
  { fp: fp(0), at: 't1', path: 't1.png' },
  { fp: fp(1), at: 't2', path: 't2.png' },
]
ok(pickFrames(tiny, { threshold: 0.01 }).kept.length === 1, '小于阈值的抖动不算变')
ok(pickFrames(tiny, { threshold: 0.0001 }).kept.length === 2, '阈值放宽就算变')

// ── 落账
const root = mkdtempSync(join(tmpdir(), 'pv-'))
mkdirSync(join(root, 'persona-ai/knowledge/vision'), { recursive: true })

const a = appendVisionRecord(root, {
  at: '2026-11-02T14:03:12+08:00',
  source: 'capture/2026-11-02/140312',
  title: '看主屏：12 帧里挑了 3 帧',
  tags: ['视觉', '主屏'],
  body: '变了 3 帧，拼图落在 vframes/sheet-1.png。',
})
const b = appendVisionRecord(root, {
  at: '2026-11-02T14:10:00+08:00',
  source: 'note',
  title: '手记一句',
  tags: ['视觉', '手记'],
  body: '这一句是从别处知道的，没截图。',
})

ok(typeof a.file === 'string' && a.file.endsWith('2026-11-02.md'), '落在当天那个文件里')
ok(a.pointer.endsWith('#1'), '第一条指针是 #1')
ok(b.pointer.endsWith('#2'), '第二条指针是 #2（追加，不覆盖）')

const md = readFileSync(a.file, 'utf8')
ok(md.includes('## 14:03 看主屏：12 帧里挑了 3 帧'), '节标题带 HH:MM 前缀')
ok(md.includes('- tags: 视觉, 主屏'), 'tags 逗号分隔')
ok(md.includes('- kind: vision'), 'kind 是 vision')
ok(md.includes('- source: capture/2026-11-02/140312'), 'source 落进去了')
ok(/- updated: 2026-11-02T14:03:12/.test(md), 'updated 落进去了')
ok(md.includes('变了 3 帧'), '正文原样落进去了')
ok((md.match(/^## /gm) || []).length === 2, '两个 ## 节')
ok(md.includes('这一句是从别处知道的'), '第二条也进去了，第一条没被覆盖')
ok(md.endsWith('\n') && !md.endsWith('\n\n'), '文件结尾只有一个换行')

// ── 输出话术
const tNo = renderLook({ total: 12, changed: 0, kept: [], maxRatio: 0, threshold: 0.003, duration: 3 })
ok(tNo.includes('一帧没变'), '没变的话术：先报帧数')
ok(!tNo.includes('拼图'), '没变时不许提拼图（那一趟本来就没产图）')

const tYes = renderLook({
  total: 12, changed: 3,
  kept: [{ label: '14:03:01 起' }, { label: '14:03:02 +3.1%' }, { label: '14:03:03 +8.0%' }],
  maxRatio: 0.08, threshold: 0.003, duration: 3,
  sheetPath: 'vframes/sheet-1.png', describe: null, pointer: 'vision/2026-11-02.md#1',
})
ok(tYes.includes('3 帧变了'), '变了的话术报帧数')
ok(tYes.includes('vframes/sheet-1.png'), '把拼图路径交出去')
ok(tYes.includes('没认'), '没认图时明说没认')
ok(tYes.includes('vision/2026-11-02.md#1'), '把记录指针交出去')

const tFail = renderLook({ error: '截屏失败（没找到 powershell）' })
ok(tFail.includes('没看成'), '失败的话术说没看成')
ok(tFail.includes('这不是「没什么变化」'), '失败时不许被读成「没变化」')

console.log(fails ? `\n${fails} 条没过` : '\n全过')
process.exit(fails ? 1 : 0)
