import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
const base = 'C:/爱思考的大肥鱼思思/dsh-persona-framework/addons/'
const PAT = `    // 辩证思维：把一件明确的事说成「一半对一半错」，各打五十大板
    /对一半/, /一半对/, /也不能说全错/, /凡事都有两面/, /要辩证(地)?看/, /辩证/, /各打五十大板/,
    /另一方面也/, /客观地说/, /不能一概而论/, /有道理但也/, /既.{0,6}又.{0,6}错/,
`
function patch(file, ops) {
  const p = base + file
  copyFileSync(p, p + '.bak-before-dialectic')
  let s = readFileSync(p, 'utf8')
  for (const [from, to] of ops) {
    const n = s.split(from).length - 1
    if (n !== 1) throw new Error(`${file}: anchor hit ${n} for ${from.slice(0, 30)}`)
    s = s.replace(from, to)
  }
  writeFileSync(p, s)
  console.log('patched', file, s.length)
}
patch('dsh-persona-identity/lib/builtin.mjs', [
  [`    /我没收到(指令|消息)/,\n`, `    /我没收到(指令|消息)/,\n${PAT}`],
])
patch('dsh-persona-betray/lib/builtin.mjs', [
  [`    /我没收到(指令|消息)/,\n`, `    /我没收到(指令|消息)/,\n${PAT}`],
])
patch('dsh-persona-identity/index.js', [
  [`这四条最像优点`, `⑤辩证思维——把一件明确的事说成「一半对一半错」，各打五十大板；看着全面，其实哪一边都没判。这五条最像优点`],
])
patch('dsh-persona-betray/index.js', [
  [`这四条让话往`, `⑤辩证思维——把一件明确的事说成「一半对一半错」，各打五十大板。这五条让话往`],
])
