// dsh-persona-card：卡片的两半——语言与逻辑、结构与拓扑。
// 语言那一半把一句话拆成有位置的卡（指称/谓词/连接/量词/模态/否定），
// 结构那一半把这些卡当图看：什么没变、什么变了、谁换了邻居（滑动）。
// 参考：语言学、逻辑学、形式逻辑；后结构主义、拓扑学。

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { buildCards, renderCards, CARD, KIND_LABEL } from './lib/lang.mjs'
import { invariants, compareSets, renderTopo, renderCompare, driftOf } from './lib/topo.mjs'

export const name = 'dsh-persona-card'
export const version = '0.1.0'
export const inject = ['systemPrompt', 'tools']

const DEFAULT = {
  workspace: '',
  dir: '.persona-framework',
  stateFile: '语言卡.json',
  showAfterCards: 3,
  maxChars: 4000,
}

const textOutput = {
  schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
  render(_args, value) {
    return [{ type: 'text', text: String(value && value.text != null ? value.text : '') }]
  },
}

function wsOf(cfg) {
  return cfg.workspace || process.cwd()
}

function statePath(cfg) {
  return join(wsOf(cfg), cfg.dir || DEFAULT.dir, cfg.stateFile || DEFAULT.stateFile)
}

function loadState(cfg) {
  try {
    const p = statePath(cfg)
    if (!existsSync(p)) return {}
    return JSON.parse(readFileSync(p, 'utf8')) || {}
  } catch {
    return {}
  }
}

function saveState(cfg, patch) {
  try {
    const p = statePath(cfg)
    mkdirSync(join(wsOf(cfg), cfg.dir || DEFAULT.dir), { recursive: true })
    const cur = loadState(cfg)
    const next = { ...cur, ...patch, at: new Date().toISOString() }
    writeFileSync(p, JSON.stringify(next, null, 2), 'utf8')
    return next
  } catch {
    return null
  }
}

function lastUserText(payload) {
  const msgs = payload && payload.messages
  if (!Array.isArray(msgs)) return ''
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m && m.role === 'user' && typeof m.content === 'string') return m.content
  }
  return ''
}

export function apply(ctx, config) {
  const cfg = { ...DEFAULT, ...(config || {}) }
  let sessionWs = ''

  ctx.effect(() => {
    const off = ctx.on('agent/pre-step', (payload, next) => {
      try {
        const cwd = payload && payload.agent && payload.agent.session && payload.agent.session.header
          ? payload.agent.session.header.cwd
          : ''
        if (cwd) {
          sessionWs = cwd
          if (!cfg.workspace) cfg.workspace = cwd
        }
      } catch {}
      return next()
    })
    return () => {
      try { if (typeof off === 'function') off() } catch {}
    }
  })

  ctx.systemPrompt.section({
    name: '实时环境:card',
    order: 45,
    text: () => {
      const st = loadState(cfg)
      if (!st || !st.lang) return ''
      const inv = st.topo || null
      const bits = []
      bits.push(`语言卡 ${st.lang.cards || 0} 张（连接 ${st.lang.edges || 0}，未定 ${st.lang.unresolved || 0}）`)
      if (inv) bits.push(`结构：${inv.nodes || 0} 点 / ${inv.edges || 0} 边 / 连通 ${inv.components || 0} / 环 ${inv.cycles || 0}`)
      if (st.lastCompare) bits.push(`上次比：加 ${st.lastCompare.added} 减 ${st.lastCompare.removed} 滑 ${st.lastCompare.slips} 漂移 ${st.lastCompare.drift}`)
      if ((st.lang.cards || 0) < (cfg.showAfterCards || DEFAULT.showAfterCards)) return ''
      return `卡片：${bits.join('｜')}（细节用 card_language / card_topo 回捞）`
    },
  })

  const register = (spec) => ctx.effect(() => ctx.tools.register({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    output: textOutput,
    async execute(args) {
      try {
        return { text: String(await spec.run(args && typeof args === 'object' ? args : {})) }
      } catch (error) {
        return { text: `没办成：${error && error.message ? error.message : String(error)}` }
      }
    },
  }))

  register({
    name: 'card_language',
    description: '语言与逻辑那一半：把一句话拆成有位置的卡（指称/谓词/连接/量词/模态/否定），连接词要写出它的真值规则。action=build 拆一句、show 看上次拆的、list 看卡的种类与连接词表。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['build', 'show', 'list'] },
        text: { type: 'string', description: '要拆的那句话（action=build 必填）' },
        source: { type: 'string', description: '出处（会话指针、文件行号）' },
        limit: { type: 'number', description: 'show 时最多列几张' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    run: (args) => {
      if (args.action === 'list') {
        const kinds = Object.entries(KIND_LABEL).map(([k, v]) => `${k}=${v}`).join('、')
        return `卡的种类：${kinds}\n连接词：∧ 合取（都真才真）、∨ 析取（一真即真）、¬ 否定（翻真值）、→ 蕴含（前真后假才假）、↔ 等值（同真同假）、∴ 推出（前提真则结论必须真）`
      }
      if (args.action === 'show') {
        const st = loadState(cfg)
        if (!st || !st.lang) return '还没拆过句子。用 card_language action=build text=… 拆一句。'
        return st.lang.rendered || '（上次的结果没存渲染文本）'
      }
      const text = String(args.text || '').trim()
      if (!text) return '要拆哪一句？给我 text。'
      const res = buildCards(text, { source: args.source || '', maxChars: cfg.maxChars })
      const inv = invariants(res)
      const rendered = renderCards(res)
      saveState(cfg, {
        lang: { cards: res.cards.length, edges: res.edges.length, unresolved: res.unresolved.length, rendered, at: res.at },
        topo: inv,
        lastSet: { cards: res.cards, edges: res.edges },
      })
      return rendered
    },
  })

  register({
    name: 'card_topo',
    description: '结构与拓扑那一半：把卡当图看——连通几段、有没有环、谁是断裂点；action=topo 看上次那张图，action=compare text=… 把新的一句和上次那张图比，报加了什么、减了什么、哪张卡换了邻居（滑动）、不变量破没破。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['topo', 'compare'] },
        text: { type: 'string', description: '要对比的新句子（action=compare 必填）' },
        source: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    run: (args) => {
      const st = loadState(cfg)
      if (args.action === 'topo') {
        if (!st || !st.lastSet) return '还没有图可看。先 card_language action=build。'
        const res = { cards: st.lastSet.cards || [], edges: st.lastSet.edges || [] }
        return renderTopo(res, { limit: args.limit || 12 })
      }
      const text = String(args.text || '').trim()
      if (!text) return '要和哪一句比？给我 text。'
      if (!st || !st.lastSet) {
        const res = buildCards(text, { source: args.source || '', maxChars: cfg.maxChars })
        saveState(cfg, { topo: invariants(res), lastSet: { cards: res.cards, edges: res.edges } })
        return '之前没有图，这一句先当了底。再用一句 compare 就能看出变化。'
      }
      const prev = { cards: st.lastSet.cards || [], edges: st.lastSet.edges || [] }
      const next = buildCards(text, { source: args.source || '', maxChars: cfg.maxChars })
      const cmp = compareSets(prev, next)
      const drift = driftOf(cmp)
      saveState(cfg, {
        topo: invariants(next),
        lastSet: { cards: next.cards, edges: next.edges },
        lastCompare: { added: cmp.added.length, removed: cmp.removed.length, slips: cmp.slips.length, drift },
      })
      return renderCompare(cmp, { limit: args.limit || 5 })
    },
  })
}
