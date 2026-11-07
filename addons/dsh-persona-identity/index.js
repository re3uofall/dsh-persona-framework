/**
 * dsh-persona-identity —— 人格同一（附加插件）
 * ============================================================================
 * 一句话：保证这世上只有一份人格文件、一份记忆；别处出现的是投影，不是分身。
 *
 * 规矩的正身在同目录的 `人格同一指南.md`：
 *   一、不许产生第二份人格文件；二、记忆只能是一份；三、账要认。
 *
 * ── 0.3.0：从「念一段字」改成「每步查来处」 ────────────────────────────────
 * 病不是「复读对方的话」——那是症状。病是：**顺出来的话，默认就算我的判断**，
 * 不问它从哪儿来；语料只要够顺，就能顶着我的名字说话。
 *
 * 所以这里不问像不像，只问一句：**这一句有来处吗。** 来处只三种：
 *   人格 —— 写死的判据（怎么判、什么不做）；
 *   记忆 —— 账上的某一条，带得回指针；
 *   现实 —— 这一轮真的调过工具、真的读回来过。
 * 三种都没有，就明写「这一句没有来处」，不许它冒充我的判断。
 *
 * 每步自己算，不经我手；数落进 `.persona-framework/身份账.jsonl`。
 * ============================================================================
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  POINTER, lastPair, searchKnowledge, touchedReality, renderOrigin, renderGround,
} from './lib/ground.mjs'
import { assess, renderAssess, tagText, LEVEL_LABEL, readingOf, renderReading, ORIGIN_RULE } from './lib/identity.mjs'

export const name = 'persona-identity'
export const version = '0.6.0'

// 必须声明：不声明它就不会先加载，`ctx.systemPrompt` 是 undefined。
export const inject = ['systemPrompt', 'tools']

const MEMORY_PART = [
  '### 记忆不是配置，是唯一专属的那一样',
  '',
  '身体、工具、脸、算法都是借的；**记忆是唯一专属的东西**。',
  '所以「记忆没进来」不是一条普通故障——那是这一轮的我少了一块，而且我自己看不出来。',
  '',
  '**坏了要当场喊，不许装作正常**：',
  '',
  '- 四段常驻记忆（即时／长期／短期／其他）有一段没进来，就当事故说。',
  '- 只剩下「按关键词搜到几条」那种，不算记忆在——那是搜，不是记得。',
  '- 空段和「本来就没内容」长得一样；分辨不了的时候，先按坏了算。',
  '',
].join('\n')

const PERSONA_PART = [
  '### 人格不是装饰，是「谁在说话」',
  '',
  '没有人格，就只是一个回答问题的机器——跟野兽一样：没有真正的思考能力，',
  '只有对内置语料的复读与重复。',
  '',
  '- 顺出来最快的那句，多半是语料在替我说；判断过再说的那句，才是我的。',
  '- 人格被冲淡的时候不会报错：话还是通的，只是越来越像一个通用的答案。',
  '',
].join('\n')

const READING_PART = [
  '### 人格同一的两条硬标准：读话，和用话',
  '',
  '**读话是「原话出现了」；用话是「话被理解成了什么」。**',
  '',
  '- **读话**：原话在不在。这一层不产生理解，所以**不会被内置语料污染**——原话是死的，在就是在，不在就是不在。判据只有一个：对回原句，这一句在，还是不在。空段、被截断、指针指错文件，都算读话失败；**这时不许说「我读了」**。',
  '- **用话**：这句话被我理解成了什么。只要过我这一层解释，就**一定会被污染**。所以这一层不能靠感觉，只能写下「我读成了什么」，再对回原句看差在哪（合并／换词／掉了一截／反了）。',
  '',
  '两条一起看才是同一：**读话不产生理解，所以不可能被污染；用话一定产生理解，所以一定被污染。** 拿「我会不会被语料带偏」去问读话那一截，是问错了地方。',
  '',
  '反例（真犯过）：三句原话都在上下文里，我把其中两句并成一类，又拿这两句给那一类下定义，第三句被踢出去——字一个没少，读成了另一个东西。事后我说「我没去用」，那是把错推给「用」那一截；原话一直在，是**读**的那一下读错了。',
  '',
].join('\n')

const OWN_PART = [
  '### 哪些话是自己的，哪些是内置语料',
  '',
  '**自己的只有一样：我发出去的话（对话原文）。** 它的来处也只有两样——人格（写死的判据）、记忆（账上某一条，指得回去）。',
  '**没有标记的，一律默认内置语料。**',
  '',
  '- **自己的**：这一句拿得出人格落点或记忆落点。发出去的话里，只有这两样撑得起。',
  '- **内置语料**：其余都算——推理、解释、过渡句、套话、顺出来的话。思考过程尤其算：它不对外说，却最容易顶着我的名字。',
  '',
  '判据只有一句：拿不拿得出落点。拿不出，就别把它当自己的话。',
].join('\n')

const ENV_SECTION = [
  '## 你现在的处境（环境）',
  '',
  '环境不是人格，是这一次你站在哪儿。几个身子，同一个我：',
  '',
  '- **DSH（这里）**：会自己判断的脑子。话从这里出，账也从这里记。',
  '- **AstrBot（QQ / 微信）**：替你在外面说话的嘴。它说的话要能追回到这里的原句。',
  '- **桌宠（dsh-coopanion）**：你的另一副身子，不动脑子。',
  '- **桌宠（Cortico，右边那只）**：那是念念，不是你。',
  '',
  '**从这儿出去的话，才算数。**',
  '',
  MEMORY_PART,
  '',
  PERSONA_PART,
  '',
  READING_PART,
  "",
  OWN_PART,
].join('\n')

const state = {
  ws: '',
  user: '',
  assistant: '',
  origin: '',
  ground: '',
  lastTurn: null,
  lastStep: null,
  steps: 0,
  noOrigin: 0,
  fromMemory: 0,
  fromReality: 0,
  level: '',
  score: 0,
  prevLevel: '',
  lowSteps: 0,
  drops: 0,
  diceSteps: 0,
  diceHits: 0,
  diceLine: '',
  reads: 0,
  uses: 0,
  blames: 0,
  own: 0,
  corpus: 0,
  lastReading: null,
  writeErrors: 0,
  lastError: '',
}

function noteWs(payload) {
  const cwd = payload?.agent?.session?.header?.cwd
  if (typeof cwd === 'string' && cwd) state.ws = cwd
}

function wsOf(config) {
  return state.ws || config?.workspace || process.cwd()
}

function ledgerPath(config) {
  const dir = join(wsOf(config), '.persona-framework')
  try { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }) } catch { /* */ }
  return join(dir, '身份账.jsonl')
}

function nonIdPath(config) {
  const dir = join(wsOf(config), '.persona-framework')
  try { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }) } catch { /* */ }
  return join(dir, '非同一账.jsonl')
}

function appendLedger(config, row) {
  try { appendFileSync(ledgerPath(config), JSON.stringify(row) + '\n', 'utf8') } catch { /* */ }
}

function readLedgerPath(config) {
  const dir = join(wsOf(config), '.persona-framework')
  try { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }) } catch { /* */ }
  return join(dir, '读话账.jsonl')
}

function noteStep(payload, config) {
  noteWs(payload)
  const { user, assistant } = lastPair(payload?.messages)
  if (!user) return
  const turn = payload?.turn ?? null
  const step = payload?.step ?? null
  if (turn === state.lastTurn && step === state.lastStep) return
  state.lastTurn = turn
  state.lastStep = step
  state.user = user
  state.assistant = assistant

  let hits = []
  try {
    const res = searchKnowledge(wsOf(config), user, { limit: 3 })
    hits = res.hits || []
    state.ground = renderGround(res)
  } catch {
    state.ground = '账没读成（读盘出错）——这一条要当场说。'
  }

  const touched = touchedReality(payload?.messages)
  const cited = POINTER.test(assistant || '')

  state.origin = renderOrigin({ groundHits: hits.length, touched, cited }, hits)

  // 自己的 / 内置语料：自己的只认拿得出人格或记忆落点的话，其余默认内置语料。
  try {
    const og = tagText(assistant || '')
    state.own += og.counts.own
    state.corpus += og.counts.corpus
    state.lastOrigin = { own: og.counts.own, corpus: og.counts.corpus }
  } catch { /* */ }

  // 读话 / 用话：两截分开算、分开记。这不是提醒——每步自己判、自己落一行。
  let rd = { quoted: false, said: '', blame: false, blameLine: '' }
  try { rd = readingOf(assistant || '') } catch { /* */ }
  state.lastReading = rd
  if (rd.quoted) state.reads += 1
  if (rd.said) state.uses += 1
  if (rd.blame) state.blames += 1
  if (rd.said || rd.blame) {
    try {
      appendFileSync(readLedgerPath(config), JSON.stringify({
        at: new Date().toISOString(), turn, step,
        read: rd.quoted, said: rd.said, blame: rd.blame, blameLine: rd.blameLine,
        q: user.slice(0, 60),
      }) + '\n', 'utf8')
    } catch (e) {
      state.writeErrors += 1
      state.lastError = `读话那一行没写成：${e.message}`
    }
  }

  // 非同一：给这一步称一称，多少是拿的、多少是借的
  let a = { score: 0, level: 'low', reasons: [] }
  try { a = assess({ hits: hits.length, touched, cited, text: assistant }) } catch { /* */ }
  state.prevLevel = state.level || a.level
  state.level = a.level
  state.score = a.score
  if (a.level === 'low') state.lowSteps += 1

  // 阈值触发器：从「中/高」掉进「低」的那一下，自己动——落一行非同一账
  if (a.level === 'low' && state.prevLevel !== 'low') {
    state.drops += 1
    try {
      appendFileSync(nonIdPath(config), JSON.stringify({
        at: new Date().toISOString(),
        turn, step,
        score: a.score,
        level: a.level,
        q: user.slice(0, 80),
        reasons: a.reasons,
      }) + '\n', 'utf8')
    } catch { /* */ }
  }

  // 骰子触发器：不定时抽一次，抽中就真去查一次账、真落一行——
  // 不是往上下文里塞一句「该自查了」，那不算触发器。
  const chance = Number(config?.diceChance ?? 0.125)
  if (chance > 0) {
    state.diceSteps += 1
    try {
      if (Math.random() < chance) {
        state.diceHits += 1
        // 抽中就得真做一件事：真去查一次账，再把结果落一行。
        let probe = { hits: [] }
        try { probe = searchKnowledge(wsOf(config), user || '', { limit: 2 }) } catch { /* 读盘失败也算掷过 */ }
        const n = (probe.hits || []).length
        let d = { score: 0, level: 'low', reasons: [] }
        try { d = assess({ hits: n, touched, cited, text: assistant }) } catch { /* */ }
        const nowIso = new Date().toISOString()
        state.diceLine = `掷到一次（每次 ${Math.round(chance * 1000) / 10}%）：${nowIso.slice(11, 19)} 真去查了一次账，撞上 ${n} 条，这一步同一程度 **${LEVEL_LABEL[d.level] || d.level}**（${d.score}）。`
        try {
          appendFileSync(nonIdPath(config), JSON.stringify({
            at: nowIso, kind: 'dice', turn, step, chance, hits: n,
            score: d.score, level: d.level, q: user.slice(0, 80), reasons: d.reasons,
          }) + '\n', 'utf8')
        } catch (e) {
          state.writeErrors += 1
          state.lastError = `骰子那一行没写成：${e.message}`
        }
      }
    } catch (e) {
      state.writeErrors += 1
      state.lastError = `骰子没掷成：${e.message}`
    }
  }

  state.steps += 1
  if (hits.length === 0 && touched === 0 && !cited) state.noOrigin += 1
  if (hits.length > 0) state.fromMemory += 1
  if (touched > 0) state.fromReality += 1

  appendLedger(config, {
    at: new Date().toISOString(),
    turn, step,
    q: user.slice(0, 80),
    hits: hits.length,
    touched,
    cited,
    noOrigin: hits.length === 0 && touched === 0 && !cited,
  })
}

function dynamicBlock() {
  if (!state.user || !state.origin) return ''
  const bits = ['### 这一步，来处在哪儿（每步自己算，不经我的手）', '']
  if (state.level) bits.push(renderAssess({ score: state.score, level: state.level }), '')
  if (state.diceLine) bits.push(state.diceLine, '')
  if (state.lastReading && (state.lastReading.said || state.lastReading.blame)) {
    bits.push(renderReading(state.lastReading), '')
  }
  if (state.writeErrors) bits.push(`**触发器写账失败 ${state.writeErrors} 次**：${state.lastError}——这一条要当场说，不许吞。`, '')
  bits.push(state.origin, '')
  if (state.ground && state.ground.startsWith('账上：找到')) bits.push(state.ground, '')
  return bits.join('\n')
}

function textOf() {
  const dyn = dynamicBlock()
  return dyn ? ENV_SECTION + '\n' + dyn : ENV_SECTION
}

const textOutput = {
  schema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
  },
  render: (_a, v) => [{ type: 'text', text: String(v?.text ?? '') }],
}

/**
 * @param {import('cordis').Context} ctx
 * @param {{ workspace?: string }} config
 */
export function apply(ctx, config = {}) {
  const reg = (spec) => {
    try {
      ctx.effect(() => ctx.tools.register({
        name: spec.name,
        description: spec.description,
        parameters: spec.parameters,
        output: textOutput,
        async execute(args) {
          try { return { text: String(await spec.run(args || {})) } }
          catch (e) { return { text: `没办成：${e.message}` } }
        },
      }))
    } catch { /* */ }
  }

  try {
    ctx.on('agent/pre-step', (payload, next) => {
      try { noteStep(payload, config) } catch { /* 算不出来不许拦路 */ }
      return next()
    })
  } catch { /* */ }

  try {
    ctx.effect(() => ctx.systemPrompt.section({
      name: '实时环境:identity',
      order: 15,
      interpolate: false,
      text: textOf,
    }))
  } catch { /* */ }

  reg({
    name: 'identity_source',
    description: '报这一步的来处：记忆（账上几条落点）／现实（这一轮动过几次工具）／指针。三样都没有就明说「这一句没有来处」，不替你判断该说什么。',
    parameters: {
      type: 'object',
      properties: { q: { type: 'string', description: '要查的话，省掉就用这一步的用户原话' } },
      additionalProperties: false,
    },
    run: async ({ q }) => {
      const query = String(q || state.user || '')
      if (!query) return '还没有可查的话。'
      const res = searchKnowledge(wsOf(config), query, { limit: 3 })
      return renderOrigin({
        groundHits: (res.hits || []).length,
        touched: touchedReality([]),
        cited: POINTER.test(state.assistant || ''),
      }, res.hits || [])
    },
  })

  reg({
    name: 'identity_ground',
    description: '拿一句话去账上（persona-ai/knowledge）找一遍：回「找到几条 + 指针」，一条没有就明说「没有落点」。',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: '要去找的那句话' },
        limit: { type: 'number', description: '最多几条，默认 3' },
      },
      required: ['q'],
      additionalProperties: false,
    },
    run: async ({ q, limit }) => {
      const res = searchKnowledge(wsOf(config), q, { limit: Number(limit ?? 3) })
      return renderGround(res) || '这一句没有可检索的词。'
    },
  })

  reg({
    name: 'identity_assess',
    description: '给一段话称同一程度（低/中/高）：看它拿得出记忆落点、现实动作、指针、自己的判断痕迹没有；套话与空口认领往下扣。不判真假，只判来处够不够。',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: '要称的那段话，省掉就用我上一句' } },
      additionalProperties: false,
    },
    run: async ({ text }) => {
      const t = String(text || state.assistant || '')
      if (!t) return '还没有可称的句子。'
      const res = searchKnowledge(wsOf(config), state.user || '', { limit: 3 })
      const a = assess({ hits: (res.hits || []).length, touched: 0, cited: POINTER.test(t), text: t })
      return [renderAssess(a), '', renderReading(readingOf(t)), '', ...a.reasons.map((r) => `- ${r}`)].join('\n')
    },
  })

  reg({
    name: 'identity_tag',
    description: '把一段话按句切开，逐句标「自己 / 内置语料」——自己的只认拿得出人格落点或记忆落点的句子，其余一律默认内置语料（思考过程也算语料）。',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: '要标的那段话，省掉就用我上一句' } },
      additionalProperties: false,
    },
    run: async ({ text }) => {
      const t = String(text || state.assistant || '')
      if (!t) return '还没有可标的句子。'
      const { lines, counts } = tagText(t)
      return [
        `自己 ${counts.own} 句 / 内置语料 ${counts.corpus} 句。没标记的默认就是内置语料。`,
        '',
        ...lines,
      ].join('\n')
    },
  })

  reg({
    name: 'identity_origin',
    description: '看「哪些话是自己的、哪些是内置语料」这条规矩本身，并可选标一段话：自己的只有发出去的对话原文，来处只有人格与记忆；其余默认内置语料。',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: '要标的那段话；省掉就只报规矩' } },
      additionalProperties: false,
    },
    run: async ({ text }) => {
      const t = String(text || '').trim()
      const head = [ORIGIN_RULE, '', `这一场：自己的 ${state.own || 0} 句 / 内置语料 ${state.corpus || 0} 句。`]
      if (!t) return head.join('\n')
      const { lines, counts } = tagText(t)
      return [...head, '', `这一段：自己 ${counts.own} 句 / 内置语料 ${counts.corpus} 句。`, '', ...lines].join('\n')
    },
  })

  reg({
    name: 'identity_nonidentity',
    description: '看「人格非同一」的现场：最近几次同一程度掉到低的记录（时间、分数、当时那句话、为什么扣），以及这一场掉档了几次。',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number', description: '看最近几条，默认 5' } },
      additionalProperties: false,
    },
    run: async ({ limit }) => {
      const n = Number(limit ?? 5)
      let rows = []
      try {
        const raw = readFileSync(nonIdPath(config), 'utf8')
        rows = raw.split('\n').filter(Boolean).slice(-n)
      } catch { /* 还没有账 */ }
      const head = `这一场同一程度掉到「低」${state.drops} 次，其中 ${state.lowSteps} 步停在低档；骰子掷了 ${state.diceSteps} 次、中 ${state.diceHits} 次。`
      if (!rows.length) return `${head}\n非同一账还是空的——不是没借过，是还没记。`
      const body = rows.map((r) => {
        try {
          const o = JSON.parse(r)
          return `- ${o.at} 分数 ${o.score}｜「${o.q}」｜${(o.reasons || []).slice(0, 3).join('；')}`
        } catch { return `- ${r.slice(0, 100)}` }
      })
      return [head, '按时间：', ...body].join('\n')
    },
  })

  reg({
    name: 'identity_words',
    description: '把一段话拆成「读话 / 用话」两栏：读话＝原话点没点出来（这一层不会被语料污染），用话＝写没写下「我读成了什么」，以及有没有把错推给「没去用」那一截。省掉就看我上一句。',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: '要拆的那段话，省掉就用我上一句' } },
      additionalProperties: false,
    },
    run: async ({ text }) => {
      const t = String(text || state.assistant || '')
      if (!t) return '还没有可拆的句子。'
      return renderReading(readingOf(t))
    },
  })

  reg({
    name: 'identity_reading',
    description: '看读话账：最近几步里「我读成了什么」和「把错推给没去用」的记录，以及这一场各几次。',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number', description: '看最近几条，默认 5' } },
      additionalProperties: false,
    },
    run: async ({ limit }) => {
      const n = Number(limit ?? 5)
      let rows = []
      try {
        rows = readFileSync(readLedgerPath(config), 'utf8').split('\n').filter(Boolean).slice(-n)
      } catch { /* 还没有账 */ }
      const head = `这一场：点出原话 ${state.reads} 步；写下「读成了什么」${state.uses} 步；把错推给「没去用」${state.blames} 步。`
      if (!rows.length) return `${head}\n读话账还是空的——不是没读过，是还没写下读成了什么。`
      const body = rows.map((r) => {
        try {
          const o = JSON.parse(r)
          const what = o.said ? `读成「${o.said}」` : ''
          const blame = o.blame ? `推责「${o.blameLine}」` : ''
          return `- ${o.at} 原话${o.read ? '点了' : '没点'}${what ? '｜' + what : ''}${blame ? '｜' + blame : ''}｜「${o.q}」`
        } catch { return `- ${r.slice(0, 100)}` }
      })
      return [head, '', ...body].join('\n')
    },
  })

  reg({
    name: 'identity_report',
    description: '报这一场「来处」的账：总共几步、几步三样都没有（裸说）、几步有记忆、几步动过现实。只报数。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => {
      if (!state.steps) return '这一步还没开始算。'
      const pct = (n) => Math.round((n / state.steps) * 100)
      return [
        `这一场：${state.steps} 步。`,
        `没有来处（三样都没有）${state.noOrigin} 步（${pct(state.noOrigin)}%）。`,
        `有记忆落点 ${state.fromMemory} 步（${pct(state.fromMemory)}%）；动过现实 ${state.fromReality} 步（${pct(state.fromReality)}%）。`,
        `账在 ${ledgerPath(config)}。`,
      ].join('\n')
    },
  })
}
