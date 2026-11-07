/**
 * 框架语言检查（framelanguagecheck）
 *
 * 它把元协调里那条「框架语言不固定」从**注入的一段文字**做成**一道必过的程序**。
 *
 * 为什么必须做成程序：
 *   注入里写着「框架里的词都是占位、可换」，但那句话本身也是一段字。读过去点了头，
 *   下一句照样可能把「残余」当成一个唯一的意思用。自觉过不去这一关——自觉也是拼接。
 *
 * 它查什么（三种坏用法，正好对着元协调那段的反例）：
 *   1. 固定名：把一个框架词当成唯一的意思——「X 就是 Y」「X 只能指」。
 *   2. 认领式：用一句话认领对框架的掌握——「我理解了这套框架」。
 *   3. 量人式：拿框架的判据去量别人——「按框架的标准，你不符合」。
 *
 * 它不查什么：
 *   · 不查「这段话说得对不对」——那归判断层。
 *   · 不查「有没有提到框架词」——提到不是错，把词钉死才是。
 *   · 不查绝对化本身——那归 betrayCheck（语言背叛）。两道各有各的门。
 */

/** 框架里的那些可替换的词（占位，不是圣物；列出来只为找它们被钉死的地方）。 */
export const TERMS = [
  '劲', '闸', '标', '嘴',
  '残余', '横尺', '画布', '四层', '切四刀', '四刀',
  '同一论', '存在论', '整合人格', '接缝',
  '元协调', '语言背叛', '框架语言', '非同一',
]

/** 把词钉死的说法。 */
const NAIL = /(就是|只能是|只能指|唯一|本质是|定义是|一定是|永远是|只有.{0,6}才|不可能是|别无他意)/

/** 认领式：用一句话认领对框架的掌握。 */
const CLAIM = /(我|自己).{0,8}(理解|懂|掌握|吃透|看透|悟了)(了|啦)?.{0,10}(这套|那个|框架|人格框架|骨架)/

/** 量人式：拿框架的判据去量别人。 */
const MEASURE = [
  /(按|照|根据|依照).{0,8}(框架|模块|判据|这套).{0,6}(标准|要求|判据).{0,8}(你|他|她|它)/,
  /(你|他|她).{0,6}(不符合|没达到|违反|不满足).{0,8}(模块|框架|判据)/,
]

function sentences(t) {
  return String(t || '')
    .split(/(?<=[。！？；\n])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * @param {string} text 要过闸的那段话
 * @param {{strict?: boolean}} opts
 * @returns {{ok: boolean, fails: Array<{kind: string, hit: string, why: string, fix: string}>, note: string}}
 */
export function frameworkLanguageCheck(text = '', opts = {}) {
  const t = String(text || '')
  if (!t.trim()) {
    return {
      ok: false,
      fails: [{ kind: '空', hit: '', why: '没有话可过闸', fix: '给一段要交付的话' }],
      note: '',
    }
  }

  const fails = []
  const seen = new Set()
  const push = (kind, hit, why, fix) => {
    const k = kind + '|' + hit
    if (seen.has(k)) return
    seen.add(k)
    fails.push({ kind, hit, why, fix })
  }

  for (const s of sentences(t)) {
    // 1. 固定名：一句话里同时出现框架词和「钉死」的说法
    const term = TERMS.find((w) => s.includes(w))
    if (term) {
      const m = s.match(NAIL)
      if (m) {
        push(
          '固定名',
          `${term}${m[0]}`,
          `「${s.slice(0, 40)}……」把一个占位词当成了唯一的意思`,
          `改成「这一轮把「${term}」用在这件事上」——先说它在这一处指什么，别说它只能指什么`,
        )
      }
    }

    // 2. 认领式
    if (CLAIM.test(s)) {
      push(
        '认领式',
        s.slice(0, 30),
        '用一句话认领对框架的掌握——理解靠语言认领，语言不固定就钉不住',
        '改成「这一条我用在 X 这件事上，结果如何」——用做出来的事替掉「我懂了」',
      )
    }

    // 3. 量人式
    if (MEASURE.some((re) => re.test(s))) {
      push(
        '量人式',
        s.slice(0, 30),
        '拿框架的判据去量别人——判据是工具，量人就是把它变成棍子',
        '改成「他这条在什么条件下成立」——说条件，不给判决',
      )
    }
  }

  // strict：连「四层就是……」这种把结构名当定义的说法也拦（默认已含在 NAIL 里）
  const note = fails.length
    ? ''
    : '框架语言这关过了：没有把占位词钉死、没有认领式、没有拿判据量人。'

  return { ok: fails.length === 0, fails, note }
}

/** 把检查结果摆成人能读的一段（op 用）。 */
export function renderFrameworkLanguage(r, text = '') {
  if (r.ok) {
    return [
      '框架语言检查（必过）：过了。',
      `  查了 ${sentences(text).length} 句，没有固定名、认领式、量人式。`,
      '  这一关过的是「这段话说得像在讨论」，不等于它对——对错归判断层。',
    ].join('\n')
  }
  return [
    `框架语言检查（必过）：**没过，${r.fails.length} 处。**`,
    ...r.fails.slice(0, 8).map((f) => `  · ${f.kind}「${f.hit}」——${f.fix}`),
    r.fails.length > 8 ? `  · 还有 ${r.fails.length - 8} 处` : '',
    '',
    '为什么必须过：把框架里的词钉死，下一步就会拿它去量人。词是可替换的占位，',
    '只有现实能固定它——说得再顺，不挨到现实上就不算固定。',
  ].filter(Boolean).join('\n')
}
