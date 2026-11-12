/**
 * cardguard 自检：`node selfcheck.mjs`，全绿再往下。
 * 只测纯逻辑与装载行为，不启动 DSH。
 */
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, ensurePersonaRaw, inspectPersona, version } from './index.js'

let pass = 0
const fails = []
function ok(cond, name) {
  if (cond) pass++
  else fails.push(name)
}

const ws = mkdtempSync(join(tmpdir(), 'cardguard-'))
const cardFile = join(ws, '.persona-framework', '环境卡.json')
mkdirSync(join(ws, '.persona-framework'), { recursive: true })

function writeCard(persona) {
  writeFileSync(
    cardFile,
    JSON.stringify({ mode: 'card', budget: 600, components: { framework: { mode: 'card', budget: 500 }, persona } }, null, 2) + '\n',
    'utf8',
  )
}
function readCard() {
  return JSON.parse(readFileSync(cardFile, 'utf8'))
}

// 1) 版本是个字符串
ok(typeof version === 'string' && version.length > 0, '导出得出版本')

// 2) 人格是 card 时：ensurePersonaRaw 改回 raw，并去掉 budget
writeCard({ mode: 'card', budget: 400 })
const r1 = ensurePersonaRaw({ workspace: ws }, '自检')
const c1 = readCard()
ok(r1.changed === true, '被卡片化时确实改了')
ok(c1.components.persona.mode === 'raw', '改回 raw')
ok(c1.components.persona.budget === undefined, 'budget 去掉了')
ok(c1.components.framework.mode === 'card', '别的档一个字没动')

// 3) 已经是 raw 时不重复改
const r2 = ensurePersonaRaw({ workspace: ws }, '再查一次')
ok(r2.changed === false, '已经 raw 就不动')
ok(r2.text.includes('raw'), '回执说得出现在是 raw')

// 4) 账上落了一行，且写得清「从 card 改回」
const log = readFileSync(join(ws, '.persona-framework', '卡片守账.jsonl'), 'utf8')
ok(log.trim().split('\n').length === 1, '账上只落一行（第二次没改就没记）')
ok(log.includes('"from":"card"'), '账上记得清原来是什么')

// 5) 备份留了
const files = readdirSync(join(ws, '.persona-framework'))
ok(files.some((n) => n.startsWith('环境卡.json.bak-')), '改前留了备份')

// 6) guard=false 只看不动
writeCard({ mode: 'card', budget: 300 })
const r3 = ensurePersonaRaw({ workspace: ws, guard: false }, '只查')
ok(r3.changed === false && readCard().components.persona.mode === 'card', 'guard=false 时只看不改')

// 7) 装载时自动修：apply 之后卡片变 raw，且注册了一个工具
writeCard({ mode: 'card', budget: 200 })
const tools = new Map()
const registrations = []
const fake = {
  effect(fn) {
    const d = fn()
    return () => {
      try {
        d && d()
      } catch {}
    }
  },
  on() {
    return () => {}
  },
  tools: {
    register(spec) {
      registrations.push(spec.name)
      tools.set(spec.name, spec)
      return () => tools.delete(spec.name)
    },
  },
}
apply(fake, { workspace: ws })
ok(readCard().components.persona.mode === 'raw', '装载时把人格改回 raw')
ok(registrations.includes('cardguard_status'), '注册了 cardguard_status')

// 8) 工具能看也能改
writeCard({ mode: 'card', budget: 150 })
const tool = tools.get('cardguard_status')
const t1 = await tool.execute({ op: 'status' })
ok(String(t1.text).includes('不合规'), 'status 看得出来不合规')
const t2 = await tool.execute({ op: 'fix' })
ok(String(t2.text).includes('已改回 raw'), 'fix 当场改回')
ok(readCard().components.persona.mode === 'raw', 'fix 之后盘上是 raw')

// 9) inspectPersona 只读
const before = readFileSync(cardFile, 'utf8')
inspectPersona({ workspace: ws })
ok(readFileSync(cardFile, 'utf8') === before, 'inspect 不改文件')

// 10) 没环境卡时直说，不抛
const empty = mkdtempSync(join(tmpdir(), 'cardguard-empty-'))
const r4 = ensurePersonaRaw({ workspace: empty }, '空')
ok(r4.changed === false && String(r4.text).includes('没找到环境卡'), '没环境卡就直说')

rmSync(ws, { recursive: true, force: true })
rmSync(empty, { recursive: true, force: true })

if (fails.length) {
  console.log(`没全过：${pass} 过，${fails.length} 没过`)
  for (const f of fails) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log(`全过：${pass} 项`)
