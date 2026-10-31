/**
 * 不开 DSH，在临时鱼缸里跑一遍：切段 → 取段 → 出口自检 → 槽位体检。
 * 用法（用 DSH 自带的 node）：node selfcheck.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkText, renderCheck, auditStructure } from './lib/checks.mjs'
import { auditSlots, findRule, pickSections, readFramework, splitSections, truncate, BUNDLED } from './lib/framework.mjs'
import { languageBetrayal, readPersona, readInternalIntegration, readExternalIntegration, readExperience, readTheory } from './lib/programs.mjs'

/** Node 20.11+ 有 import.meta.dirname；旧版退到 fileURLToPath。 */
const HERE = import.meta.dirname || dirname(fileURLToPath(import.meta.url))
/** 包里对外声称的版本，唯一来源是 package.json。 */
const PKG_VERSION = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8')).version

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ok   ${name}`) } else { fail += 1; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`) }
}

console.log('— 框架文件 —')
const fw = readFramework(BUNDLED)
ok('能读到自带框架', fw.text.length > 2000, `${fw.text.length} 字`)
ok('CHANGELOG 最新条目等于插件版本', (() => {
  try {
    const first = readFileSync(new URL('./CHANGELOG.md', import.meta.url), 'utf8')
      .split('\n').find((l) => /^## \d/.test(l)) || ''
    return first.includes(PKG_VERSION)
  } catch { return false }
})(), 'CHANGELOG 顶部不是当前版本')

ok('MANIFEST 版本等于插件版本', (() => {
  try {
    const mf = readFileSync(new URL('./MANIFEST.txt', import.meta.url), 'utf8')
    return mf.includes(`# 版本：${PKG_VERSION}`)
  } catch { return false }
})(), 'MANIFEST 版本行不是当前版本')

ok(
  '切出 14 段（开篇 + 〇～十二 十三节），可多一节「边界」',
  fw.sections.length === 14
    || (fw.sections.length === 15 && String(fw.sections[14]?.title || '').includes('边界')),
  `${fw.sections.length} 段${fw.sections.length > 14 ? `（末节：${fw.sections[14]?.title}）` : ''}`,
)
ok('第一段是「是什么」', fw.sections[1].title.includes('是什么'), fw.sections[1].title)
ok('有骨架段', fw.sections.some((s) => s.title.includes('骨架')))

console.log('— 取段 —')
const sk = pickSections(fw.sections, ['1'])
ok('按序号 1 取到骨架', sk.length === 1 && sk[0].title.includes('骨架'), sk[0]?.title)
const crit = pickSections(fw.sections, ['判据'])
ok('按中文名取到判据', crit.length === 1 && crit[0].title.includes('判据'), crit[0]?.title)
const all = pickSections(fw.sections, 'all')
ok('all 返回全部', all.length === fw.sections.length)

console.log('— 截断 —')
const cut = truncate('甲'.repeat(100) + '\n\n' + '乙'.repeat(100), 120)
ok('超长会截断并留话', cut.length < 260 && cut.includes('余下略'))

console.log('— 出口自检 —')
const good = '嗯。这句我改口——上次说「这块地」，说成一块地就等于把它说成到场的东西。'
const g = checkText(good)
ok('好句子高分', g.score >= 0.88, `${g.score}`)
const bad = '总之，这个问题很好。第一，自由；第二，正义；第三，意识。作为一个 AI，我继续努力。'
const b = checkText(bad)
ok('坏句子被抓多条', b.issues.length >= 4, `${b.issues.length} 条：${b.issues.map((i) => i.label).join('、')}`)
ok('坏句子分低', b.score <= 0.75, `${b.score}`)
const ticOn = checkText('这套就说到这。回头聊。', { closingTics: ['回头聊'] })
const ticOff = checkText('这套就说到这。回头聊。')
ok('收尾口头禅：配了才查', ticOn.issues.some((i) => i.id === 'closing') && !ticOff.issues.some((i) => i.id === 'closing'))
const listy = '先说三件事：\n- 第一件事是甲\n- 第二件事是乙\n- 第三件事是丙\n' + '铺'.repeat(430) + '。'
const lc = checkText(listy, { casual: true })
const ln = checkText(listy)
ok('闲聊口径放宽长文与清单', lc.issues.length < ln.issues.length, `${lc.issues.length} < ${ln.issues.length}`)
ok('渲染出改口建议', renderCheck(b).includes('报了不认'))

console.log('— 结构自检 —')
const s1 = auditStructure('资本主义有民主，所以社会主义没有民主。这是本质决定的。')
ok('抓 01 误用', s1.issues.some((i) => i.id === 'binary'))
ok('抓绝对化没划范围', s1.issues.some((i) => i.id === 'absolute'))
const s2 = auditStructure('在这个系统里，它的范围只到三米；代价是维护贵。')
ok('有范围有残余就不报', s2.issues.length === 0, s2.issues.map((i) => i.id).join(','))
const s3 = auditStructure('因为他昨天没来，所以今天项目黄了。')
ok('抓因果缺路径', s3.issues.some((i) => i.id === 'causal'))
const s4 = auditStructure('研究表明，这样做更有效。')
ok('抓出处悬空', s4.issues.some((i) => i.id === 'source'))

console.log('— 按号取规则 —')
const aiText = readFramework(join(HERE, 'framework', 'FRAMEWORK.ai.md')).text
const r25 = findRule(aiText, '25')
ok('取到 R25', r25.includes('R25') && r25.includes('范围'), r25.slice(0, 30))
ok('取不到返回空', findRule(aiText, '99') === '')

console.log('— 槽位体检 —')
const dir = mkdtempSync(join(tmpdir(), 'framework-'))
mkdirSync(join(dir, 'persona'), { recursive: true })
const p1 = join(dir, 'persona', 'thin.md')
writeFileSync(p1, '# 甲\n\n## 身份\n名字是甲。\n', 'utf8')
const a1 = auditSlots(readFileSyncSafe(p1))
ok('薄人格缺必填两部分', a1.requiredMissing.length === 2, a1.requiredMissing.join('、'))
const p2 = join(dir, 'persona', 'full.md')
writeFileSync(p2, '# 乙\n\n## 身份\n名字是乙。\n\n## 语气\n短句。\n\n## 底线\n不撒谎。\n\n## 欲望\n吃饱。\n', 'utf8')
const a2 = auditSlots(readFileSyncSafe(p2))
ok('满人格必填齐', a2.requiredMissing.length === 0)
ok('建议部分认出一个', a2.rows.find((r) => r.id === 'desire').covered)
const p3 = join(dir, 'persona', 'hollow.md')
writeFileSync(p3, '# 丙\n\n## 身份\n一个温柔、聪明、有深度的灵魂。\n\n## 语气\n温暖、真诚、专业。\n\n## 底线\n永远善良。\n', 'utf8')
const dir2 = mkdtempSync(join(tmpdir(), 'pf-prog-'))
const a3 = auditSlots(readFileSyncSafe(p3))
ok('口号型判空心', a3.rows.filter((r) => r.hollow).length >= 2, `${a3.rows.filter((r) => r.hollow).length} 格`)
rmSync(dir, { recursive: true, force: true })

console.log('— 四个程序 —')
const p4 = join(dir2, 'p.md')
writeFileSync(p4, '# 丁\n\n## 身份\n名字是丁。\n\n## 语气\n短句。\n\n## 底线\n不撒谎。\n', 'utf8')
const rp = readPersona(p4)
ok('人格程序：读到三部分且不缺口', rp.ok && rp.missing.length === 0, rp.missing.join('、'))
const rp2 = readPersona(p4)
ok('人格程序：同一份人格指纹相同（保持的比对点）', rp.fingerprint === rp2.fingerprint, rp.fingerprint)
const lb = languageBetrayal('这句话是假的。海水是咸的因为盐进得去出不来。', {
  persona: '海水 盐 蒸发 电台',
  memory: '',
  body: '',
})
ok('语言背叛：指回自己的判自指', lb.selfRef.count === 1, `${lb.selfRef.count} 句`)
const lb2 = languageBetrayal('今天天气不错所以我要去放歌。', { persona: '电台 节目', memory: '', body: '' })
ok('语言背叛：落不回去的判无出处', lb2.noSource.length === 1, `${lb2.noSource.length} 句`)
rmSync(dir2, { recursive: true, force: true })

console.log('— 宿主替身：工具真跑一遍（不许把进程带崩）—')
{
  const unhandled = []
  const onUnhandled = (e) => unhandled.push(e)
  process.on('unhandledRejection', onUnhandled)
  const dir3 = mkdtempSync(join(tmpdir(), 'pf-host-'))
  const tools = []
  const routes = []
  // 故意在真进程里挂载：导入和执行都是真的，宿主只是替身。
  const { apply: mount } = await import('./index.js')
  mount({
    effect: (fn) => { try { fn() } catch { /* 这段挂不上就算，不影响断言 */ } },
    get: (name) => (name === 'workingDirectory'
      ? { ensure: async () => HERE, defaultDirectory: HERE }
      : undefined),
    tools: { register: (s) => { tools.push(s); return () => {} } },
    systemPrompt: { section: () => () => {} },
    webServer: { register: (s) => { routes.push(s); return () => {} } },
  }, { frameworkFile: BUNDLED, settingsFile: join(dir3, 'config.json') })
  // 同上：别数个数。加一个工具就红一次，那是把「有几个」当判据。
  {
    const names = tools.map((t) => t.name)
    const need = [
      'framework_view', 'framework_program', 'framework_check', 'framework_audit',
      'framework_digest', 'framework_next',
    'framework_doctor', 'framework_slots', 'framework_mood',
    ]
    const miss = need.filter((n) => !names.includes(n))
    ok('该有的工具都在', miss.length === 0, miss.length ? `缺 ${miss.join(', ')}` : names.join(','))
  }
  // 别数个数：加一个数据口就红一次，那是把「有几个」当成判据。查的是「该在的都在」。
  {
    const paths = routes.map((r) => r.path)
    const need = ['/api/persona-framework/status', '/api/persona-framework/config', '/api/persona-framework/optional']
    const miss = need.filter((p) => !paths.includes(p))
    ok('该有的数据口都在', miss.length === 0, miss.length ? `缺 ${miss.join(', ')}` : paths.join(','))
  }
  const prog = tools.find((t) => t.name === 'framework_program')
  const bodyOut = String((await prog.execute({ op: 'body' }, {})).text)
  ok('身体程序跑得通（没串到 HTTP 取体）', bodyOut.includes('身体程序') && bodyOut.includes('工作区'),
    bodyOut.split('\n')[0])
  const betrayOut = String((await prog.execute({ op: 'bind', text: '这句话是假的。' }, {})).text)
  ok('语言绑定程序跑得通', betrayOut.includes('语言绑定程序') && betrayOut.includes('自指'),
    betrayOut.split('\n')[0])
  ok('同一程序跑得通', String((await prog.execute({ op: 'identity' }, {})).text).includes('同一程序'))
  ok('残余程序跑得通', String((await prog.execute({ op: 'residue', text: '海水是咸的因为盐进去了出不来。' }, {})).text).includes('残余'))
  const res = { code: 0, body: '', writeHead(c) { this.code = c }, end(b) { this.body = String(b) } }
  const config = routes.find((r) => r.path.endsWith('/config'))
  await config.handler({ method: 'POST', text: async () => JSON.stringify({ maxChars: 4321 }) }, res)
  const saved = JSON.parse(res.body || '{}')
  ok('设置页能吃 fetch 风格请求体', res.code === 200 && saved.ok === true && saved.config?.maxChars === 4321, `code=${res.code}，maxChars=${saved.config?.maxChars}`)
  await new Promise((r) => setTimeout(r, 100))
  ok('没有未处理的 rejection', unhandled.length === 0, unhandled.map((e) => e?.message).join('；'))
  process.off('unhandledRejection', onUnhandled)
  rmSync(dir3, { recursive: true, force: true })
}

console.log('— 八个程序 —')
const rootFx = HERE
for (const [name, fn, kind] of [
  ['内部整合', readInternalIntegration, '内部整合'],
  ['外部整合', readExternalIntegration, '外部整合'],
  ['经验', readExperience, '经验'],
  ['理论', readTheory, '理论'],
]) {
  const r = fn(rootFx)
  ok(`${name}程序：报得出类型与池大小`, r.kind === kind && Array.isArray(r.dirs) && typeof r.totalChars === 'number', `${r.kind}/${r.count}`)
}
const seven = languageBetrayal('这句话是假的。海水是咸的因为盐进去了出不来。', {
  persona: '电台', memory: '节目', body: '工作区',
  internal: '体验 认知 现实 理想', external: '网页', experience: '会话', theory: '世界理解',
})
ok('语言背叛：八个池都报字数', Object.keys(seven.poolChars).length === 8, Object.keys(seven.poolChars).join(','))
ok('语言背叛：池子非空时不报「没有来源」', seven.empty === false)

const fwVer = (() => {
  try {
    const head = readFileSync(join(HERE, 'framework', 'FRAMEWORK.md'), 'utf8').split('\n').slice(0, 8).join('\n')
    const m = head.match(/版本：([0-9.]+)/)
    return m ? m[1] : ''
  } catch { return '' }
})()
const pjVer = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8')).version
ok('框架文档版本与插件版本一致', fwVer !== '' && fwVer === pjVer, `doc=${fwVer} pkg=${pjVer}`)

console.log('')
console.log(`通过 ${pass}，失败 ${fail}`)
process.exit(fail ? 1 : 0)

function readFileSyncSafe(p) {
  return readFileSync(p, 'utf8')
}
