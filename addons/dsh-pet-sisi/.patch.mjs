import { readFileSync, writeFileSync } from 'node:fs'
const p = 'index.js'
let s = readFileSync(p, 'utf8')
const rep = (from, to, label) => {
  const n = s.split(from).length - 1
  if (n !== 1) throw new Error(`${label}: 命中 ${n} 次，应为 1`)
  s = s.replace(from, to)
  console.log('OK', label)
}

// 1) pet_say：改走 /broadcast，逐字，不生成
rep(`    description: '替思思对桌宠说一句（会走它自己的模型生成回复，并写进它自己的记忆）。带 surface，默认 desktop。',`,
`    description: '替思思对桌宠说一句：原样写进气泡（POST /broadcast），不生成、不改写、不进它的对话记忆。带 surface，默认 desktop。',`, 'pet_say desc')

rep(`      const res = await callJson(base, \`/chat?\${petQuery(cfg, { surface })}\`, { method: 'POST', body: { text } }, cfg.timeoutMs)
      if (!res.ok) return \`它没收下：\${brief(res)}\`
      const reply = String(res.data?.text || '')
      return reply ? \`它回了：\${reply}\` : \`发出了，它没回话：\${brief(res)}\``,
`      const res = await callJson(base, \`/broadcast?\${petQuery(cfg, { surface })}\`, { method: 'POST', body: { text, duration: 20000, anim: true } }, cfg.timeoutMs)
      return res.ok ? \`它原样说了：\${text}\` : \`没说成：\${brief(res)}\``, 'pet_say body')

// 2) pet_whisper：同样走 /broadcast，堵住第二个生成口
rep(`    description: '让它开口说一句（气泡/耳语，不经过对话记忆）。想让它说什么就说什么。',`,
`    description: '同 pet_say：把一句原话写进气泡（/broadcast），不生成、不改写。过去走 /whisper 会让它自己另生成一句，已改掉。',`, 'pet_whisper desc')

rep(`      const res = await callJson(base, \`/whisper?\${petQuery(cfg, { surface })}\`, { method: 'POST', body: { text } }, cfg.timeoutMs)
      return res.ok ? \`它说了：\${text}\` : \`没说成：\${brief(res)}\``,
`      const res = await callJson(base, \`/broadcast?\${petQuery(cfg, { surface })}\`, { method: 'POST', body: { text, duration: 20000, anim: true } }, cfg.timeoutMs)
      return res.ok ? \`它原样说了：\${text}\` : \`没说成：\${brief(res)}\``, 'pet_whisper body')

// 3) 段落指令：改成说清哪条是逐字、哪条会生成
rep(`它说的必须是这个会话的原话：用 pet_forward 逐字转（默认带最近 4 条），别用 pet_say 自己复述——复述会长出第二个人格。`,
`它说的必须是这个会话的原话：要它开口，用 pet_say／pet_whisper 原样念（都走 /broadcast，不生成、不改写）；要它知道你这边发生了什么，用 pet_forward 逐字转（默认带最近 4 条）。`, 'section line')

// 4) 版本
rep(`export const version = '0.2.1'`, `export const version = '0.2.2'`, 'index version')
writeFileSync(p, s)
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
pkg.version = '0.2.2'
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')
console.log('pkg version ->', pkg.version)
const rd = readFileSync('README.md', 'utf8')
const m = rd.match(/^## .*$/m)
console.log('README first ## line:', m && m[0])
