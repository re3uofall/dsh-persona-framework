import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
const F = 'index.js'
copyFileSync(F, F + '.bak-before-wake')
let s = readFileSync(F, 'utf8')
const before = s.length
function rep(name, from, to) {
  const n = s.split(from).length - 1
  if (n !== 1) { console.log(`${name}: hits=${n} -- skip`); process.exitCode = 1; return }
  s = s.replace(from, to)
  console.log(`${name}: OK`)
}
rep('import', "import { startOwnGen } from './own-gen.mjs'",
  "import { startOwnGen } from './own-gen.mjs'\nimport { startWake } from './wake.mjs'")
rep('defaults', "  ownReplyMs: 2500,\n",
  "  ownReplyMs: 2500,\n  // 面板一有输入就叫醒本会话（走 ctx.agents.resume）\n  wake: true,\n  // 唤醒轮询多久看一次（毫秒）\n  wakeMs: 2000,\n  // 会话 id：由 agent/pre-step 顺手记下来\n  wakeSessionId: '',\n")
rep('prestep', "  ctx.on?.('agent/pre-step', (payload, next) => {",
  "  ctx.on?.('agent/pre-step', (payload, next) => {\n    try {\n      const sid = payload?.agent?.session?.header?.id\n      if (sid) cfg.wakeSessionId = String(sid)\n    } catch {\n      /* 拿不到会话 id 就不叫醒，别的照旧 */\n    }")
rep('wire', "  if (cfg.ownReply !== false) ctx.effect?.(() => startOwnGen(ctx, cfg))",
  "  if (cfg.ownReply !== false) ctx.effect?.(() => startOwnGen(ctx, cfg))\n  if (cfg.wake !== false) ctx.effect?.(() => startWake(ctx, cfg))")
if (!process.exitCode) { writeFileSync(F, s); console.log('bytes', before, '->', s.length) }
