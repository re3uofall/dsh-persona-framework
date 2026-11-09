import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
const F = 'index.js'
let s = readFileSync(F, 'utf8')
if (!existsSync(F + '.bak-before-inbox')) copyFileSync(F, F + '.bak-before-inbox')

const fn = `function readInbox(cfg) {
  try {
    const p = join(dataDir(cfg), 'pet-inbox.json')
    if (!existsSync(p)) return null
    const j = JSON.parse(readFileSync(p, 'utf8'))
    const text = String(j?.text || '').trim()
    if (!text) return null
    return { text, ts: Number(j.ts) || 0 }
  } catch {
    return null
  }
}

`
if (!s.includes('function readInbox(')) {
  const a1 = 'function readLedger('
  const i1 = s.indexOf(a1)
  if (i1 < 0) throw new Error('anchor readLedger missing')
  s = s.slice(0, i1) + fn + s.slice(i1)
  console.log('readInbox inserted')
} else console.log('readInbox already there')

const anchor = "            talk,\n"
const i = s.indexOf(anchor)
if (i < 0) throw new Error('anchor talk, missing')
if (s.includes('等你回（面板里你打的）')) { console.log('pending line already there') } else {
  const line = "            ...(() => { const p = readInbox(cfg); return p ? [`等你回（面板里你打的）：${p.text}`] : [] })(),\n"
  s = s.slice(0, i + anchor.length) + line + s.slice(i + anchor.length)
  console.log('pending line inserted')
}
writeFileSync(F, s)
console.log('bytes', s.length)
