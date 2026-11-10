import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONNECTIVES, KIND_LABEL, connectorOf, segments, buildCards, renderCards } from './lib/lang.mjs'
import { invariants, articulations, compareSets, driftOf, renderTopo, renderCompare } from './lib/topo.mjs'

let pass = 0
const fails = []
const ok = (cond, name) => { if (cond) pass += 1; else fails.push(name) }

ok(CONNECTIVES.length === 6, '六个连接词')
ok(CONNECTIVES.every((c) => c.sym && c.name && c.truth && c.words.length), '每个连接词都有符号/名称/真值规则/说法')
ok(connectorOf('所以')?.sym === '∴', '认出「所以」是推出')
ok(connectorOf('和')?.sym === '∧', '认出「和」是合取')
ok(connectorOf('随便') === null, '不认识的词不硬认')

const segs = segments('因为下雨，所以我不出门')
ok(segs.length >= 3, '按连接词切开')
ok(segs.every((s) => typeof s.start === 'number' && typeof s.end === 'number'), '每段都有位置')

const r1 = buildCards('如果下雨，那么地上是湿的', { source: 't#1' })
ok(r1.cards.length >= 2, '拆出卡')
ok(r1.cards.some((c) => c.kind === 'conn' && c.logic.sym === '→'), '认出蕴含')
ok(r1.edges.length >= 1, '至少有边')

const r2 = buildCards('所以', { source: 't#2' })
ok(r2.unresolved.length === 1, '连接词只有一边记未定')
ok(r2.unresolved[0].why.includes('只有一边'), '未定写明为什么')

const r3 = buildCards('所有插件都要自检', {})
ok(r3.cards.some((c) => c.kind === 'quant'), '认出量词')

const r4 = buildCards('必须现在做', {})
ok(r4.cards.some((c) => c.kind === 'modal'), '认出模态')

ok(renderCards(r1).includes('语言卡'), '渲染出语言卡表头')
ok(renderCards(r1).includes('[0-'), '每行带原文位置')

const inv = invariants(r1)
ok(inv.nodes === r1.cards.length, '点数等于卡数')
ok(inv.components >= 1, '至少一段连通')
ok(Array.isArray(inv.articulation), '给出断裂点')

const a = buildCards('甲和乙', {})
const comp = compareSets(a, buildCards('甲和丙', {}))
ok(Array.isArray(comp.added) && Array.isArray(comp.slips), '比较给出加/滑')
ok(driftOf(comp) >= 0 && driftOf(comp) <= 1, '漂移度在 0..1')
ok(renderCompare(comp).includes('结构变化'), '渲染出比较表头')
ok(renderTopo(a).includes('结构卡'), '渲染出结构卡表头')

const empty = compareSets(a, a)
ok(empty.added.length === 0 && empty.removed.length === 0, '同一份比自己没有增删')
ok(driftOf(empty) === 0, '没变时漂移为 0')

console.log(fails.length ? `没过 ${fails.length} 项：${fails.join('；')}` : `全部过了：${pass} 项过，0 项没过。`)
process.exit(fails.length ? 1 : 0)
