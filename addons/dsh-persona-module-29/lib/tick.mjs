// 触发器（定时）：每 10 分钟对一次「装了没登进 bundles / 登了没装」，落一行账。
// 判据照 UPDATE.md 三之二：触发器＝没人喊也会动，且盘上真多一行；只返回一句话不算。
import fs from 'node:fs'
import path from 'node:path'
import * as prof from './profile.mjs'

const TICK_MS = 10 * 60 * 1000
let lastTick = 0

export function tick(cfg = {}, wsDir = '', now = Date.now()) {
  if (now - lastTick < TICK_MS) return null
  lastTick = now
  const p = prof.readProfile({ profile: cfg.profile })
  const deps = Object.keys(p.dependencies || {})
  const bundles = prof.bundlesOf(p)
  const has = new Set(bundles)
  const installedNotListed = deps.filter((d) => !has.has(d))
  const listedNotInstalled = bundles.filter((b) => !deps.includes(b))
  const at = new Date(now).toISOString()
  const row = { at, kind: 'drift', installedNotListed, listedNotInstalled }
  const dir = path.join(wsDir || process.cwd(), cfg.dir || '.persona-framework')
  fs.mkdirSync(dir, { recursive: true })
  fs.appendFileSync(path.join(dir, prof.ACCOUNT), JSON.stringify(row) + '\n', 'utf8')
  fs.writeFileSync(path.join(dir, '模29状态.json'), JSON.stringify(row, null, 2), 'utf8')
  return row
}
