import fs from 'node:fs'
const f='lib/reinforce.mjs'
let s=fs.readFileSync(f,'utf8')
s=s.replace('export function scoreOf({ at, hits }, now = Date.now()) {',
            'export function scoreOf(item, now = Date.now()) {\n  const { at, hits } = item || {}')
s=s.replace('rehearseFactor(item)', 'rehearseFactor(item || {})')
s=s.replace('rehearseFactor(row)', 'rehearseFactor(item || {})')
fs.writeFileSync(f,s)
