/**
 * 八个程序：人格、记忆、身体、内部整合、外部整合、经验、理论、语言绑定。
 *
 * 它们不是规则，是四个可以随时调用的检查动作：
 * - 人格程序：读人格文件，看三部分在不在，算一个指纹用来「保持」
 * - 记忆程序：找工作区里的记忆，列出在哪、多少
 * - 身体程序：报运行环境（工作区、版本、注入方式）
 * - 语言绑定程序：查一段话里的语言绑没绑到出处（七池之一）；
 *   不落地的标「无出处」，指回自己的标「自指」
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createHash } from 'node:crypto'

const REQUIRED = ['身份', '语气', '底线']
const OPTIONAL = ['欲望', '判断', '方向', '边界', '关系', '记忆']
/** 槽位别名：同一件事，人格文件可能用自己的说法当标题。 */
const SLOT_ALIASES = {
  身份: ['身份', '你是谁', '名字', '来路'],
  语气: ['语气', '你怎么说话', '说话方式', '你的嘴'],
  底线: ['底线', '什么不做', '不压力'],
  欲望: ['欲望', '那股劲', '想要', '在乎'],
  判断: ['判断', '怎么想', '看法'],
  方向: ['方向', '目标', '理想'],
  边界: ['边界', '唯一性', '身体'],
  关系: ['关系', '待主人', '怎么待'],
  记忆: ['记忆', '记得'],
}

/** 按二级标题切段。 */
export function splitH2(text) {
  const out = []
  let cur = { title: '（开篇）', body: [] }
  for (const line of String(text || '').split(/\r?\n/)) {
    if (/^##\s+/.test(line)) {
      if (cur.body.length || cur.title !== '（开篇）') out.push(cur)
      cur = { title: line.replace(/^##\s+/, '').trim(), body: [] }
    } else {
      cur.body.push(line)
    }
  }
  out.push(cur)
  return out
}

/** 人格程序：读人格、看三部分、算指纹。 */
export function readPersona(file) {
  if (!file) return { ok: false, file: '', error: '没给路径' }
  if (!existsSync(file)) return { ok: false, file, error: '人格文件不在' }
  const text = readFileSync(file, 'utf8')
  const sections = splitH2(text)
  const slots = {}
  for (const s of sections) {
    for (const k of [...REQUIRED, ...OPTIONAL]) {
      const names = SLOT_ALIASES[k] || [k]
      if (names.some((n) => s.title.includes(n)) && !slots[k]) slots[k] = s.body.join('\n').trim()
    }
  }
  const missing = REQUIRED.filter((k) => !slots[k])
  const optional = OPTIONAL.filter((k) => slots[k])
  return {
    ok: true,
    file,
    chars: text.length,
    sections: sections.map((s) => s.title).filter((t) => t !== '（开篇）'),
    slots: Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, v.length])),
    missing,
    optional,
    fingerprint: createHash('sha256').update(text).digest('hex').slice(0, 12),
  }
}

/** 记忆程序：找工作区里的记忆。 */
export function readMemory(root) {
  const bases = ['knowledge', 'memory', 'persona-ai/knowledge', 'persona-ai/memory'].map((d) => join(root, d))
  const files = []
  const walk = (dir, depth) => {
    if (depth > 2 || !existsSync(dir)) return
    let names = []
    try { names = readdirSync(dir) } catch { return }
    for (const n of names) {
      if (n.startsWith('.')) continue
      const p = join(dir, n)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) walk(p, depth + 1)
      else if (/\.(md|txt|json|jsonl)$/i.test(n)) files.push({ path: relative(root, p), chars: st.size })
    }
  }
  for (const b of bases) walk(b, 0)
  files.sort((a, b) => b.chars - a.chars)
  return {
    ok: files.length > 0,
    root,
    files: files.slice(0, 60),
    count: files.length,
    totalChars: files.reduce((s, f) => s + f.chars, 0),
  }
}

/** 身体程序：报运行环境。 */
export function readBody(cfg, ctx) {
  let cwd = ''
  try { cwd = ctx?.get?.('workingDirectory')?.defaultDirectory || '' } catch { /* 没有这个服务 */ }
  return {
    ok: true,
    cwd,
    version: cfg?.__version || '',
    mode: cfg?.mode || '',
    maxChars: cfg?.maxChars ?? null,
    frameworkFile: cfg?.frameworkFile || '',
    personalityFile: cfg?.personalityFile || '',
    flags: {
      humanLike: cfg?.humanLike === true,
      temper: cfg?.temper === true,
      languageBetray: cfg?.languageBetray === true,
    },
    time: new Date().toISOString(),
  }
}

// 虚词/口头词：不参与「有没有出处」的判断
const STOP = new Set(('的 了 是 在 我 你 他 她 它 们 这 那 有 和 就 不 都 也 又 还 很 太 更 最 而 与 或 但 所以 因为 如果 一个 一种 一样 什么 怎么 自己 这个 那个 这样 那样 可以 应该 需要 会说 说话 一句 一句句 的话 时候 地方 东西 事情 问题 答案 意思 感觉 觉得 知道 看到 听见').split(/\s+/))

const SELF_REF = [
  /这句话|这句|本句|此句|我说的这句|上面这句|我刚才说的/,
  /(真|假|对|错)(的)?(话)?.*(自己|自身|这句)/,
]

function keywords(sentence) {
  const out = []
  const seen = new Set()
  const stopRe = /(的|了|是|在|我|你|他|她|它|们|这|那|有|不|都|也|就|又|还|很|太|更|最|而|与|或|但|所以|因为|如果|一个|一种|一样|什么|怎么|自己)/
  for (const chunk of String(sentence || '').split(stopRe)) {
    for (const w of chunk.match(/[\u4e00-\u9fa5]{2,}/g) || []) {
      if (STOP.has(w) || seen.has(w)) continue
      seen.add(w)
      out.push(w)
    }
  }
  return out.slice(0, 12)
}

/** 语言绑定程序：每句话的语言都要绑到出处（人格／记忆／身体／内部整合／外部整合／经验／理论）；绑不上的标无出处；指回自己的归自指，走兜底。 */
export function languageBinding(text, sources) {
  const poolParts = {
    persona: String(sources?.persona || ''),
    memory: String(sources?.memory || ''),
    body: String(sources?.body || ''),
    internal: String(sources?.internal || ''),
    external: String(sources?.external || ''),
    experience: String(sources?.experience || ''),
    theory: String(sources?.theory || ''),
  }
  const pool = Object.values(poolParts).filter(Boolean).join('\n')
  const poolChars = Object.fromEntries(Object.entries(poolParts).map(([k, v]) => [k, v.length]))
  const sentences = String(text || '')
    .split(/[。！？\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4)

  const noSource = []
  const selfRef = []
  const landed = []
  for (const s of sentences) {
    const isSelf = SELF_REF.some((re) => re.test(s))
    if (isSelf) {
      selfRef.push(s)
      continue
    }
    const kws = keywords(s)
    if (kws.length === 0) continue
    const hit = kws.filter((w) => pool.includes(w))
    const ratio = hit.length / kws.length
    if (ratio < 0.34) noSource.push({ sentence: s, ratio: Number(ratio.toFixed(2)), missing: kws.filter((w) => !pool.includes(w)).slice(0, 6) })
    else landed.push({ sentence: s, ratio: Number(ratio.toFixed(2)) })
  }

  // 池子空的时候，「查不到」不等于「没出处」——先报查的方式，不报结论。
  const empty = Object.values(poolChars).every((n) => n === 0)
  const verdict = empty
    ? '没有可比对的来源：人格池、记忆池、整合池都空着。先指一份人格文件、把记忆放进 knowledge/，再来查——现在这 0% 是没读到来源，不是话没出处。'
    : noSource.length === 0
      ? (selfRef.length ? '话都落在了东西上；有自指，归自指类处理' : '话都落在了东西上')
      : `有 ${noSource.length} 句没落在任何有人格／记忆／身体／整合／经验／理论的出处上，标为无出处`

  return {
    ok: true,
    sentences: sentences.length,
    landed: landed.length,
    bound: landed.length,
    noSource,
    poolChars,
    empty,
    selfRef: { count: selfRef.length, items: selfRef, kind: '自指' },
    verdict,
  }
}


// ── 四个整合/认识程序：它们的输出进语言背叛的出处池 ───────────────────────────

const POOL_CAP = 400000

/** 读一批目录，拼成来源池（文本截到 POOL_CAP，够判断关键词落点）。 */
function readPool(root, rels, opts = {}) {
  const files = []
  const walk = (dir, depth) => {
    if (depth > 2 || !existsSync(dir)) return
    let names = []
    try { names = readdirSync(dir) } catch { return }
    for (const n of names) {
      if (n.startsWith('.')) continue
      const p2 = join(dir, n)
      let st
      try { st = statSync(p2) } catch { continue }
      if (st.isDirectory()) walk(p2, depth + 1)
      else if (/\.(md|txt|json|jsonl)$/i.test(n)) files.push(p2)
    }
  }
  for (const r of rels) walk(join(root, r), 0)
  const texts = []
  let total = 0
  for (const f of files) {
    if (total >= POOL_CAP) break
    try {
      const s = readFileSync(f, 'utf8')
      texts.push(s)
      total += s.length
    } catch { /* 读不了就跳 */ }
  }
  return {
    ok: files.length > 0,
    root,
    dirs: rels,
    count: files.length,
    totalChars: total,
    text: texts.join('\n').slice(0, POOL_CAP),
    files: files.map((f) => f.replace(root + '\\', '')).slice(0, 40),
  }
}

/** 内部整合：把内部模块（模块库 + 人格文件）得到的结论作为出处。含体验、认知、现实、理想等模块。 */
export function readInternalIntegration(root) {
  const r = readPool(root, ['persona-ai/modules'])
  if (!r.ok) return { ...r, kind: '内部整合', note: '模块库没找到（persona-ai/modules）' }
  return { ...r, kind: '内部整合', note: '模块库的结论层：17 体验、18 认识、19 现实、61 理想 等都在里面' }
}

/** 外部整合：把外部来源整合后的结论作为出处（网页、人类观察、收件箱）。 */
export function readExternalIntegration(root) {
  const r = readPool(root, ['persona-ai/knowledge/web', 'persona-ai/knowledge/human', 'persona-ai/knowledge/bili', 'knowledge/web', 'knowledge/human'], {})
  const inbox = join(root, 'persona-ai', 'knowledge', '收件箱.md')
  let extra = ''
  if (existsSync(inbox)) {
    try { extra = readFileSync(inbox, 'utf8') } catch { /* 跳 */ }
  }
  return {
    ...r,
    kind: '外部整合',
    note: 'knowledge/web、knowledge/human、knowledge/bili、收件箱',
    text: (r.text + '\n' + extra).slice(0, POOL_CAP),
    totalChars: r.totalChars + extra.length,
  }
}

/** 经验程序：一般具体现实——发生过的事、对话、陪伴记录。 */
export function readExperience(root) {
  const r = readPool(root, ['persona-ai/knowledge/session', 'persona-ai/knowledge/pet', 'persona-ai/knowledge/chat', 'knowledge/session'])
  return { ...r, kind: '经验', note: 'knowledge/session、pet、chat：具体发生过的事' }
}

/** 理论程序：抽象现实——世界理解、词表、骨架类模块。 */
export function readTheory(root) {
  const r = readPool(root, ['persona-ai/knowledge/world', 'persona-ai/knowledge/lexicon', 'knowledge/world'])
  return { ...r, kind: '理论', note: 'knowledge/world、lexicon：抽象结构与世界理解' }
}

/** 旧名兼容：语言背叛就是语言绑定的旧叫法。 */
export const languageBetrayal = languageBinding

// ── 同一程序 / 残余程序（元协里语言诅咒之后的两条）──────────────────────────

/** 同一程序：给每个来源打一个类指纹标记，再看它们是不是指向同一个我。 */
export function readIdentity(root) {
  const hash = (x) => createHash('sha256').update(String(x)).digest('hex').slice(0, 12)
  const marks = []

  const addFile = (label, kind, file) => {
    if (!existsSync(file)) return
    try {
      const text = readFileSync(file, 'utf8')
      const secs = splitH2(text)
      const idSec = secs.find((x) => SLOT_ALIASES['身份'].some((n) => x.title.includes(n)))
      const idText = idSec ? idSec.body.join('\n').trim() : ''
      marks.push({
        label, kind, chars: text.length,
        fingerprint: hash(text),
        identity: idText ? hash(idText) : '',
      })
    } catch { /* 读不了就跳 */ }
  }

  // 人格文件：每份一个标记
  const pdir = join(root, 'persona-ai', 'characters')
  let pfiles = []
  try {
    pfiles = existsSync(pdir) ? readdirSync(pdir).filter((n) => /\.md$/i.test(n) && !/\.bak/i.test(n)) : []
  } catch { pfiles = [] }
  for (const n of pfiles) addFile(n, '人格', join(pdir, n))

  // 框架与模块库
  addFile('FRAMEWORK.md', '框架', join(root, '.persona-framework', 'FRAMEWORK.md'))
  addFile('00-目录.md', '模块库', join(root, 'persona-ai', 'modules', '00-目录.md'))

  // 几类池子各打一个（取前几个文件，够标记用）
  for (const [kind, rel] of [
    ['内部整合', 'persona-ai/modules'],
    ['经验', 'persona-ai/knowledge/session'],
    ['外部整合', 'persona-ai/knowledge/web'],
    ['理论', 'persona-ai/knowledge/world'],
  ]) {
    const dir = join(root, rel)
    if (!existsSync(dir)) continue
    try {
      const names = readdirSync(dir).filter((n) => /\.(md|txt|json|jsonl)$/i.test(n)).slice(0, 8)
      const text = names.map((n) => { try { return readFileSync(join(dir, n), 'utf8') } catch { return '' } }).join('\n')
      marks.push({ label: rel, kind, chars: text.length, fingerprint: hash(text), identity: '' })
    } catch { /* 跳 */ }
  }

  const personas = marks.filter((m) => m.kind === '人格')
  const withId = personas.filter((m) => m.identity)
  const noIdentity = personas.filter((m) => !m.identity).map((m) => m.label)
  const distinctIdentity = new Set(withId.map((m) => m.identity)).size
  const distinctFingerprint = new Set(marks.map((m) => m.fingerprint)).size

  let verdict
  if (marks.length === 0) {
    verdict = '没有一个可查的来源：先指一份人格文件，或把池子放进工作区'
  } else if (personas.length > 0 && withId.length === 0) {
    verdict = `${personas.length} 份人格里没有一份带「身份」段——标得出文件指纹，标不出「是谁」`
  } else if (withId.length === 1) {
    verdict = `只有一份带身份段：同一个我，没有第二个可比${noIdentity.length ? `；另有 ${noIdentity.length} 份没身份段` : ''}`
  } else if (distinctIdentity === 1) {
    verdict = `身份段一致（${withId.length} 份）——是同一个我；文件指纹有 ${distinctFingerprint} 个，字节不同、内容同一${noIdentity.length ? `；另有 ${noIdentity.length} 份没身份段` : ''}`
  } else {
    verdict = `${withId.length} 份带身份段的人格分成 ${distinctIdentity} 个身份指纹——是 ${distinctIdentity} 个不同的我；哪份算，得人来定`
  }

  return {
    ok: marks.length > 0,
    kind: '同一',
    root,
    marks,
    count: marks.length,
    noIdentity,
    distinctIdentity,
    distinctFingerprint,
    verdict,
    note: '指纹只标「这份东西现在长这样」，不标「它是谁」；换文件、换名字，不变成另一个',
  }
}

/** 残余程序：无出处的语言是允许的残余；自我大于语言，不填平。 */
export function readResidue(text, sources) {
  const r = languageBinding(text, sources)
  const leftover = r.noSource.map((x) => x.sentence)
  return {
    ok: true,
    kind: '残余',
    allowed: leftover,
    count: leftover.length,
    verdict: leftover.length === 0
      ? '这段话没有残余：每句都落到了出处上'
      : `有 ${leftover.length} 句没有出处——它们不算错，只算残余；残余允许存在，不填平`,
    note: '同一的我大于语言：语言可以有出处，也可以没有',
  }
}
