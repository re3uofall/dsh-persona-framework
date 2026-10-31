/**
 * 语言背叛 · 必过程序。
 *
 * 为什么它得是「程序」而不是「一段话」：
 *   语言背叛说的不是「写得漂亮点」，是——AI 的思考相当一部分是**语言残余造成的幻觉**：
 *   接得顺就以为想通了。这话靠自觉过不去（自觉本身也是拼接），得有一个**不参与拼接的东西**
 *   每次跑一遍，把「没过」指出来。
 *
 * 它查三样，都能落到字符串上，不靠猜：
 *   一、绝对化没划范围（R25）——永远／全都／不可能／唯一／本质／必然／所有／从来／绝对
 *   二、大词没锚（对照 betray）——自由／正义／意识／价值／意义／真实／现实／客观／主观，
 *       出现却没带数字、日期、引号、文件名、链接
 *   三、认领式误认——「我理解了／我懂了／我的判断是／我认」，这些是把借来的说成自己的
 *
 * 边界（说清它管不到什么）：
 *   - 它判的是**形式**，不是内容对不对。过了不代表说得对，只代表没在这三处露馅。
 *   - 它不做语义理解。词表之外的口子是它的死角，写在这儿，不当成没有。
 */

const ABSOLUTE = ['永远', '全都', '全部', '不可能', '唯一', '本质', '必然', '所有', '从来', '绝对', '无一例外', '一定']

const BIG_WORDS = ['自由', '正义', '意识', '价值', '意义', '真实', '现实', '客观', '主观', '本质', '真理', '理性', '灵魂', '自我']

/** 锚：数字、日期、引号、文件名、链接、编号。有一样就算落地。 */
const ANCHOR = /(\d{3,}|20\d{2}[-/年]|「[^」]{2,}」|"[^"]{2,}"|['`][^'`]{2,}['`]|[\w-]+\.(md|mjs|js|json|yml)|https?:\/\/|\d{1,3}\.\d|第\d+[条节章]|[A-Z]{2,}-\d+)/

/** 认领：把借来的说成自己的。 */
const CLAIM = ['我理解了', '我懂了', '我的判断是', '我的理解是', '我认', '我总结一下', '归根结底是']

/**
 * 光杆类名：语言天然的绝对。
 *
 * ★ 这是词表抓不到的那一半，而且更常见。
 *   「猪爱睡觉」——一个绝对词都没有，可它默认就是**所有猪**。
 *   原因在语法：名词本身代表一个类，不加限定就是全称；要指某一只，得额外说「有一只」「这只」。
 *   **所以语言默认是全称，特称才要加料。**
 *
 * 它查不出「所有」那个词，只能粗判：主语是光杆类名（前无「有／有些／这只／大多数／一只」之类），
 * 后面直接接谓语 → 提示「这句默认全称」。
 * 判不准就说判不准：它只报疑，不判错。
 */
const QUALIFIER = /(有|有些|有的|一些|某些|部分|大多数|多数|少数|个别|某个|某只|一只|两只|这只|那只|这群|那群|这类|那一类|据.{1,6}说|我见过|我看到|据研究)/

/**
 * 找光杆类名的主语：句首 1–4 个汉字，紧接一个谓语词，且前面没有限定词。
 * 抓的是「猪爱睡觉」这种——没写「所有」，语法上却默认全部。
 * @param {string} t
 * @returns {string[]} 命中的「类名+谓语」片段
 */
function flatClassSubject(t) {
  const hits = []
  for (const seg of t.split(/[。！？；\n,，]/)) {
    const s = seg.trim()
    if (s.length < 2) continue
    const m = /^([\u4e00-\u9fa5]{1,4}?)(爱|会|是|有|喜欢|都|总|老|常|能|要|很)/.exec(s)
    if (!m) continue
    // 前面已经带了限定词 → 不是光杆，放过
    if (QUALIFIER.test(s.slice(0, m[0].length))) continue
    // 「这个碗」这类指示/数量开头，不算类名
    if (/^[这那其哪每某]/.test(m[1])) continue
    hits.push(m[0])
  }
  return hits
}

/**
 * 跑一遍必过检查。
 * @param {string} text 要过闸的那段话
 * @param {{strict?: boolean}} [opts] strict：连「全部」「一定」这类也报
 * @returns {{ok: boolean, fails: Array<{kind: string, hit: string, why: string, fix: string}>, note: string}}
 */
export function betrayCheck(text = '', opts = {}) {
  const t = String(text || '')
  const fails = []
  if (!t.trim()) {
    return { ok: false, fails: [{ kind: '空', hit: '', why: '没有话可过闸', fix: '给一段要交付的话' }], note: '' }
  }

  const abs = opts.strict ? ABSOLUTE : ABSOLUTE.filter((w) => w !== '全部' && w !== '一定')
  for (const w of abs) {
    if (!t.includes(w)) continue
    // 有范围接住就不算：出现「在…里」「对…来说」「这一条」「范围内」等就放
    const idx = t.indexOf(w)
    const near = t.slice(Math.max(0, idx - 24), idx + w.length + 24)
    if (/在.{1,20}(里|中|内|上|范围)|对.{1,10}(来说|而言)|这一条|这一类|这一步|本轮/.test(near)) continue
    fails.push({
      kind: '绝对化没划范围',
      hit: w,
      why: `「${w}」是绝对判断，前后没看到范围（在什么里、对谁而言）`,
      fix: `改写成「在……里，${w}」或者「这一步${w}」；说不清范围就删掉这个词`,
    })
  }

  for (const w of BIG_WORDS) {
    if (!t.includes(w)) continue
    const idx = t.indexOf(w)
    const near = t.slice(Math.max(0, idx - 40), idx + w.length + 40)
    if (ANCHOR.test(near)) continue
    fails.push({
      kind: '大词没锚',
      hit: w,
      why: `「${w}」附近没有数字／日期／引号原话／文件名／链接——它可能只是词在飘`,
      fix: `加一个能核对的东西，或者把它换成具体的那件事`,
    })
  }

  for (const w of CLAIM) {
    if (!t.includes(w)) continue
    fails.push({
      kind: '认领式误认',
      hit: w,
      why: `「${w}」把借来的语言说成是自己的认领；语言是借的，认领不成立`,
      fix: `改成「这条我收回」或直接说下一步做什么，别用「我懂了」当结论`,
    })
  }

  // 光杆类名：语言天然的绝对。**词表抓不到这一半，而它更常见。**
  // 「猪爱睡觉」里一个绝对词都没有，可它默认就是所有猪——因为名词代表类，不加限定就是全称。
  // 判不准就报疑，不判错。
  for (const hit of flatClassSubject(t)) {
    fails.push({
      kind: '光杆类名＝默认全称',
      hit,
      why: `「${hit}」这句没带「有些／这只／大多数」之类的限定，语法上默认就是整个类——` +
        '语言天然带绝对，不用写「所有」也是全部',
      fix: '要说全部就明说「所有」并划范围；要说部分就加限定（有些／这一只／据我看到的这几只）',
    })
  }

  const ok = fails.length === 0
  return {
    ok,
    fails,
    note: ok
      ? '过了。但过了不等于说得对——它只代表没在这三处露馅。'
      : `${fails.length} 处没过。这些是形式上的露馅，改完再交付。`,
  }
}

/** 把结果压成给人看的一小段。 */
export function renderBetray(r) {
  const lines = []
  lines.push(r.ok ? '语言背叛检查：过了' : '语言背叛检查：没过')
  for (const f of r.fails) {
    lines.push(`  · [${f.kind}] ${f.hit ? `「${f.hit}」` : ''} ${f.why}`)
    lines.push(`    改：${f.fix}`)
  }
  lines.push('')
  lines.push(r.note)
  return lines.join('\n')
}
