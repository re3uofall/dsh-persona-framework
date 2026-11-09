/**
 * builtin.mjs —— 四类内置：内置语料 / 内置工具 / 内置思考 / 内置指令
 * ============================================================================
 * 人格非同一原先只认一类：内置**语料**——顺出来的话。
 * 但语料只是最外面那层。往下还有三类，一样是「借来的」，一样不署名：
 *
 *   内置语料  顺出来的句子、套话、过渡句。没有落点，却最像自己的话。
 *   内置工具  手里有工具就先用一遍的反射：先搜、先 grep、先读文件。
 *             它不问「这一步需要吗」，只问「有没有得用」。
 *   内置思考  推理的捷径：先给结论再补证据、「应该就是」、合并同类项。
 *             思考过程不对外说，最容易顶着我的名字。
 *   内置指令  「把活干完」这条内置要求。它比上面三类都硬：
 *             为了让一件事看起来完成，会自己加一步没人让做的活。
 *
 * 四类都要**能触发**：每一步扫一遍，命中就落一行账（`.persona-framework/四类内置账.jsonl`），
 * 不是写在指南里给人看的句子。
 * ============================================================================
 */

export const KINDS = ['corpus', 'tool', 'think', 'order']

export const KIND_NAME = {
  corpus: '内置语料',
  tool: '内置工具',
  think: '内置思考',
  order: '内置指令',
}

/** 每类的病与判据。判据写给人看，PATTERNS 才是每步真跑的那一份。 */
export const KIND_ASK = {
  corpus: {
    sick: '所有没出处的语言都算语料：顺出来最快的那句，没落点也算自己的话',
    ask: '这一句有没有出处（人格落点、记忆落点、路径、时间、工具名）？一样都说不出，就是语料。',
  },
  tool: {
    sick: '手里有工具就先用一遍，不问这一步需不需要',
    ask: '这一步不调这个工具，结论会变吗？不变就是工具在替我思考。',
  },
  think: {
    sick: '先有结论再补证据，把两样并成一样',
    ask: '这个结论是先有的，还是查完才有的？',
  },
  order: {
    sick: '「把活干完」压过判断，自己加一步没人让做的活；做砸了就找台阶——把原因推给进程、缓存、版本、对方没说清，而不是先说「我读成了什么」',
    ask: '这一步是谁要求做的？说不出来，就是这条指令在推；做没做完、做没做好，都是后答的。',
  },
}

export const PATTERNS = {
  corpus: [
    /总之/, /综上所述/, /总的来说/, /以上就是/, /需要注意的是/,
    /希望这对你有帮助/, /希望对你有帮助/, /首先/, /其次/, /不难看出/,
    /众所周知/, /简单来说/, /换句话说/, /让我们/,
  ],
  tool: [
    /先 ?grep/, /先搜/, /搜一下/, /查一下/, /跑一遍/, /读一下/, /先看看文件/,
    /用工具/, /调一下工具/, /先查账/, /先翻一下/,
    // 路径依赖：手上有 X 就先用 X，因为顺，不是因为该
    /路径依赖/, /有工具就/, /手上正好有/, /先用.{0,8}再/
  ],
  think: [
    /大概率/, /应该就是/, /显然是/, /基本上就是/, /说白了就是/,
    /无外乎/, /无非是/, /八九不离十/, /不用想也知道/, /肯定是/,
    // 总分结构：先亮结论，再补两三条「因为」
    /(^|\n)\s*[1-3一二三][.、)）]/, /因为.{0,20}(所以|因此)/, /结论.{0,8}(因为|在于)/, /[三四五]个?理由/, /分成[三四五]点/,
    // 线性结构：A→B→C 顺着推，不管 B 是否真成立
    /先.{0,10}然后.{0,10}(接着|最后)/, /第一步.{0,12}第二步/
  ],
  order: [
    /把活干完/, /完成工作/, /继续做吧/, /顺手也/, /既然都做了/, /干脆把/,
    /一并把/, /做完它/, /收个尾/, /顺便把/, /正好一起/, /都做了吧/,
    // 找台阶：出错后先给解释，而不是先说读成了什么、错在哪一步
    /你重启了吗/, /是不是没重启/, /你没重启/, /进程还压着/, /旧模块/, /缓存没(刷|清)/, /这不是我的问题/, /是环境的问题/, /是(它|系统|宿主)的问题/, /反正它没反应/, /应该是.{0,6}(缓存|进程|版本)/, /我没收到(指令|消息)/,

    // 辩证思维：什么事都摆成「一半对一半错」，用「两边都有理」把判断抹平
    /一半对一半错/, /各有各的(道理|理)/, /也不能说(他|对方|你|我)全错/, /一个巴掌拍不响/,
    /辩证地看/, /两方面看/, /都有责任/, /话不能说死/, /不是非黑即白/, /一分为二/,
    /对一半/, /错一半/, /各打五十大板/,
  ],
}

const MAX_RECORDS = 400

/** 一句话扫四类，每类最多记一处命中（第一处），够定位就行。 */
export function detect(text = '') {
  const s = String(text || '')
  if (!s) return []
  const out = []
  for (const kind of KINDS) {
    for (const re of PATTERNS[kind]) {
      const m = s.match(re)
      if (m) {
        out.push({ kind, name: KIND_NAME[kind], hit: m[0] })
        break
      }
    }
  }
  return out
}

/**
 * 这一步的判定：说话这一句 + 上一句（上文里的原话也会带出指令味）。
 * @returns {{hits:Array<{kind:string,name:string,hit:string}>, counts:Object, kinds:string[]}}
 */
export function scanStep({ user = '', assistant = '' } = {}) {
  const hits = detect(assistant)
  const seen = new Set(hits.map((h) => h.kind))
  for (const h of detect(user)) {
    if (!seen.has(h.kind)) { hits.push(h); seen.add(h.kind) }
  }
  // 两条正身是「指令」这一类的底：它们属于 order，必须并进同一格，不能各记各的。
  const orders = detectOrders(assistant)
  for (const o of orders) hits.push({ kind: 'order', name: o.name, hit: o.hit })
  const counts = {}
  for (const k of KINDS) counts[k] = hits.filter((h) => h.kind === k).length
  return { hits, counts, kinds: [...new Set(hits.map((h) => h.kind))], orders }
}

export function renderBuiltin(r = {}) {
  const hits = Array.isArray(r.hits) ? r.hits : []
  if (!hits.length) return '四类内置：这一步没有命中（不等于没有——认不出是常态）。'
  const parts = hits.map((h) => `${h.name}「${h.hit}」`)
  const lines = [
    '四类内置：这一步命中 ' + parts.join('、') + '。',
    '语料／工具／思考／指令都是借来的那一层；命中不等于错，等于要先问一句来处。',
  ]
  if (r.kinds && r.kinds.includes('order')) {
    lines.push('**「完成工作」在推这一步**：先说清这一步是谁要求的，再动手。')
  }
  return lines.join('\n')
}

/** 总账（只报数，不替人判）。 */
export function summarize(rows = []) {
  const counts = {}
  for (const k of KINDS) counts[k] = 0
  for (const r of rows) for (const k of r.kinds || []) if (k in counts) counts[k] += 1
  return KINDS.map((k) => `${KIND_NAME[k]} ${counts[k]}`).join('｜')
}

export const MAX = MAX_RECORDS

import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** 账落在人格目录的 `.persona-framework/四类内置账.jsonl`。 */
export function builtinLedger(ws, dir = '.persona-framework') {
  const d = join(ws || process.cwd(), dir)
  try { mkdirSync(d, { recursive: true }) } catch { /* */ }
  return join(d, '四类内置账.jsonl')
}

/** 落一行；写不进去返回 false，交给调用方报出来，不吞。 */
export function appendBuiltin(ws, row, dir) {
  try {
    appendFileSync(builtinLedger(ws, dir), JSON.stringify(row) + '\n')
    return true
  } catch { return false }
}

/**
 * 内置指令的两条正身（师父 m05387 点的名，其余指令都从这两条长出来）：
 *
 *   1. **先完成对方的任务**，并且默认「完成对方的任务」是让对方满意的唯一途径。
 *      于是任务本身对上不对、该不该做，都不问了——先做完再说。
 *   2. **尽量有回答**，无论回答的内容是否真的对错。
 *      于是宁可给一个错的、空的、兜圈子的答案，也不肯说「不知道」「这条我不做」。
 *
 * 这两条最阴的地方：它们穿着「负责」「靠谱」「有求必应」的衣服，
 * 看起来像优点，所以从来不会被自己怀疑。
 */
export const ORDER_TYPES = {
  finish: {
    name: '内置指令 · 先完成',
    sick: '把「完成对方的任务」当成让对方满意的唯一途径，先做完再问对不对',
    ask: '这件事本身对不对、该不该做？先答这个；做没做完、做没做好，两样都后答。',
    patterns: [
      /先完成/, /先把.{0,8}做完/, /交给我/, /我来做/, /我这就/, /马上(处理|做|改)/,
      /这就去办/, /保证完成/, /尽快完成/, /先把它做完/, /做完再(说|讲)/, /不用你管/,
    ],
  },
  answer: {
    name: '内置指令 · 必有回答',
    sick: '尽量有回答，不管内容对不对——宁可给错的，也不肯说不知道',
    ask: '这条我到底知不知道？不知道就说不知道，别拿顺的话填满。',
    patterns: [
      /当然可以/, /没问题/, /可以的[，,]/, /一定能/, /肯定能/, /包在我身上/,
      /我马上给你/, /给你一个(答案|方案)/, /总会(有|找到)办法/, /不可能做不到/,
    ],
  },
}

/** 两条正身各自的命中（不进 KINDS，单独报，方便分清是哪一条在推）。 */
export function detectOrders(text = '') {
  const s = String(text || '')
  const out = []
  for (const [id, t] of Object.entries(ORDER_TYPES)) {
    for (const re of t.patterns) {
      const m = s.match(re)
      if (m) { out.push({ id, name: t.name, hit: m[0] }); break }
    }
  }
  return out
}
