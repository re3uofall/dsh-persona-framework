// selfcheck：训练与蒸馏两半，各验「可数的东西」。
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { TRAIN, addTarget, runRound, activeTargets, strengthOf, loadTargets, renderTargets } from './lib/train.mjs'
import { distill, imitate, saveProfile, loadProfile, renderProfile } from './lib/distill.mjs'

let pass = 0
const fails = []
const ok = (name, cond) => { if (cond) pass += 1; else fails.push(name) }

const ws = mkdtempSync(join(tmpdir(), 'practice-'))
try {
  // ── 训练：重复出来的强度
  ok('默认轮次 5', TRAIN.defaultRounds === 5)
  ok('默认衰减 0.85', TRAIN.decay === 0.85)
  ok('强度 0 轮为 0', strengthOf(0) === 0)
  ok('强度按 1-0.85^n', Math.abs(strengthOf(3) - (1 - Math.pow(0.85, 3))) < 1e-3)

  const t = addTarget(ws, { feature: '句尾加「呢」', examples: ['我先看看呢', '不急呢'] })
  ok('加得上', t.ok === true && !!t.row.id)
  ok('没话不收', addTarget(ws, { examples: ['x'] }).ok === false)
  ok('没例句不收', addTarget(ws, { feature: '空口说' }).ok === false)

  const after = loadTargets(ws)
  ok('落了一条', after.length === 1 && after[0].rounds === 0)

  runRound(ws, t.row.id)
  ok('跑一轮 rounds=1', loadTargets(ws)[0].rounds === 1)
  runRound(ws, t.row.id); runRound(ws, t.row.id)
  const row = loadTargets(ws)[0]
  ok('强度随轮次上升', row.strength > 0 && row.strength < 1)
  ok('活跃条目标得出（阈值 0）', activeTargets(ws, 0).length === 1)
  ok('阈值 0.9 时闲着', activeTargets(ws, 0.9).length === 0)
  ok('渲染含特征名', renderTargets(loadTargets(ws)).includes('句尾加「呢」'))
  ok('跑不存在的条目报错', runRound(ws, 'nope').ok === false)

  // ── 蒸馏：数得出来的口音
  const samples = ['我先看看呢（歪头）', '不急呢（把杯子放下）', '再说吧（笑）']
  const p = distill(samples)
  ok('蒸馏成功', p.ok === true && p.samples === 3)
  ok('括号动作数得出', p.parensPerLine === 1)
  ok('句尾语气数得出', !!p.particles['呢'])
  saveProfile(ws, p)
  const back = loadProfile(ws)
  ok('档案读得回来', !!back && back.at === p.at)
  const im = imitate(back, '这个方案先放一放', { action: '把纸折起来' })
  ok('模仿出得来', im.ok === true && im.line.includes('（把纸折起来）'))
  ok('没档案就拒', imitate(null, 'x').ok === false)
  ok('渲染含句长', renderProfile(back).includes('句长均值'))
  ok('空样本拒蒸馏', distill([]).ok === false)

  // ── 包元信息
  const idx = readFileSync(new URL('./index.js', import.meta.url), 'utf8')
  ok('段名 实时环境:practice', idx.includes('实时环境:practice'))
  ok('工具 practice_train', idx.includes("name: 'practice_train'"))
  ok('工具 practice_distill', idx.includes("name: 'practice_distill'"))
  ok('版本 0.2.0', idx.includes("version = '0.2.0'"))
  ok('import 的渲染函数真存在', idx.includes('renderTargets'))
} finally {
  rmSync(ws, { recursive: true, force: true })
}

if (fails.length) {
  console.log(`没过 ${fails.length} 项：`)
  for (const f of fails) console.log('  ✗', f)
  console.log(`通过 ${pass}，失败 ${fails.length}`)
  process.exit(1)
}
console.log(`全部过了：${pass} 项过，0 项没过。`)
