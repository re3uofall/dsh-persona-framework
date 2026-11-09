import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'
// 1) 版本号 0.2.7（用 split/join，避开正则转义）
for (const f of ['index.js', 'package.json']) {
  let s = readFileSync(f, 'utf8')
  s = s.split('0.2.6').join('0.2.7').split('0.2.5').join('0.2.7')
  writeFileSync(f, s)
}
console.log('version ->', JSON.parse(readFileSync('package.json', 'utf8')).version)
// 2) 伪装一次面板输入
const M = 'C:/Users/52624/.dsh/dsh-pet/memory.json'
const mem = JSON.parse(readFileSync(M, 'utf8'))
mem.main.main.messages.push({ role: 'user', content: '在吗（唤醒测试）', ts: Date.now() })
writeFileSync(M, JSON.stringify(mem, null, 2))
console.log('pushed user, total', mem.main.main.messages.length)
await new Promise(r => setTimeout(r, 6000))
// 3) 看结果
const L = 'C:/Users/52624/.dsh/dsh-pet/wake.log'
console.log('--- wake.log tail ---')
console.log(readFileSync(L, 'utf8').split('\n').slice(-6).join('\n'))
console.log('--- inbox ---', existsSync('C:/Users/52624/.dsh/dsh-pet/pet-inbox.json'))
