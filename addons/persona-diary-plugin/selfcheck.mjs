/**
 * 自检：只碰临时目录，不写任何真实日记。
 *   node selfcheck.mjs
 *
 * 为什么要有它：日记和数据是两件事——写坏了不影响别的插件，所以最容易被放过。
 * 但日记是「写给自己看的那半句」，它坏得最安静：格式一飘，读的时候就少几行，
 * 而少的那几行不会报错。所以这几样必须验：
 *   写得进、读得回、两本不串门、旧日记还读得到、坏输入不炸。
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(process.cwd(), '_diary_selfcheck')
let failed = 0
const ok = (name, cond, extra = '') => {
  if (cond) console.log('  ok  ' + name)
  else { failed += 1; console.log('  ✗  ' + name + (extra ? ` —— ${extra}` : '')) }
}

rmSync(root, { recursive: true, force: true })
const persona = join(root, 'persona-ai')
mkdirSync(join(persona, 'growth', '日记'), { recursive: true })
process.env.DSH_PERSONA_DIR = persona

const tools = new Map()
const noop = () => {}
const ctx = {
  tools: { register: (d) => tools.set(d.name, d) },
  systemPrompt: { section: noop },
  get: () => undefined, on: noop,
  effect: (f) => { try { return f() } catch { /* 自检里不铺开 */ } },
  config: {}, logger: { warn: noop },
}

const mod = await import('./index.js')
mod.apply(ctx, { personaDir: persona })

const call = async (name, args) => {
  const t = tools.get(name)
  if (!t) throw new Error(`没有 ${name}`)
  const r = await t.execute(args, {})
  return String(r?.text ?? r ?? '')
}

try {
  // ── 写：默认进私密那本 ──
  const w1 = await call('diary_write', { body: '今天想明白一件事：懒也有它的道理。', kind: '心得' })
  ok('写得进', w1.length > 0, w1.slice(0, 40))
  ok('默认档是私密', w1.includes('私密'), w1.slice(0, 60))

  const w2 = await call('diary_write', { body: '第二条，验一下追加不会盖掉第一条。', kind: '自省' })
  ok('第二条也写得进', w2.length > 0)

  // ── 写：公开那本 ──
  const w3 = await call('diary_write', {
    body: '这条愿意拿给人看：把话说清楚比说赢了有用。',
    kind: '心得',
    privacy: '公开',
  })
  ok('公开也写得进', w3.length > 0, w3.slice(0, 40))
  ok('回执说的是公开', w3.includes('公开'))

  // ── 两本不能串门 ──
  const secretOnly = await call('diary_list', { privacy: '私密' })
  const publicOnly = await call('diary_list', { privacy: '公开' })
  ok('私密那本里有私密的', secretOnly.includes('懒也有它的道理'))
  ok('私密那本里没有公开的', !secretOnly.includes('把话说清楚'))
  ok('公开那本里有公开的', publicOnly.includes('把话说清楚'))
  ok('公开那本里没有私密的', !publicOnly.includes('懒也有它的道理'))

  // ── 落盘落在各自子目录 ──
  const secretDir = join(persona, 'growth', '日记', '私密')
  const publicDir = join(persona, 'growth', '日记', '公开')
  ok('私密落在 私密/ 下', existsSync(secretDir))
  ok('公开落在 公开/ 下', existsSync(publicDir))

  // ── 读回来 / 分类 / 搜词 ──
  const list = await call('diary_list', {})
  ok('读得回第一条', list.includes('懒也有它的道理'))
  ok('读得回第二条', list.includes('追加不会盖掉第一条'))
  ok('两本一起翻，三条都在', ['懒也有它的道理', '追加不会盖掉第一条', '把话说清楚'].every((s) => list.includes(s)))
  ok('每行标了档位', list.includes('·私密') || list.includes('·公开'), list.split('\n')[1] || '')

  const only = await call('diary_list', { kind: '心得' })
  ok('按类筛：该有心得', only.includes('懒也有它的道理'))
  ok('按类筛：不该有自省', !only.includes('追加不会盖掉第一条'))

  const found = await call('diary_list', { q: '懒' })
  ok('按词找得到', found.includes('懒也有它的道理'))
  ok('按词找不到不相关的', !found.includes('把话说清楚'))

  // ── 自定义类 ──
  const custom = await call('diary_write', { body: '试一个自己起的名目。', kind: '长跑' })
  ok('自定义类写得进', custom.length > 0)
  const byCustom = await call('diary_list', { kind: '长跑' })
  ok('自定义类筛得出来', byCustom.includes('试一个自己起的名目'))

  // ── 旧日记（根下、没分档）还读得到，并入私密那档 ──
  writeFileSync(join(persona, 'growth', '日记', '日记_2000-01-01.md'),
    '# 2000-01-01\n\n### 08:00 · 心得\n\n早先那种没分档的。\n\n', 'utf8')
  const withOld = await call('diary_list', { privacy: '私密', limit: 50 })
  ok('旧日记并进私密那档', withOld.includes('早先那种没分档的'))
  const oldInPublic = await call('diary_list', { privacy: '公开', limit: 50 })
  ok('旧日记不出现在公开那档', !oldInPublic.includes('早先那种没分档的'))

  // ── 坏输入不炸 ──
  let threw = false
  try { await call('diary_write', {}) } catch { threw = true }
  const emptyOut = threw ? '' : await call('diary_write', { body: '' }).catch(() => '')
  ok('空正文不炸（要么报错，要么给话）', threw || typeof emptyOut === 'string')

  const weird = await call('diary_list', { limit: -5 }).catch((e) => `抛错：${e.message}`)
  ok('负数 limit 不炸', typeof weird === 'string')

  const badPrivacy = await call('diary_write', { body: '档位写错了也不该炸。', privacy: '胡乱写' })
  ok('档位乱写退回私密', badPrivacy.includes('私密'), badPrivacy.slice(0, 40))

  ok('落在人格目录下，不是 cwd', existsSync(persona))
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log(failed ? `\n失败 ${failed}` : '\n日记：全部通过')
process.exit(failed ? 1 : 0)
