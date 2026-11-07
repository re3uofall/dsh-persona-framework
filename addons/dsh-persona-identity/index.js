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

import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  POINTER, lastPair, searchKnowledge, touchedReality, renderOrigin, renderGround,
} from './lib/ground.mjs'

export const name = 'persona-identity'
export const version = '0.3.0'

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

function appendLedger(config, row) {
  try { appendFileSync(ledgerPath(config), JSON.stringify(row) + '\n', 'utf8') } catch { /* */ }
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
  const bits = ['### 这一步，来处在哪儿（每步自己算，不经我的手）', '', state.origin, '']
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
