import { readFileSync, writeFileSync } from 'node:fs'
const F = 'index.js'
let s = readFileSync(F, 'utf8')
const rep = (from, to, tag) => {
  const n = s.split(from).length - 1
  if (n !== 1) { console.log('MISS', tag, n); return false }
  s = s.replace(from, to); console.log('OK', tag); return true
}
rep(
  "它说的必须是这个会话的原话：要它开口，用 pet_say／pet_whisper 原样念（都走 /broadcast，不生成、不改写）；要它知道你这边发生了什么，用 pet_forward 逐字转（默认带最近 4 条）。",
  "它不自己开口：碎碎念已关（whisperEnabled=false），不会再自己冒句子。所有输出都由我发：要它说，用 pet_say／pet_whisper 原样念（都走 /broadcast，不生成、不改写）；要它知道你这边发生了什么，用 pet_forward 逐字转（默认带最近 4 条）。",
  'section-line'
)
rep("export const version = '0.2.2'", "export const version = '0.2.3'", 'version')
writeFileSync(F, s)
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
pkg.version = '0.2.3'
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')
console.log('pkg', pkg.version)
