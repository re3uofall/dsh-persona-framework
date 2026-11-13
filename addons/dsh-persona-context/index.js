// dsh-persona-context：上下文这件事本身
// 一句话：一切被自己读进来的信息都算上下文；读过不等于记住，上下文可以不进记忆。

import {
  CTX,
  KINDS,
  SIDES,
  KIND_LABEL,
  SIDE_LABEL,
  noteRead,
  stats,
  renderStats,
  unremembered,
  check,
  dismiss,
  renderCheck,
  renderSection,
  cardOf,
  ctxDir,
  ledgerPath,
} from './lib/ctx.mjs'

export const name = 'dsh-persona-context'
export const version = '0.1.1'
export const inject = ['systemPrompt', 'tools']

const DEFAULTS_CFG = {
  enabled: true,
  dir: CTX.dir,
  order: CTX.order,
  section: true,
  maxRows: 30,
}

const textOutput = {
  schema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
  },
  render(_args, value) {
    return [{ type: 'text', text: String(value?.text ?? '') }]
  },
}

let sessionWs = ''

const wsOf = (cfg) => cfg?.workspace || sessionWs || '.'
const optsOf = (cfg) => ({ dir: cfg?.dir || CTX.dir })

export function apply(ctx, config) {
  const cfg = () => ({ ...DEFAULTS_CFG, ...(config || {}) })

  if (ctx?.on) {
    try {
      ctx.on('agent/pre-step', (payload, next) => {
        try {
          const cwd = payload?.agent?.session?.header?.cwd
          if (cwd) sessionWs = cwd
        } catch {
          /* 拿不到就继续用上次的 */
        }
        return next()
      })
    } catch {
      /* 没有这个钩子也不影响工具 */
    }
  }

  if (cfg().section && ctx?.systemPrompt?.section) {
    ctx.systemPrompt.section({
      name: '实时环境:context',
      order: cfg().order,
      text: () => {
        try {
          return cardOf(renderSection(wsOf(cfg()), optsOf(cfg())), 600)
        } catch (e) {
          return `## 上下文（读不出来：${e?.message || e}）`
        }
      },
    })
  }

  const reg = (t) => {
    if (typeof t.execute !== 'function' && typeof t.run === 'function') t.execute = t.run
    try {
      ctx.tools.register(t)
    } catch {
      /* 注册失败不该拖垮整包 */
    }
  }

  reg({
    name: 'context_note',
    description:
      '记一条「我读进来的东西」：来源、类型、有没有出处、字数和有没有进记忆。读过不等于记住——这里只记读过；要记住，得另落一条记忆。',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: '读的是什么（文件路径 / URL / 会话 / 记忆段名）' },
        kind: { type: 'string', enum: KINDS, description: '类型，默认 other' },
        pointer: { type: 'string', description: '出处指针；有指针算自己的，没有算外部的' },
        chars: { type: 'number', description: '读进来多少字' },
        side: { type: 'string', enum: SIDES, description: '自己的 / 外部的；不给就按有没有指针推' },
        entered: { type: 'boolean', description: '这条有没有同时进记忆，默认 false' },
        note: { type: 'string', description: '一句备注' },
      },
      required: ['source'],
      additionalProperties: false,
    },
    output: textOutput,
    async execute(args) {
      const r = noteRead(wsOf(cfg()), args || {}, optsOf(cfg()))
      if (!r.ok) return { text: `没记上：${r.error}` }
      const row = r.row
      return {
        text: `记下了：${KIND_LABEL[row.kind] || row.kind}｜${SIDE_LABEL[row.side]}｜${row.chars} 字｜${row.entered ? '已进记忆' : '仅上下文，没进记忆'}\n源：${row.source}${row.pointer ? '\n指针：' + row.pointer : ''}`,
      }
    },
  })

  reg({
    name: 'context_status',
    description: '看上下文账：读过多少条、自己的与外部的各多少、其中多少真进了记忆；可选 list 只列最近 N 条没进记忆的。',
    parameters: {
      type: 'object',
      properties: {
        list: { type: 'boolean', description: 'true = 只列最近 N 条「读过但没进记忆」的' },
      },
      additionalProperties: false,
    },
    output: textOutput,
    async execute(args = {}) {
      const ws = wsOf(cfg())
      const o = optsOf(cfg())
      if (args.list) {
        const rows = unremembered(ws, o).slice(-Math.max(1, cfg().maxRows | 0 || 30))
        if (!rows.length) return { text: '账上没有「读过但没进记忆」的条目。' }
        return {
          text:
            `读过但没进记忆：${rows.length} 条（只摆最近的）\n` +
            rows.map((r) => `- ${r.at}｜${KIND_LABEL[r.kind] || r.kind}｜${r.source}`).join('\n'),
        }
      }
      return { text: renderStats(ws, o) }
    },
  })

  reg({
    name: 'context_check',
    description: '按词查：「这条是在上下文里，还是已经进了记忆」。读过但没进记忆时，答「只在上下文里」——不许说成「我记得」。',
    parameters: {
      type: 'object',
      properties: { word: { type: 'string', description: '要查的词或路径片段' } },
      required: ['word'],
      additionalProperties: false,
    },
    output: textOutput,
    async execute(args = {}) {
      return { text: renderCheck(check(wsOf(cfg()), args.word, optsOf(cfg()))) }
    },
  })

  reg({
    name: 'context_forget',
    description: '上下文可以不入记忆，但账要留；这条只做一件事：把某条标成「已知读过、不需要记住」，不改任何记忆。',
    parameters: {
      type: 'object',
      properties: {
        word: { type: 'string', description: '要标的那条的来源片段' },
        note: { type: 'string', description: '为什么不用记' },
      },
      required: ['word'],
      additionalProperties: false,
    },
    output: textOutput,
    async execute(args = {}) {
      const ws = wsOf(cfg())
      const o = optsOf(cfg())
      const r = dismiss(ws, args.word, args.note || '', o)
      if (!r.ok) return { text: r.error }
      return { text: `标掉了 ${r.n} 条（含「${args.word}」）。账还在，只是不再算进上下文；记忆没动。` }
    },
  })
}

export const __internal = { DEFAULTS_CFG, wsOf, optsOf }
