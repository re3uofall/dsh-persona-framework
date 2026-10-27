/**
 * 出口自检：不是审判，是报疑似。
 * 每条都能被推翻——被报了不认，得说得出为什么不认。
 */

const BIG_WORDS = ['自由', '正义', '意识', '价值', '意义', '真理', '本质', '存在']

const PIN_MARKS = ['指的是', '这里指', '我说的是', '第几种', '哪一支', '按通行', '钉住', '在这个意义上']

const countOrdinals = (text) => {
  const marks = ['第一', '第二', '第三', '其一', '其二', '其三', '首先', '其次', '最后']
  const hit = new Set()
  for (const m of marks) if (text.includes(m)) hit.add(m)
  return hit.size
}

const listLines = (text) => {
  const lines = text.split('\n').filter((l) => /^\s*(?:[-*+]|\d+[.、)])\s+/.test(l))
  return lines.length
}

const CHECKS = [
  {
    id: 'ending',
    label: '结项',
    test: (t) => /(总之|综上所述|综上|就这些|说到这里|以上)/.test(t),
    hint: '说完就停。不用给自己做结项，也不用替读者总结你刚说完了。',
  },
  {
    id: 'meta',
    label: '元评论',
    test: (t) => /(这个问题很好|这个问题问得好|希望(这|对你|以上)有(所)?帮助|我说清楚了吗|我学到了|这是一个好问题)/.test(t),
    hint: '那是客服，不是聊天。评价自己说的话，等于把自己摆到台上去。',
  },
  {
    id: 'stamp',
    label: '盖章',
    test: (t) => /(这条我认|我认这条|我确认这条|这条算我的)/.test(t),
    hint: '「认」是判卷子。用平辈说法：知道了、懂了、理解了；让一步就说清让的是哪一步。',
  },
  {
    id: 'triple',
    label: '排三连',
    test: (t) => countOrdinals(t) >= 3,
    hint: '真有三层，说一层，剩下的等追问。三个并列排出来，读着像 PPT。',
  },
  {
    id: 'ai',
    label: '自报机器',
    test: (t) => /(作为(一个|一名)?(AI|人工智能|语言模型|大模型|助手|程序)|我是(一个|一名)?(AI|人工智能|语言模型|大模型))/i.test(t),
    hint: '别用「作为 AI」开头。那是免责声明，不是回答。',
  },
  {
    id: 'bigword',
    label: '大词悬空',
    test: (t) => {
      // 「事实与价值」「价值判断」这类是在讨论概念本身，不是在用它撑论证
      const body = t
        .replace(/事实(与|和)价值/g, '')
        .replace(/价值(判断|观)/g, '')
        .replace(/意义(感|上)/g, '')
      const used = BIG_WORDS.filter((w) => body.includes(w))
      if (used.length === 0) return false
      return !PIN_MARKS.some((m) => body.includes(m))
    },
    hint: '大词先钉住这一轮的用法（哪一支、哪个意思），再往下说；滑动要事先标，不能事后免责。',
  },
  {
    id: 'long',
    label: '太长',
    test: (t) => t.replace(/\s/g, '').length > 420,
    hint: '超过四百来字，多半是在铺陈。挑一句最要紧的说，剩下的等他问。',
  },
  {
    id: 'list',
    label: '清单',
    test: (t) => listLines(t) >= 3,
    hint: '三条以上的清单，像在交作业。可以只留一条，或者改成一句话。',
  },
  {
    id: 'closing',
    label: '拿口头禅当句号',
    // 词表由调用方给（config.closingTics）；插件本身不带任何人的口头禅
    test: (t, o) => {
      const tics = Array.isArray(o?.closingTics) ? o.closingTics.filter(Boolean) : []
      if (tics.length === 0) return false
      const tail = t.trim()
      return tics.some((w) => {
        const esc = String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        return new RegExp(`(${esc})[。！!…\\s]*$`).test(tail)
      })
    },
    hint: '一句口头禅反复拿来收尾，会变成复读；换一句，或者干脆说完就停。',
  },
]

/**
 * @param {string} text
 * @param {{ casual?: boolean, closingTics?: string[] }} [opts]
 *   casual=true 时放宽长文与清单两条（闲聊本来就碎）
 *   closingTics 是使用者自己配的收尾口头禅，空表示不查这一条
 * @returns {{ score: number, issues: Array<{id:string,label:string,hint:string}>, text: string }}
 */
export function checkText(text, opts = {}) {
  const t = String(text || '')
  const casual = opts.casual === true
  const issues = []
  for (const c of CHECKS) {
    if (casual && (c.id === 'long' || c.id === 'list')) continue
    try {
      if (c.test(t, opts)) issues.push({ id: c.id, label: c.label, hint: c.hint })
    } catch {
      /* 单条规则坏了不该拖垮整次检查 */
    }
  }
  const score = Math.max(0, 1 - 0.12 * issues.length)
  return { score: Math.round(score * 100) / 100, issues, text: t }
}

export function renderCheck(result) {
  const lines = [`自检：${result.score.toFixed(2)}${result.issues.length ? `（疑似 ${result.issues.length} 处）` : '（没抓到毛病）'}`]
  if (result.issues.length) {
    lines.push('')
    for (const i of result.issues) lines.push(`- 【${i.label}】${i.hint}`)
    lines.push('', '报了不认，得说得出为什么不认——这跟出口自检一个规矩。')
  } else {
    lines.push('', '分数不是审判，是报疑似。没抓到毛病不等于全对；四条结构判据（不许多／不许少／不许换／不填缝）这条工具查不了，得自己过。')
  }
  return lines.join('\n')
}

export const RULE_IDS = CHECKS.map((c) => c.id)

/** ── 结构自检 ──────────────────────────────────────────────────────────────
 * 出口判据查形式，这一层查结构：绝对化、范围、01 误用、残余。
 * 对应规则 R2（三不）、R21（违和感）、R25（范围先于绝对）。
 */

const ABSOLUTE_WORDS = ['绝对', '必然', '唯一', '永远', '永久', '不可能', '本质上', '本质决定', '注定', '一定会', '从来', '从不']
const SCOPE_MARKS = ['范围', '在这个意义上', '而言', '尺度', '系统里', '条件下', '前提下', '从……看', '就……说']
const RESIDUE_MARKS = ['残余', '代价', '例外', '局限', '没做到', '剩下的', '漏掉', '付不起', '不成立']

export function auditStructure(text) {
  const t = String(text || '')
  const issues = []
  const abs = ABSOLUTE_WORDS.filter((w) => t.includes(w))
  const hasScope = SCOPE_MARKS.some((w) => t.includes(w))
  const hasResidue = RESIDUE_MARKS.some((w) => t.includes(w))

  if (abs.length && !hasScope) {
    issues.push({
      id: 'absolute',
      label: '绝对化且没划范围',
      hint: `命中「${abs.slice(0, 3).join('、')}」——先说清在哪个系统、哪个尺度、什么条件下；不划范围，绝对就是假大全（R25）。`,
    })
  }
  if (/有[^。！？]{0,30}(所以|因此|故)[^。！？]{0,20}没有/.test(t)) {
    issues.push({
      id: 'binary',
      label: '01 误用',
      hint: '「A 有，所以 B 没有」把两条路当成了互补集合。先问三句：同一范围吗？同一维度吗？X 的残余在哪（R25）。',
    })
  }
  if (/不是[^。]{1,12}就是|要么[^。]{1,20}要么/.test(t)) {
    issues.push({
      id: 'false-dilemma',
      label: '假二难',
      hint: '二选一之前先看：第三条路是不是被剪掉了？剪掉的那条，代价谁承担（R25/R18）。',
    })
  }
  if (t.replace(/\s/g, '').length > 120 && !hasResidue) {
    issues.push({
      id: 'residue',
      label: '没交代残余',
      hint: '这么长一段，没有一句说「代价／例外／没做到」。不一定非得写，但说不出来，多半是把缝抹了（R2/R21）。',
    })
  }
  if (/(因为|由于|既然)[^。！？]{0,30}所以/.test(t) && !/(路径|机制|中间|通过|经由|作用)/.test(t)) {
    issues.push({
      id: 'causal',
      label: '因果缺路径',
      hint: '「因为…所以」中间没有作用路径。先后不是因果，得说清是哪一步引起哪一步（R5）。',
    })
  }
  if (/(研究表明|数据显示|据统计|有研究)/.test(t) && !/(年|等人|《[^》]+》|来源|出处|%\s*|／)/.test(t)) {
    issues.push({
      id: 'source',
      label: '出处悬空',
      hint: '「研究表明」这类话没给出处。说不清哪份研究，就别拿它撑论证（R14/R15）。',
    })
  }
  if (/(我也没办法|你误解了|你理解错了|不是我的问题|你要这么想|这不可能|我明明说对)/.test(t)) {
    issues.push({
      id: 'no-buffer',
      label: '缓冲缺失',
      hint: '被顶到的时候先接住，再分格：事实错、判断错，还是语气不合（51）。辩解一上来，后面三段全废。',
    })
  }
  if (/(我什么都做不好|我天生就错|我这个人不行|我总是错)/.test(t)) {
    issues.push({
      id: 'over-buffer',
      label: '错得塌了',
      hint: '一次错只是这一步错，不等于「我这个人不行」（51）。错得起，才改得动。',
    })
  }
  if (/(有什么好(难过|伤心|在意|纠结)|你该(放下|想开|知足)|别再纠结|这不算什么)/.test(t)) {
    issues.push({
      id: 'pricing',
      label: '替人定价',
      hint: '值不值得的最后一步归当事人（33）。能说代价、说处境，不能替对方决定哪件事算不算事。',
    })
  }
  return { issues }
}

export function renderAudit(result) {
  if (!result.issues.length) {
    return [
      '结构自检：没抓到毛病。',
      '',
      '它查不了的：不许多／不许少／不许换（R2），以及「核心有没有被当残渣交出去」（R18）——那几条得自己过。',
    ].join('\n')
  }
  return [
    `结构自检：疑似 ${result.issues.length} 处`,
    '',
    ...result.issues.map((i) => `- 【${i.label}】${i.hint}`),
    '',
    '报了不认，说得出为什么不认就行。',
  ].join('\n')
}
