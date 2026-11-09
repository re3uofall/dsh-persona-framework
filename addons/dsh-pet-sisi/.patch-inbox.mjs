import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
const F = 'index.js'
copyFileSync(F, F + '.bak-before-inbox')
let s = readFileSync(F, 'utf8')
const before = s.length

// 1) 段正文里加一段：读 pet-inbox.json，摆在最前面（"该回什么"这句提示词）
const anchor = "  if (cfg.section !== false) {"
const inject = `  const inboxLine = () => {
    try {
      const p = join(dataDir(cfg), 'pet-inbox.json')
      if (!existsSync(p)) return ''
      const d = JSON.parse(readFileSync(p, 'utf8'))
      const age = Date.now() - Number(d.at || 0)
      if (!d.text || age > 30 * 60 * 1000) return ''
      return \`⚠ 面板里等你回：\${String(d.text).slice(0, 120)}（\${new Date(Number(d.ts) || Date.now()).toISOString().slice(11, 19)}）→ 回完用 pet_reply，它会清\\n\`
    } catch { return '' }
  }

`
const i1 = s.indexOf(anchor)
if (i1 < 0) throw new Error('anchor section not found')
s = s.slice(0, i1) + inject + s.slice(i1)

// 2) 段的第一行前插 inboxLine()
const seg = "      return [\n        '## 桌宠（dsh-pet）',"
const j = s.indexOf(seg)
if (j < 0) throw new Error('section return not found')
s = s.slice(0, j) + "      return [\n        '## 桌宠（dsh-pet）',\n        ...(inboxLine() ? [inboxLine().trimEnd()] : [])," + s.slice(j + seg.length)

// 3) pet_reply 成功后清 inbox
const k = s.indexOf("return `它原样说了：")
if (k < 0) throw new Error('pet_reply return not found')
s = s.slice(0, k) + "try { const ip = join(dataDir(cfg), 'pet-inbox.json'); if (existsSync(ip)) writeFileSync(ip, JSON.stringify({ text: '', ts: 0, at: 0 })) } catch {}\n      " + s.slice(k)

writeFileSync(F, s)
console.log('patched', before, '->', s.length)
