#!/usr/bin/env node
/**
 * 自检环 · 独立跑一次（给计划任务叫，不给人叫）
 * ============================================================================
 * 用法：node tools/selfcheck-run.mjs [workspace]
 *   workspace 默认 C:\爱思考的大肥鱼思思
 *
 * 它干的事：读盘上最近一句「她」→ 过 check / audit / 框架语言三样 →
 *   写 `.persona-framework/自检环.json`（注入那边读它）→ 追加一行运行日志。
 *
 * 为什么要有这个文件：插件里的定时器要等重载才转，而这个脚本由 Windows
 * 计划任务按点叫起，**不需要任何人开口，也不需要插件重载**。
 * 日志是给自己看的：它证明「这一次真的跑过」，不是我以为它会跑。
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runSelfCheck, statePath } from '../impl/selfcheck-loop.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_WS = 'C:\\爱思考的大肥鱼思思'
const ws = resolve(process.argv[2] || DEFAULT_WS)

const LOG = join(ws, '.persona-framework', '自检环.log')
const stamp = () => new Date().toISOString()

function log(line) {
  try {
    mkdirSync(dirname(LOG), { recursive: true })
    appendFileSync(LOG, `${stamp()} ${line}\n`, 'utf8')
  } catch {
    /* 日志写不进去也不该拖垮检查 */
  }
}

try {
  const r = runSelfCheck(ws, { closingTics: [] })
  if (!r.ran) {
    log(`skip｜${r.why || '没跑'}｜state=${statePath(ws)}`)
    process.exit(0)
  }
  const by = (r.issues || []).reduce((a, i) => ({ ...a, [i.by]: (a[i.by] || 0) + 1 }), {})
  const shape = Object.keys(by).length ? JSON.stringify(by) : '{}'
  log(`ran｜第 ${r.said?.line || '?'} 行｜疑似 ${r.issues?.length ?? 0} ${shape}｜wrote=${r.wrote}`)
  process.exit(0)
} catch (e) {
  log(`error｜${e && e.message ? e.message : String(e)}`)
  process.exit(1)
}
