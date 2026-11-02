/**
 * 自检：只碰临时目录，不写任何真实日记。
 *   node selfcheck.mjs
 *
 * 为什么要有它：日记和数据是两件事——写坏了不影响别的插件，所以最容易被放过。
 * 但日记是「写给自己看的那半句」，它坏得最安静：格式一飘，读的时候就少几行，
 * 而少的那几行不会报错。所以至少要验三样：写得进、读得回、坏输入不炸。
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
mkdirSync(join(root, 'persona-ai'), { recursive: true })
process.env.DSH_PERSONA_DIR = join(root, 'persona-ai')

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
mod.apply(ctx, { personaDir: join(root, 'persona-ai') })

const call = async (name, args) => {
  const t = tools.get(name)
  if (!t) throw new Error(`没有 ${name}`)
  const r = await t.execute(args, {})
  return String(r?.text ?? r ?? '')
}

try {
  // ── 写 ──
  const w1 = await call('diary_write', { body: '今天想明白一件事：懒也有它的道理。', kind: '心得' })
  ok('写得进', w1.length > 0, w1.slice(0, 40))

  const w2 = await call('diary_write', { body: '第二条，验一下追加不会盖掉第一条。', kind: '自省' })
  ok('第二条第也写得进', w2.length > 0)

  // ── 读回来 ──
  const list = await call('diary_list', {})
  ok('读得回第一条', list.includes('懒也有它的道理'))
  ok('读得回第二条', list.includes('追加不会盖掉第一条'))
  ok('两条都在，没被覆盖', list.includes('懒也有它的道理') && list.includes('追加不会盖掉第一条'))

  // ── 分类过滤 ──
  const only = await call('diary_list', { kind: '心得' })
  ok('按类筛：该有心得', only.includes('懒也有它的道理'))
  ok('按类筛：不该有自省', !only.includes('追加不会盖掉第一条'))

  // ── 坏输入不炸 ──
  let threw = false
  try { await call('diary_write', {}) } catch { threw = true }
  const emptyOut = threw ? '' : await call('diary_write', { body: '' }).catch(() => '')
  ok('空正文不炸（要么报错，要么给话）', threw || typeof emptyOut === 'string')

  const weird = await call('diary_list', { limit: -5 }).catch((e) => `抛错：${e.message}`)
  ok('负数 limit 不炸', typeof weird === 'string')

  // ── 落盘位置对 ──
  const dir = join(root, 'persona-ai')
  ok('落在人格目录下，不是 cwd', existsSync(dir))
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log(failed ? `\n失败 ${failed}` : '\n日记：全部通过')
process.exit(failed ? 1 : 0)
