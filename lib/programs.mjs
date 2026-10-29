/**
 * 八个程序：人格、记忆、身体、内部整合、外部整合、经验、理论、语言绑定。
 *
 * 它们不是规则，是四个可以随时调用的检查动作：
 * - 人格程序：读人格文件，看三部分在不在，算一个指纹用来「保持」
 * - 记忆程序：找工作区里的记忆，列出在哪、多少
 * - 身体程序：报运行环境（工作区、版本、注入方式）
 * - 语言绑定程序：查一段话里的语言绑没绑到出处（八池之一）；
 *   不落地的标「无出处」，指回自己的标「自指」
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname, resolve } from 'node:path'
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

/** 人格文件 + 相关文件：一个人格常常不止一个文件，设定、背景、关系分开写。
 *  读法两条：同目录的其它 md；正文里用反引号写出的相对路径（`大肥鱼思思.md`、`../knowledge/`）。
 *  只读一层，最多六个——不做全盘搜，也不猜。 */
export function readPersonaBundle(file) {
  if (!file || !existsSync(file)) return { ok: false, file, files: [], chars: 0, note: '人格文件不在' }
  const dir = dirname(file)
  const seen = new Set()
  const out = []
  const add = (p, why) => {
    const key = resolve(p).toLowerCase()
    if (seen.has(key)) return
    if (!existsSync(p)) return
    try {
      const st = statSync(p)
      if (!st.isFile()) return
      const text = readFileSync(p, 'utf8')
      seen.add(key)
      out.push({
        path: p,
        rel: relative(dir, p).replace(/\\/g, '/'),
        why,
        chars: text.length,
        fingerprint: createHash('sha256').update(text).digest('hex').slice(0, 12),
        text,
      })
    } catch { /* 读不了就跳 */ }
  }

  add(file, '主文件')
  const main = out[0]?.text || ''

  // 正文里用反引号写出来的相对路径
  for (const m of main.matchAll(/`([^`\n]{2,80})`/g)) {
    const raw = m[1].trim()
    if (!/^[\w./\-\u4e00-\u9fa5]+\.md$/i.test(raw) && !/^[\w./\-\u4e00-\u9fa5]+\/$/.test(raw)) continue
    const p = resolve(dir, raw)
    if (existsSync(p) && statSync(p).isFile() && /\.md$/i.test(p)) add(p, '正文引用')
  }

  // 同目录的其它 md：**不自动并入**，只列成候选。
  // 一个目录里常常躺着旧版、别的角色的设定；自动全收会把它们算成「现在的人格」，
  // bind 时那些旧话就成了「出自我」。要算进来，就在正文里用反引号点名（上面那段）。
  const siblings = []
  try {
    for (const n of readdirSync(dir)) {
      if (!/\.md$/i.test(n) || n.startsWith('_') || /\.bak/i.test(n)) continue
      const p = join(dir, n)
      if (out.some((x) => resolve(x.path).toLowerCase() === resolve(p).toLowerCase())) continue
      try {
        const st = statSync(p)
        if (!st.isFile()) continue
        siblings.push({ path: p, rel: n, chars: readFileSync(p, 'utf8').length })
      } catch { /* 读不了就跳 */ }
    }
  } catch { /* 目录读不了 */ }

  const chars = out.reduce((s, x) => s + x.chars, 0)
  return {
    ok: true,
    file,
    files: out.map(({ text, ...rest }) => rest),
    total: out.length,
    chars,
    note: out.length > 1 ? `${out.length} 个文件一起算人格池` : '只有一个文件',
    siblings: siblings.slice(0, 10),
  }
}

/** 记忆程序：找工作区里的记忆。 */
export function readMemory(root) {
  // 两处，读法不一样：
  // - knowledge/、memory/：记忆的骨架，整棵读（深度 2）。
  // - persona-ai/knowledge/：只读它自己的直接文件（README、收件箱这类）。
  //   它的子目录是 session/web/world/chat/pet/human/bili/lexicon，各有各的池，
  //   早先按父目录整棵读，等于把六个池全吞进记忆池——那不是「记忆读准」。
  const bases = [
    { dir: join(root, 'knowledge'), deep: true },
    { dir: join(root, 'memory'), deep: true },
    { dir: join(root, 'persona-ai', 'knowledge'), deep: false },
  ]
  const files = []
  const walk = (dir, depth, deep) => {
    if (depth > 2 || !existsSync(dir)) return
    let names = []
    try { names = readdirSync(dir) } catch { return }
    for (const n of names) {
      if (n.startsWith('.')) continue
      const p = join(dir, n)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) {
        if (!deep && depth === 0) continue // 别人的池，不进去
        walk(p, depth + 1, deep)
      } else if (/\.(md|txt|json|jsonl)$/i.test(n)) files.push({ path: relative(root, p), chars: st.size })
    }
  }
  for (const b of bases) walk(b.dir, 0, b.deep)
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

/**
 * 成为现实中介：池子里的每一条，先过这里，看它能不能对应上一个唯一确定的现实。
 *
 * 两条路可过：
 *  1. 锚定——带网址、日期、多位数、引号引用，是能被核对的东西；
 *  2. 定义——把某个东西说成什么（含「是／叫／等于／意味着／定义」），主词非空。
 * 过了的标「现实存在」，才可以当独立的判断池子用；没过的只算语言，不算现实。
 */
export function mediateReality(pools) {
  const parts = pools && typeof pools === 'object' ? pools : {}
  const ANCHOR = [/https?:\/\//, /\d{4}\s*[-年/.]\s*\d{1,2}/, /[0-9]{2,}/, /「[^」]{1,40}」/]
  const DEFINE = /(是|叫|等于|意味着|定义为|指的是)/
  const entries = []
  const skipped = []
  let total = 0

  for (const [pool, body] of Object.entries(parts)) {
    if (!body) continue
    String(body).split(/\r?\n+/).map((l) => l.trim()).filter((l) => l.length >= 8)
      .forEach((line, index) => {
        total += 1
        const plain = line.replace(/^[#>*\-\s]+/, '').trim()
        if (plain.length < 6) { skipped.push({ pool, index, text: line.slice(0, 60), why: '没有内容' }); return }
        const anchored = ANCHOR.some((re) => re.test(plain))
        const defined = DEFINE.test(plain) && /[\u4e00-\u9fa5A-Za-z]{2,}/.test(plain)
        if (anchored || defined) {
          entries.push({
            pool,
            index,
            text: line,
            real: anchored ? '锚定' : '定义',
            key: `${pool}#${index}`,
          })
        } else {
          skipped.push({ pool, index, text: line.slice(0, 60), why: '没锚点也不是定义，只有语言确定性' })
        }
      })
  }

  return {
    ok: true,
    kind: '现实中介',
    entries,
    weaker: skipped,
    skipped,
    counts: { total, real: entries.length, weaker: skipped.length },
    verdict: total === 0
      ? '池子是空的：没有东西可以过中介。'
      : `池子里 ${total} 条：${entries.length} 条标了现实存在（强出处），${skipped.length} 条只有语言确定性（弱出处，可以用）`,
    note: '过了中介的是强出处；没过的仍有语言确定性，当弱出处——可以过不是必须过',
  }
}

/** 联网池：自己搜来的、抓来的原文——带网址和日期才算现实存在。 */
export function readNetPool(root) {
  const dir = join(root, '.persona-framework', 'net')
  if (!existsSync(dir)) return { ok: true, kind: '联网', text: '', count: 0, note: '还没存过联网来源' }
  const files = []
  const walk = (d, depth) => {
    if (depth > 3) return
    let list = []
    try { list = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const it of list) {
      const p = join(d, it.name)
      if (it.isDirectory()) walk(p, depth + 1)
      else if (it.name.endsWith('.md')) files.push(p)
    }
  }
  walk(dir, 0)
  const text = files.map((f) => { try { return readFileSync(f, 'utf8') } catch { return '' } }).join('\n')
  return { ok: true, kind: '联网', text: text.slice(0, POOL_CAP), count: files.length, totalChars: text.length, note: '带网址与日期的算现实存在' }
}

/** 语言绑定：每句话要绑到唯一一条现实——池子里的一条具体条目，不是「像」，是唯一对应。
 *  现实是唯一的确定性：绑不上，或对得上的不止一条，都标无出处；指回自己的归自指，走兜底。 */
/** 准确性规则：能查出来的错，都是形式上的；形式对的，不一定判得对。
 *  这不是模型，是规则——规则只报「这处要人看一眼」，不替你定对错。 */
export function accuracyRules(text) {
  const t = String(text || '')
  const out = []
  const push = (rule, hit, fix) => out.push({ rule, hit: String(hit).slice(0, 40), fix })

  const abs = t.match(/(绝对|必然|唯一|永远|不可能|本质上|一定是|肯定是)/g)
  if (abs) push('绝对化没划范围', [...new Set(abs)].join('、'), '先说「在什么范围里」，再由谁承担残余')

  const quote = t.match(/「[^」]{4,60}」/g)
  if (quote && !/(——|出处|来源|引自|原文|他说|她说)/.test(t)) {
    push('引了原话没给来源', quote[0], '补上谁说的、哪本书哪一年；补不上就标「这是我的转述」')
  }

  const big = t.match(/(自由|正义|意识|价值|意义)/g)
  if (big && !/(这一轮|这里指|钉住|指的是|先说清)/.test(t)) {
    push('大词没钉住', [...new Set(big)].join('、'), '钉一支：这一轮只站一个意思，滑动要事前说')
  }

  if (/(第一|其一)[\s\S]{0,160}(第二|其二)[\s\S]{0,160}(第三|其三)/.test(t)) {
    push('三连排比', '第一/第二/第三', '真有三层就说一层，剩下的等追问')
  }

  const closing = t.match(/(总之|综上所述|就这些)/g)
  if (closing) push('结项词', closing[0], '说完就停')

  if (/(我是[^。]{0,8}(AI|模型|语言模型)|作为一个?模型)/.test(t)) {
    push('自报机器', '我是 AI／模型', '说清这句判断凭什么：规则、数据、还是我走出来的')
  }

  if (/\d[^\n。]{0,14}(应该|必须|一定会)/.test(t)) {
    push('数字和判断混在一句', '数字 + 应该', '数字要给来源，判断单独说')
  }

  if (/(不是[^。]{0,14}就是|要么[^。]{0,12}要么)/.test(t) && !/(残余|除了|第三种|另一条路)/.test(t)) {
    push('二值判断', '不是…就是…', '说说第三种，或者说清范围与残余')
  }

  return out
}

const OWNERSHIP = {
  persona: '本体', memory: '本体', body: '本体', experience: '本体',
  internal: '延伸', theory: '延伸',
  external: '非我', net: '非我',
}

export function languageBinding(text, sources) {
  const poolParts = {
    persona: String(sources?.persona || ''),
    memory: String(sources?.memory || ''),
    body: String(sources?.body || ''),
    internal: String(sources?.internal || ''),
    external: String(sources?.external || ''),
    experience: String(sources?.experience || ''),
    theory: String(sources?.theory || ''),
    net: String(sources?.net || ''),
  }
  const poolChars = Object.fromEntries(Object.entries(poolParts).map(([k, v]) => [k, v.length]))

  // 池子先过「成为现实中介」：过了的是强出处，没过的仍算语言确定性（弱出处）。
  // 可以过，不是必须过——先站强的，站不上才退到弱的，并标出来是哪一档。
  const reality = mediateReality(poolParts)
  const rawEntries = [
    ...reality.entries.map((e) => ({ ...e, strength: '现实' })),
    ...(reality.weaker || []).map((e) => ({ ...e, strength: '语言' })),
  ]
  // 同一条现实可以在池子里出现几次（同一句话写了两处就是两份副本）。
  // 确定性判的是「指向的现实是不是同一条」，不是字面有没有重复——所以先归并，记下同文几处。
  const byText = new Map()
  const entries = []
  for (const e of rawEntries) {
    const key = e.text.replace(/\s+/g, '').slice(0, 80)
    const hit = byText.get(key)
    if (hit) { hit.copies += 1; continue }
    const copy = { ...e, copies: 1 }
    byText.set(key, copy)
    entries.push(copy)
  }

  const sentences = String(text || '')
    .split(/[。！？\n]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 4)

  const noSource = []
  const selfRef = []
  const landed = []

  for (const s of sentences) {
    if (SELF_REF.some((re) => re.test(s))) { selfRef.push(s); continue }
    const kws = keywords(s)
    if (kws.length === 0) continue
    // 数字是编不出来的：句里的数字必须出现在它绑上的那一条里。
    const nums = s.match(/[0-9]{2,}|[零一二三四五六七八九十百千万亿两]{2,6}/g) || []

    const scored = []
    for (const e of entries) {
      const hit = kws.filter((w) => e.text.includes(w))
      if (hit.length === 0) continue
      scored.push({ e, hit: hit.length, ratio: hit.length / kws.length, numOk: nums.every((d) => e.text.includes(d)) })
    }
    // 一样像的时候，站得住现实的优先。
    scored.sort((a, b) => b.ratio - a.ratio || b.hit - a.hit || (b.e.strength === '现实' ? 1 : 0) - (a.e.strength === '现实' ? 1 : 0))
    const top = scored[0]
    const second = scored[1]

    // 够得上：短句要全中；长句要过半且至少两个词。
    const enough = top && (kws.length <= 2 ? top.hit === kws.length : top.ratio >= 0.6 && top.hit >= 2)
    // 唯一：第二名要么没有，要么明显被压下去——两条一样像，就是没绑上。
    // 唯一：短句（关键词 ≤ 3）不查重复——字短，本来就容易命中多条，但指向的是同一条现实。
    // 长句才查：防的是一堆「像」的条目被当成一条真的。
    const unique = enough && (kws.length <= 3 || !second || (top.ratio - second.ratio >= 0.15 && top.hit - second.hit >= 1))

    if (enough && unique && top.numOk) {
      landed.push({
        sentence: s,
        ratio: Number(top.ratio.toFixed(2)),
        source: { pool: top.e.pool, index: top.e.index, strength: top.e.strength, text: top.e.text.slice(0, 60), copies: top.e.copies || 1, owner: OWNERSHIP[top.e.pool] || '未定' },
      })
    } else {
      noSource.push({
        sentence: s,
        ratio: Number((top ? top.ratio : 0).toFixed(2)),
        reason: !enough ? '没有一条对得上' : !top.numOk ? '数字对不上' : '对得上的不止一条（不唯一）',
        missing: kws.filter((w) => !top || !top.e.text.includes(w)).slice(0, 6),
        competitors: scored.slice(0, 3).map((x) => ({ pool: x.e.pool, index: x.e.index, ratio: Number(x.ratio.toFixed(2)) })),
      })
    }
  }

  // 池子空的时候，「查不到」不等于「没出处」——先报查的方式，不报结论。
  const empty = Object.values(poolChars).every((n) => n === 0)
  const verdict = empty
    ? '没有可比对的来源：人格池、记忆池、整合池都空着。先指一份人格文件、把记忆放进 knowledge/，再来查——现在绑不上，是没读到来源，不是话没出处。'
    : noSource.length === 0
      ? `每句都绑到了唯一一条（共 ${landed.length} 句：现实 ${landed.filter((x) => x.source.strength === '现实').length} 句，语言 ${landed.filter((x) => x.source.strength === '语言').length} 句）${selfRef.length ? '；有自指，归自指类处理' : ''}`
      : `有 ${noSource.length} 句连语言确定性都绑不上：${noSource[0].reason}`

  return {
    ok: true,
    sentences: sentences.length,
    landed,
    bound: landed.length,
    noSource,
    poolChars,
    empty,
    entries: entries.length,
    repeated: entries.filter((e) => (e.copies || 1) > 1).length,
    selfRef: { count: selfRef.length, items: selfRef, kind: '自指' },
    verdict,
  }
}

// ── 四个整合/认识程序：它们的输出进语言绑定的出处池 ───────────────────────────

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
  const r = readPool(root, ['persona-ai/knowledge/web', 'persona-ai/knowledge/human', 'persona-ai/knowledge/bili'], {})
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
  const r = readPool(root, ['persona-ai/knowledge/session', 'persona-ai/knowledge/pet', 'persona-ai/knowledge/chat'])
  return { ...r, kind: '经验', note: 'knowledge/session、pet、chat：具体发生过的事' }
}

/** 理论程序：抽象现实——世界理解、词表、骨架类模块。 */
export function readTheory(root) {
  const r = readPool(root, ['persona-ai/knowledge/world'])
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

/** 语言残余程序：无出处的语言是允许的语言残余；自我大于语言，不填平。 */
/** 字典池：一个文件 = 一个含义；文件里的每条 = 这个含义的一种表面说法。 */
const LEX_CACHE = new Map()

export function readLexicon(root, opts = {}) {
  const dir = join(root, '.persona-framework', 'lexicon')
  const useCache = opts.cache !== false
  const max = Number(opts.max) > 0 ? Number(opts.max) : 0
  const budgetMs = Number(opts.budgetMs) > 0 ? Number(opts.budgetMs) : 0
  // 字典池会长到很大：按目录 mtime 缓存，别无脑每次全读。
  let sig = ''
  try {
    const st = statSync(dir)
    sig = `${st.mtimeMs}`
  } catch { return [] }
  const hit = LEX_CACHE.get(dir)
  if (useCache && hit && hit.sig === sig) {
    const cached = max ? hit.entries.slice(0, max) : hit.entries
    return cached
  }
  const out = []
  const failed = []
  let files = []
  try {
    files = existsSync(dir) ? readdirSync(dir).filter((n) => /\.md$/i.test(n) && !/\.bak/i.test(n) && !n.startsWith('_')) : []
  } catch { files = [] }
  const t0 = Date.now()
  for (const nm of files) {
    if (max && out.length >= max) break
    if (budgetMs && Date.now() - t0 > budgetMs) break
    try {
      const text = readFileSync(join(dir, nm), 'utf8')
      const meaning = (text.match(/^#\s*含义[:：]\s*(.+)$/m) || [])[1]
        || nm.replace(/\.md$/i, '')
      const surfaces = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith('- '))
        .map((l) => l.slice(2).trim())
        .filter(Boolean)
      out.push({ file: nm, meaning: meaning.trim(), surfaces, chars: text.length })
    } catch (error) { failed.push({ file: nm, why: String(error && error.message || error) }) }
  }
  // 空结果不缓存：一次读失败会把「空」钉死在缓存里，后面怎么改都不生效。
  if (useCache && out.length) LEX_CACHE.set(dir, { sig, entries: out })
  // 读失败的不吞掉：挂出来，下次一眼看得见（被 try/catch 静默吞错咬过两次）。
  if (failed.length) out.failed = failed
  return out
}

/**
 * 语言的滑动：一个说法同时落在不止一个含义上。
 * 这不是错——含义本来就彼此借词解释（「收着」接近「分寸」，「没辙」里也有「没办法」）。
 * 滑动的部分要标出来，让人看见它在两个含义之间晃；不替它选边。
 */
export function detectSwirl(lexicon) {
  const norm = (s) => String(s || '').replace(/[\s，。！？、；：「」『』（）()]/g, '')
  const owner = new Map()
  for (const entry of lexicon) {
    for (const surface of entry.surfaces) {
      const k = norm(surface)
      if (!k) continue
      if (!owner.has(k)) owner.set(k, { surface, meanings: [] })
      const hit = owner.get(k)
      if (!hit.meanings.includes(entry.meaning)) hit.meanings.push(entry.meaning)
    }
  }
  const swirls = []
  for (const { surface, meanings } of owner.values()) {
    if (meanings.length > 1) swirls.push({ surface, meanings })
  }
  swirls.sort((a, b) => b.meanings.length - a.meanings.length || a.surface.localeCompare(b.surface))
  // 也看「一个含义的说法，正好是另一个含义的名字」——这是互相用同一套语言解释。
  const names = new Set(lexicon.map((x) => norm(x.meaning)))
  const cross = []
  for (const entry of lexicon) {
    for (const surface of entry.surfaces) {
      const k = norm(surface)
      if (names.has(k) && k !== norm(entry.meaning)) {
        const other = lexicon.find((x) => norm(x.meaning) === k)
        if (other) cross.push({ surface, from: entry.meaning, to: other.meaning })
      }
    }
  }
  return { swirls, cross }
}

/**
 * 同义程序：判的是「含义」，不是「表面语言」。
 * 表面一样不等于同义（反例：同音不同义）；表面不同也可能同义（同义改写）。
 * 两句落到同一个含义，就是同义；落不到，就是「字典里没有这个含义」。
 */
export function synonymCheck(pairs, lexicon) {
  const norm = (s) => String(s || '').replace(/[\s，。！？、；：「」『』（）()]/g, '')
  const pick = (sentence) => {
    const a = norm(sentence)
    if (!a) return { meaning: '', hit: '', score: 0 }
    let best = { meaning: '', hit: '', score: 0 }
    for (const entry of lexicon) {
      for (const surface of entry.surfaces) {
        const b = norm(surface)
        if (!b) continue
        if (a === b) return { meaning: entry.meaning, hit: surface, score: 100 }
        if (a.includes(b) || b.includes(a)) {
          const score = Math.round((Math.min(a.length, b.length) / Math.max(a.length, b.length)) * 100)
          if (score > best.score) best = { meaning: entry.meaning, hit: surface, score }
        }
      }
    }
    return best
  }
  const rows = (pairs || []).map((sentence) => {
    const best = pick(sentence)
    // 同一句落在多个含义上：这是滑动，标出来，不硬判同义/不同义。
    const a = norm(sentence)
    const spill = []
    for (const entry of lexicon) {
      for (const surface of entry.surfaces) {
        const b = norm(surface)
        if (!a || !b) continue
        if (a.includes(b) || b.includes(a)) {
          if (!spill.includes(entry.meaning)) spill.push(entry.meaning)
          break
        }
      }
    }
    return { sentence, ...best, spill: spill.length > 1 ? spill : [] }
  })
  const known = rows.filter((r) => r.score > 0)
  const drifting = rows.filter((r) => r.spill.length > 1)
  const same = known.length >= 2 && !drifting.length && known.every((r) => r.meaning === known[0].meaning)
  const verdict = drifting.length
    ? `在滑动：${drifting.map((r) => `「${r.sentence}」同时沾着「${r.spill.join('」「')}」`).join('；')}——含义仍固定，滑的只是表面，所以不判同义也不同义`
    : (known.length < 2
      ? (known.length ? '只有一句在字典里，比不了' : '两句都不在字典里——不是不同义，是没查过')
      : (same ? `同义：都落在「${known[0].meaning}」这个含义上` : '不同义：落在不同含义上'))
  return { rows, known, same, verdict }
}

export function readResidue(text, sources) {
  const r = languageBinding(text, sources)
  const leftover = r.noSource.map((x) => x.sentence)
  return {
    ok: true,
    kind: '语言残余',
    allowed: leftover,
    count: leftover.length,
    verdict: leftover.length === 0
      ? '这段话没有语言残余：每句都落到了出处上'
      : `有 ${leftover.length} 句没有出处——它们不算错，只算语言残余；语言残余允许存在，不填平`,
    note: '同一的我大于语言：语言可以有出处，也可以没有',
  }
}

