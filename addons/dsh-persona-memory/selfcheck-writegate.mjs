import { decideWrite, explain, layerOf } from 'file:///C:/爱思考的大肥鱼思思/dsh-persona-memory/lib/writegate.mjs'

let pass = 0
let fail = 0

function check(name, got, want) {
  const ok = got === want
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} -> ${got}${ok ? '' : ` (want ${want})`}`)
  ok ? pass++ : fail++
}

console.log('=== 分层 ===')
check('流水', layerOf('persona-ai/knowledge/session/2026-11-03.md'), 'contextual')
check('判断', layerOf('persona-ai/knowledge/chat/2026-11-03.md'), 'knowledge')
check('模块库', layerOf('persona-ai/modules/30-人性.md'), 'structural')
check('人格文件', layerOf('persona-ai/characters/大肥鱼思思_人格文件.md'), 'self')
check('人格补丁', layerOf('persona-ai/growth/人格补丁.md'), 'self')
check('反斜杠', layerOf('persona-ai\\knowledge\\chat\\x.md'), 'knowledge')

console.log('\n=== 判定 ===')
const cases = [
  ['session 随便写', { path: 'persona-ai/knowledge/session/x.md' }, 'allow'],
  ['chat 没反思', { path: 'persona-ai/knowledge/chat/x.md' }, 'require_review'],
  ['chat 反思过', { path: 'persona-ai/knowledge/chat/x.md', reviewers: ['reflect'] }, 'allow'],
  ['模块库只反思', { path: 'persona-ai/modules/x.md', reviewers: ['reflect'] }, 'deny'],
  ['模块库两样齐', { path: 'persona-ai/modules/x.md', reviewers: ['reflect', 'verify'] }, 'allow'],
  ['人格文件啥都没', { path: 'persona-ai/characters/x.md' }, 'deny'],
  ['人格文件两样齐（不经过人）', { path: 'persona-ai/characters/x.md', reviewers: ['reflect', 'verify'] }, 'allow'],
  ['认不出的路径', { path: 'some/random/file.md' }, 'allow'],
]
for (const [name, opts, want] of cases) {
  const v = decideWrite(opts)
  check(name, v.decision, want)
  if (process.argv.includes('-v')) console.log('     ', explain(v))
}

console.log(`\n${pass} 过 / ${fail} 不过`)
process.exit(fail ? 1 : 0)
