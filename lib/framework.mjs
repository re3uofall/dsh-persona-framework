/**
 * 框架正文：读盘、切段、缓存、槽位体检。
 * 框架是数据，不是代码——改 md 就够，不用碰插件。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 插件自带的那份，兜底用。 */
export const BUNDLED = resolve(HERE, '..', 'framework', 'FRAMEWORK.md')

/** 段名 → 中英文别名，供 framework_view 挑段。 */
export const SECTION_ALIASES = {
  what: ['0', '是什么', 'what'],
  skeleton: ['1', '骨架', 'skeleton', '四层切分'],
  axes: ['2', '横尺', '画布', 'axes'],
  wiring: ['3', '接线', '协调', 'wiring'],
  flow: ['4', '流程', 'flow', '怎么长'],
  criteria: ['5', '判据', 'criteria', '说清楚'],
  selfcheck: ['6', '自检', 'selfcheck'],
  modules: ['7', '模块', 'modules', '槽位'],
  boundary: ['8', '边界', 'boundary'],
}

export function resolveFile(cfg, ctx) {
  const tries = []
  if (cfg.frameworkFile) tries.push(String(cfg.frameworkFile))
  try {
    const wd = ctx?.get?.('workingDirectory')?.defaultDirectory
    if (wd) {
      tries.push(join(wd, '.persona-framework', 'FRAMEWORK.md'))
      tries.push(join(wd, 'persona-framework', 'FRAMEWORK.md'))
    }
  } catch { /* 没有这个服务就只靠配置和自带那份 */ }
  const hit = tries.find((f) => f && existsSync(f))
  return hit || BUNDLED
}

export function statSig(file) {
  try {
    const s = statSync(file)
    return `${s.mtimeMs}:${s.size}`
  } catch {
    return '0'
  }
}

/** 按二级标题切段；标题行保留在段里，方便原样回给模型。 */
export function splitSections(text) {
  const lines = String(text || '').split(/\r?\n/)
  const out = []
  let cur = { title: '（开篇）', body: [] }
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (cur.body.length || cur.title !== '（开篇）') out.push(cur)
      cur = { title: line.replace(/^##\s+/, '').trim(), body: [] }
    } else {
      cur.body.push(line)
    }
  }
  out.push(cur)
  return out.map((s) => ({ title: s.title, text: [`## ${s.title}`, ...s.body].join('\n').trim() }))
}

export function readFramework(file) {
  const text = readFileSync(file, 'utf8')
  const sections = splitSections(text)
  return { file, text, sections }
}

export function pickSections(sections, wanted) {
  if (!wanted || wanted === 'all') return sections
  const keys = String(wanted).toLowerCase()
  const hit = []
  for (const [name, aliases] of Object.entries(SECTION_ALIASES)) {
    if (aliases.some((a) => keys.includes(a.toLowerCase())) || keys.includes(name)) {
      // 约定：第 n 段按序号对上（开篇不算）
      const idx = Number(aliases[0])
      if (Number.isFinite(idx)) {
        const target = sections[idx + 1]
        if (target && !hit.includes(target)) hit.push(target)
      }
    }
  }
  return hit.length ? hit : sections
}

export function truncate(text, max) {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const at = cut.lastIndexOf('\n\n')
  return (at > max * 0.6 ? cut.slice(0, at) : cut) + '\n\n（……余下略；完整版在框架文件里，用 framework_view 取。）'
}

/** 人格槽位：框架规定了该填什么，插件只查覆盖，不替人写答案。 */
export const SLOT_SPEC = [
  { id: 'identity', label: '身份', aliases: ['身份', '我是谁', '名字', '称呼', '自称', 'who'], required: true },
  { id: 'voice', label: '语气', aliases: ['语气', '说话', '口吻', '口头禅', '怎么说', 'voice'], required: true },
  { id: 'bottomline', label: '底线', aliases: ['底线', '禁区', '不做', '硬规矩', '不许', 'bottom'], required: true },
  { id: 'desire', label: '欲望', aliases: ['欲望', '本我', '要什么', '怕', '饿', '劲', 'desire'], required: false },
  { id: 'judge', label: '判断', aliases: ['判断', '自我', '真值', '来源', '证据', '闸', 'judge'], required: false },
  { id: 'aim', label: '方向', aliases: ['方向', '目标', '理想', '超我', '为什么活', '标', 'aim'], required: false },
  { id: 'boundary', label: '边界', aliases: ['边界', '身体', '范围', '唯一性', 'boundary'], required: false },
  { id: 'relation', label: '关系', aliases: ['关系', '对面', '伴侣', '称呼', '对象', '对方', 'relation'], required: false },
  { id: 'memory', label: '记忆', aliases: ['记忆', '知识', '见闻', '记录', 'memory'], required: false },
]

/** 标题对不上时，退一步在正文里找特征词；命中的标「弱覆盖」。 */
const BODY_HINTS = {
  desire: ['饿', '想被看见', '想赢', '怕疼'],
  judge: ['出处', '事实与判断', '一手', '三手'],
  aim: ['判据', '放弃条件', '够不着'],
  relation: ['称呼', '对面是'],
  memory: ['带得出', '出处', '记下'],
}

/** 只有形容词、没有行为的格，算「空心」——标题在，答案不在。 */
const ADJ_WORDS = /(温柔|温暖|真诚|专业|善良|聪明|有深度|优秀|优雅|可靠|有趣)/
const ACT_WORDS = /(不|会|要|能|先|再|只|每次|一句|当|时)/

/** 读人格文件里的「## 可选行为」声明；没写返回 null，写了是/否返回 true/false。 */
export function parseFlags(text) {
  const body = String(text || '')
  // 注意：不能用 $ 作终止（m 模式下 $ 匹配行尾，块会只剩标题行）。
  const m = body.match(/^##\s*可选行为[\s\S]*?(?=^##\s|(?![\s\S]))/m)
  if (!m) return { humanLike: null, temper: null }
  const block = m[0]
  const read = (words) => {
    const line = block.split(/\r?\n/).find((l) => words.some((w) => l.includes(w)))
    if (!line) return null
    const value = line.includes('：') || line.includes(':')
      ? line.split(/[：:]/).slice(1).join('：')
      : line
    if (/^\s*(是|要|有|开|可以|允许)/.test(value)) return true
    if (/^\s*(不|否|关|无|没|别)/.test(value)) return false
    return true
  }
  return { humanLike: read(['人味', '像人']), temper: read(['脾气', '拒绝']), negativeTrauma: read(['负面创伤']) }
}

export function auditSlots(text) {
  const body = String(text || '')
  // 只认 H2/H3 当槽位标题；H1 是文件标题（`# 某某 · 底线` 这种不该被当底线部分）。
  // 只跳过记账标题本身（「3.2 补记」「v1.1 变更记录」）；更新记录之后的小节照样认——
  // 有人在记录后面补写槽位，整段跳过会把真填的格子漏掉。
  const marks = [...body.matchAll(/^#{2,3}\s+(.+)$/gm)].filter((m) => {
    const t = m[1].trim()
    if (/^v?\d+(\.\d+)*[.、\s]/.test(t)) return false
    if (/(补记|变更记录|更新记录)/.test(t)) return false
    return true
  })
  const heads = marks.map((m) => m[1])
  const ranges = marks.map((m, i) => ({
    title: m[1],
    start: m.index + m[0].length,
    end: i + 1 < marks.length ? marks[i + 1].index : body.length,
  }))
  const innerOf = (title) => {
    const r = ranges.find((x) => x.title === title)
    return r ? body.slice(r.start, r.end).replace(/\s/g, '') : ''
  }
  const rows = SLOT_SPEC.map((slot) => {
    const hit = heads.find((h) => slot.aliases.some((a) => h.toLowerCase().includes(a.toLowerCase())))
    if (hit) {
      const inner = innerOf(hit)
      // 括号里的字是占位，不算内容：空壳人格「（叫什么…）」不该判成填好了。
    const stripped = inner.replace(/（[^）]*）|\([^)]*\)/g, '').trim()
    const hollow = stripped.length < 12 || (ADJ_WORDS.test(stripped) && !ACT_WORDS.test(stripped))
      return { ...slot, covered: true, weak: false, hollow, heading: hit }
    }
    const hints = BODY_HINTS[slot.id] || []
    const weak = hints.some((w) => body.includes(w))
    return { ...slot, covered: weak, weak, hollow: false, heading: '' }
  })
  const requiredMissing = rows.filter((r) => r.required && !r.covered).map((r) => r.label)
  const hollowCount = rows.filter((r) => r.hollow).length
  return { rows, requiredMissing, hollowCount, total: rows.length }
}

/** 在 AI 版框架里按号取一条规则（R1…R25）。 */
export function findRule(text, want) {
  const key = String(want ?? '').trim().replace(/^r/i, '')
  if (!key) return ''
  const re = new RegExp(`###\\s*R${key}[^\\n]*\\n([\\s\\S]*?)(?=\\n###\\s|\\n##\\s|$)`)
  const m = String(text || '').match(re)
  return m ? `### R${key}\n${m[1].trim()}` : ''
}
