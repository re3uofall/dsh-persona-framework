import { readFileSync, writeFileSync } from 'node:fs'
const F = 'C:/爱思考的大肥鱼思思/dsh-persona-framework/addons/dsh-pet-sisi/index.js'
let s = readFileSync(F, 'utf8')
const hit = (needle) => { const n = s.split(needle).length - 1; if (n !== 1) throw new Error(`hits=${n} for: ${needle.slice(0, 60)}`); return n }

// 1) 导入 writeFileSync
hit("import { existsSync, readFileSync } from 'node:fs'")
s = s.replace("import { existsSync, readFileSync } from 'node:fs'", "import { existsSync, readFileSync, writeFileSync } from 'node:fs'")

// 2) 在 callJson 之后插入 recordAssistant
const anchor = 'function petQuery(cfg, extra = {}) {'
hit(anchor)
const helper = `// 把「它说过的话」也写进它自己的记忆：气泡 20 秒就收，面板历史里得留得住。
// 只写 assistant 一条，不改它的生成逻辑（生成已关）。
async function recordAssistant(text, image) {
  try {
    const file = join(homedir(), '.dsh', 'dsh-pet', 'memory.json')
    if (!existsSync(file)) return
    const mem = JSON.parse(readFileSync(file, 'utf8'))
    const bucket = mem.main && typeof mem.main === 'object' ? mem.main : (mem.main = {})
    const entry = bucket.main && Array.isArray(bucket.main.messages) ? bucket.main : (bucket.main = { messages: [] })
    entry.messages.push({ role: 'assistant', content: String(text), ts: Date.now(), ...(image ? { image } : {}) })
    writeFileSync(file, JSON.stringify(mem, null, 2), 'utf8')
  } catch {
    /* 记不住也不许把这句话吞掉 */
  }
}

`
s = s.replace(anchor, helper + anchor)

// 3) callJson 成功且是 /broadcast 时，顺手记账
const ret = '    return { ok: res.ok, status: res.status, data }'
hit(ret)
s = s.replace(ret, `    if (res.ok && pathname.startsWith('/broadcast') && opts && opts.body && typeof opts.body.text === 'string') {
      void recordAssistant(opts.body.text, opts.body.image)
    }
${ret}`)

// 4) 版本
hit("export const version = '0.2.5'")
s = s.replace("export const version = '0.2.5'", "export const version = '0.2.6'")

writeFileSync(F, s, 'utf8')
console.log('OK bytes', Buffer.byteLength(s))
const pkg = JSON.parse(readFileSync('C:/爱思考的大肥鱼思思/dsh-persona-framework/addons/dsh-pet-sisi/package.json', 'utf8'))
pkg.version = '0.2.6'
writeFileSync('C:/爱思考的大肥鱼思思/dsh-persona-framework/addons/dsh-pet-sisi/package.json', JSON.stringify(pkg, null, 2) + '\n')
console.log('pkg', pkg.version)
