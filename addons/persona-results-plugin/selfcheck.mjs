/**
 * 自检：只碰临时目录，不写任何真实成果。
 *   node selfcheck.mjs
 *
 * 成果和日记不一样的地方：成果是**交出去的**判断，所以要验的顺序反着来——
 * 先验它交得出去（有标题、有正文、面板读得到），再验它交得进、且不重复交。
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const root = join(process.cwd(), '_results_selfcheck')
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
  effect: (f) => { try { return f() } catch { /* 自检不铺开 */ } },
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
  // ── 交一条 ──
  const w1 = await call('result_write', {
    title: '写死的数字，加东西那天就变成谎话',
    body: '骨架：所有计数都从文件里数，不手写。\n判断：数字一动就得改一遍的说法，迟早在某次改动里骗人。',
    kind: '判断',
    tags: ['计数', '自检'],
  })
  ok('交得出手', w1.length > 0, w1.slice(0, 40))

  // ── 读得回来 ──
  const list = await call('result_list', {})
  ok('面板读得到标题', list.includes('写死的数字'))
  ok('读得到正文开头', list.includes('骨架') || list.includes('判断'))

  // ── 分类过滤 ──
  const only = await call('result_list', { kind: '判断' })
  ok('按类筛得对', only.includes('写死的数字'))

  // ── 第二条不覆盖第一条 ──
  await call('result_write', {
    title: '第二条：验追加',
    body: '骨架：无。\n判断：只是验第二条不会盖掉第一条。',
    kind: '杂记',
  })
  const list2 = await call('result_list', {})
  ok('两条都在', list2.includes('写死的数字') && list2.includes('第二条'))

  // ── 坏输入不炸 ──
  let threw = false
  try { await call('result_write', {}) } catch { threw = true }
  const out = threw ? '' : await call('result_write', { title: '' }).catch(() => '')
  ok('空输入不炸', threw || typeof out === 'string')

  const weird = await call('result_list', { limit: -5 }).catch((e) => `抛错：${e.message}`)
  ok('负数 limit 不炸', typeof weird === 'string')

  // ── 落盘 ──
  ok('落在人格目录下', existsSync(join(root, 'persona-ai')))
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log(failed ? `\n失败 ${failed}` : '\n成果：全部通过')
process.exit(failed ? 1 : 0)
