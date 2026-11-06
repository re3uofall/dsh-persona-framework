import fs from 'node:fs'
const f='lib/reinforce.mjs'
let s=fs.readFileSync(f,'utf8')
const i=s.indexOf('export function scoreOf')
const head=s.slice(i, s.indexOf('{', i))
const m=head.match(/scoreOf\s*\(([^)]*)\)/)
const params=m?m[1].split(',').map(x=>x.trim().split(/[\s=:]/)[0]).filter(Boolean):[]
const first=params[0]||'item'
console.log('signature:', head.replace(/\s+/g,' '), '| first param =', first)
s=s.replace(/\*\s*rehearseFactor\(row\)/g, `* rehearseFactor(${first})`)
fs.writeFileSync(f,s)
console.log('patched with', first)
