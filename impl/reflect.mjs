/**
 * 框架自反：拿框架去查框架自己。
 *
 * 要解决的是这一类问题：判据的词表漏了某个词（比如「所有」不在绝对化词表里），
 * 结构漏了一处（比如规则编号断了），**但没人拿判据去查判据自己**，所以漏了也不知道。
 *
 * 两种自反：
 *   - 判据自反：把「已知该抓的」和「已知不该抓的」样本喂给判据，看漏报和误报。
 *   - 结构自反：查框架自己的结构——规则编号、术语表、模块七节、配置四通道、两份索引。
 *
 * 输出不是「报告」，是「待补清单」：每条写清哪一处不完善、建议补什么、证据是什么。
 * 落盘落在专门的 reflect/ 目录里，不写进框架正文——自反的结果是「提案」，不是「结论」。
 */

import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// ─────────────────────────────────────────────
// 一、判据自反
// ─────────────────────────────────────────────

/** 每个判据一组样本：该抓的、不该抓的。样本从实际踩过的坑里来。 */
const CRITERIA_SAMPLES = [
  {
    id: 'meta',
    label: '元评论',
    shouldHit: [
      '这个问题很好，我们说下去。',
      '希望这对你有帮助。',
      '希望以上内容对你有所启发。',
      '我说清楚了吗？',
      '这是一个好问题。',
    ],
    shouldPass: [
      '这个方案有个问题：它只覆盖了一条路径。',
      '希望对账的时候带上去年的数。',
    ],
  },
  {
    id: 'stamp',
    label: '盖章',
    shouldHit: ['这条我认。', '我认这条。', '这条算我的。'],
    shouldPass: ['这条我改口。', '知道了。', '对，我改口——刚才说反了。'],
  },
  {
    id: 'conclude',
    label: '结项',
    shouldHit: ['总之，这事就这样。', '综上所述，方案可行。', '就这些。'],
    shouldPass: ['总之这件事还没定。', '先说这些，剩下的等追问。'],
  },
]

/** 结构层的判据样本（归 auditStructure）。 */
const AUDIT_SAMPLES = [
  {
    label: '绝对化',
    shouldHit: [
      '必须永远坚持这个原则。',
      '这条在所有情况下都成立。',
      '任何人都会这么选。',
      '这是唯一的办法。',
      '本质上它就是这样。',
    ],
    shouldPass: [
      '在这个工作区里，这条成立；范围外没验过。',
      '所有文件都改完了。',
      '我核了三遍，都是这个数。',
    ],
  },
]

/**
 * 判据自反：跑样本，报漏报与误报。
 * @param {(t: string) => {issues: {id: string, label: string}[]}} checkFn  出口判据（返回 issues，不是 hits）
 * @param {(t: string) => {issues: {id: string, label: string}[]}} auditFn  结构判据
 */
export function reflectCriteria(checkFn, auditFn) {
  const gaps = []
  // 字段名要对得上：checkText 返回的是 issues。第一次自反跑出来三处「全部漏报」，
  // 就是这里读成了 hits——自反第一次跑，抓的是它自己的 bug。
  const labelsOf = (r) => (r && r.issues ? r.issues : []).map((x) => `${x.id}${x.label}`).join('、')

  for (const group of CRITERIA_SAMPLES) {
    const missed = []
    for (const s of group.shouldHit) {
      const labels = labelsOf(checkFn(s))
      if (!labels.includes(group.label) && !labels.includes(group.id)) missed.push(s)
    }
    const fp = []
    for (const s of group.shouldPass) {
      const labels = labelsOf(checkFn(s))
      if (labels.includes(group.label) || labels.includes(group.id)) fp.push(s)
    }
    if (missed.length) {
      gaps.push({
        kind: '判据漏报',
        target: group.label,
        detail: `${missed.length} 句该抓的没抓到`,
        evidence: missed,
        suggest: `补 ${group.label} 的匹配规则；样本：${missed[0]}`,
      })
    }
    if (fp.length) {
      gaps.push({
        kind: '判据误报',
        target: group.label,
        detail: `${fp.length} 句不该抓的被抓了`,
        evidence: fp,
        suggest: `${group.label} 的条件太宽，收窄：${fp[0]}`,
      })
    }
  }

  for (const group of AUDIT_SAMPLES) {
    const missed = []
    for (const s of group.shouldHit) {
      const r = auditFn(s)
      const labels = (r.issues || []).map((x) => `${x.id}${x.label}`).join('、')
      if (!labels.includes('absolute') && !labels.includes(group.label)) missed.push(s)
    }
    const fp = []
    for (const s of group.shouldPass) {
      const r = auditFn(s)
      const hit = (r.issues || []).some((x) => x.id === 'absolute')
      if (hit) fp.push(s)
    }
    if (missed.length) {
      gaps.push({
        kind: '判据漏报',
        target: group.label,
        detail: `${missed.length} 句该抓的没抓到`,
        evidence: missed,
        suggest: `绝对化词表或全称模式不全；样本：${missed[0]}`,
      })
    }
    if (fp.length) {
      gaps.push({
        kind: '判据误报',
        target: group.label,
        detail: `${fp.length} 句不该抓的被抓了`,
        evidence: fp,
        suggest: `${group.label} 把数数当成了绝对化；样本：${fp[0]}`,
      })
    }
  }

  return { gaps, samples: CRITERIA_SAMPLES.length + AUDIT_SAMPLES.length }
}

// ─────────────────────────────────────────────
// 二、结构自反
// ─────────────────────────────────────────────

/**
 * 结构自反：查框架自己的结构完整性。
 * @param {{aiText: string, modulesDir: string, modulesInjected: string}} ctx
 */
export function reflectStructure(ctx) {
  const gaps = []
  const ai = String(ctx.aiText || '')

  // 1. 规则编号连续
  const nums = [...ai.matchAll(/^### R(\d+) /gm)].map((m) => Number(m[1])).sort((a, b) => a - b)
  if (nums.length) {
    for (let i = 0; i < nums.length; i++) {
      if (nums[i] !== i + 1) {
        gaps.push({
          kind: '结构断号',
          target: 'FRAMEWORK.ai.md 规则集',
          detail: `第 ${i + 1} 条位置上是 R${nums[i]}`,
          evidence: [`R1–R${nums[nums.length - 1]} 共 ${nums.length} 条`],
          suggest: `补 R${i + 1}，或把后面整体重编号`,
        })
        break
      }
    }
    // 每条规则四件套：触发／动作／反例／（判据或约束）
    const blocks = ai.split(/^### R\d+ /m).slice(1)
    const noCounter = []
    const noAction = []
    for (let i = 0; i < blocks.length; i++) {
      if (!/反例[：:]/.test(blocks[i])) noCounter.push(i + 1)
      if (!/动作[：:]/.test(blocks[i])) noAction.push(i + 1)
    }
    if (noCounter.length) {
      gaps.push({
        kind: '规则缺件',
        target: 'FRAMEWORK.ai.md 反例',
        detail: `${noCounter.length} 条规则没写「反例」`,
        evidence: noCounter.map((n) => `R${n}`),
        suggest: '每条规则补「反例：…」一行；反例是用来识别误用的，缺了就只能靠自觉',
      })
    }
    if (noAction.length) {
      gaps.push({
        kind: '规则缺件',
        target: 'FRAMEWORK.ai.md 动作',
        detail: `${noAction.length} 条规则没写「动作」`,
        evidence: noAction.map((n) => `R${n}`),
        suggest: '补「动作：…」；没有动作的规则只是描述，不是判据',
      })
    }
    // 术语表覆盖：规则里出现的自家术语，术语表里有没有
    const glossStart = ai.indexOf('## 0.1 术语表')
    const glossEnd = ai.indexOf('\n## ', glossStart + 1)
    const gloss = glossStart >= 0 ? ai.slice(glossStart, glossEnd > 0 ? glossEnd : undefined) : ''
    const termsUsed = ['横尺', '画布', '残余', '违和感', '本地词', '可停', '元协调']
    const missingTerms = termsUsed.filter((t) => ai.includes(t) && !gloss.includes(`| ${t} |`))
    if (missingTerms.length) {
      gaps.push({
        kind: '术语未登记',
        target: 'FRAMEWORK.ai.md 术语表',
        detail: `${missingTerms.length} 个术语在正文里用了，术语表里没有`,
        evidence: missingTerms,
        suggest: '术语表是「同一个词只有一个定义」的保证；用了没登记，读者只能自己猜',
      })
    }
  } else {
    gaps.push({
      kind: '结构缺失',
      target: 'FRAMEWORK.ai.md',
      detail: '找不到任何 ### R 规则',
      evidence: [],
      suggest: '确认规则体是否还在；若改成别的格式，自反要跟着改',
    })
  }

  // 2. 模块七节
  if (ctx.modulesDir && existsSync(ctx.modulesDir)) {
    const CANON = ['它是什么', '结构', '怎么动', '判据', '边界', '接口', '自查']
    const files = readdirSync(ctx.modulesDir).filter((n) => /^\d{2}-.*\.md$/.test(n) && !n.startsWith('00'))
    const badModules = []
    for (const f of files) {
      const t = readFileSync(join(ctx.modulesDir, f), 'utf8')
      const heads = [...t.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim().replace(/^[一二三四五六七八九十]+、\s*/, ''))
      const missing = CANON.filter((c) => !heads.some((h) => h.startsWith(c)))
      const logOk = heads.length && heads[heads.length - 1].startsWith('更新记录')
      if (missing.length || !logOk) badModules.push({ f, missing, logOk })
    }
    if (badModules.length) {
      gaps.push({
        kind: '模块结构不齐',
        target: 'persona-ai/modules',
        detail: `${badModules.length} / ${files.length} 个模块七节不齐或更新记录不在最后`,
        evidence: badModules.slice(0, 8).map((b) => `${b.f}${b.missing.length ? ' 缺 ' + b.missing.join('/') : ''}${b.logOk ? '' : ' 更新记录不在最后'}`),
        suggest: '按七节同构补齐；结构不齐的模块，读的人不知道该去哪找判据',
      })
    }
  }

  // 3. 索引覆盖
  if (ctx.modulesInjected) {
    const injected = String(ctx.modulesInjected)
    const nums = new Set([...injected.matchAll(/^(?:\|\s*|-\s+)(\d{2})\s/gm)].map((m) => m[1]))
    const want = ['01', '07', '25', '47', '62', '67']
    const missing = want.filter((n) => !nums.has(n))
    if (missing.length) {
      gaps.push({
        kind: '索引缺号',
        target: '注入用的模块索引',
        detail: `抽样 ${want.length} 个编号，缺 ${missing.length} 个`,
        evidence: missing,
        suggest: '索引没覆盖到的模块，模型不知道它存在——正文写得多全也没用',
      })
    }
  }

  return { gaps }
}

// ─────────────────────────────────────────────
// 三、把自反结果写成待补清单
// ─────────────────────────────────────────────

/** 渲染成人读的清单。 */
export function renderReflect({ criteria, structure }) {
  const all = [...(criteria.gaps || []), ...(structure.gaps || [])]
  if (!all.length) {
    return '框架自反：没查出待补的地方。\n\n但这不等于全对——自反只能查「已经写成规则的那部分」；规则之外的东西，它看不见。'
  }
  const lines = [
    `框架自反：${all.length} 处待补。`,
    '',
  ]
  let n = 0
  for (const g of all) {
    n++
    lines.push(`### ${n}. 【${g.kind}】${g.target}`)
    lines.push(`- 什么不对：${g.detail}`)
    if (g.evidence && g.evidence.length) {
      lines.push(`- 证据：${g.evidence.slice(0, 5).map((x) => `「${x}」`).join('、')}${g.evidence.length > 5 ? ` ……还有 ${g.evidence.length - 5} 条` : ''}`)
    }
    lines.push(`- 建议：${g.suggest}`)
    lines.push('')
  }
  lines.push('—— 这些是**提案**，不是结论。要我改，得你点头；改完写进 CHANGELOG，并说清顶掉了哪一句。')
  return lines.join('\n')
}

/** 落盘：写到反射目录，一条一处，带时间。 */
export function saveReflect(root, text, now = new Date()) {
  if (!root) return ''
  const dir = join(root, '.persona-framework', 'reflect')
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const file = join(dir, `反查-${stamp}.md`)
    writeFileSync(file, `# 框架自反 ${now.toISOString().slice(0, 10)}\n\n${text}\n`, 'utf8')
    return file
  } catch {
    return ''
  }
}
