// 人格练习：训练（机械重复）与蒸馏（机械模仿）。
// 判据：训练看「重复到第几轮」，蒸馏看「照着数能不能仿出来」。两者都不生成新意思。

import { join } from 'node:path'
import {
  TRAIN, addTarget, activeTargets, runRound, strengthOf, renderTargets, loadTargets,
} from './lib/train.mjs'
import {
  DISTILL, distill, saveProfile, loadProfile, imitate, renderProfile,
} from './lib/distill.mjs'
import { imitatePassage, renderPassage } from './lib/gen.mjs'

export const name = 'dsh-persona-practice'
export const version = '0.2.1'
export const inject = ['systemPrompt', 'tools']

const DEFAULTS = { enabled: true, dir: '.persona-framework' }

let sessionWs = ''

const textOutput = {
  schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
  render(_args, value) { return [{ type: 'text', text: String(value?.text ?? '') }] },
}

const cwdOf = (payload) => {
  try { return payload?.agent?.session?.header?.cwd || '' } catch { return '' }
}

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...(config || {}) }
  const ws = () => sessionWs || cfg.workspace || process.cwd()
  const stateDir = () => join(ws(), cfg.dir || DEFAULTS.dir)

  const register = (spec) => ctx.effect(() => ctx.tools.register({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    output: textOutput,
    async execute(args) {
      try {
        return { text: String(await spec.run(args && typeof args === 'object' ? args : {})) }
      } catch (error) {
        return { text: `没办成：${error && error.message ? error.message : error}` }
      }
    },
  }))

  ctx.on('agent/pre-step', (payload, next) => {
    try { const c = cwdOf(payload); if (c) sessionWs = c } catch {}
    return next()
  })

  if (cfg.enabled !== false) {
    ctx.systemPrompt.section({
      name: '实时环境:practice',
      order: 46,
      interpolate: false,
      text: () => {
        try {
          const rows = activeTargets(ws())
          if (!rows.length) return ''
          const lines = rows.slice(0, 3).map((t) => `- ${t.name}｜第 ${t.rounds} 轮｜强度 ${strengthOf(t).toFixed(2)}`)
          return ['## 人格练习（还欠的重复）', ...lines].join('\n')
        } catch { return '' }
      },
    })
  }

  register({
    name: 'practice_generate',
    description: '生成：给一段话（样本）就学它的口音，再生成若干条没见过、但句长/括号动作/句尾语气一致的句子。字级 n-gram，零依赖，本地毫秒级；生成完会对照样本查一次，整句照抄的不交。',
    parameters: {
      type: 'object',
      properties: {
        samples: { type: 'array', items: { type: 'string' }, description: '要学的那几段原话（至少 3 条，越多越稳）' },
        count: { type: 'number', description: '生成几条（1-8，默认 3）' },
        maxChars: { type: 'number', description: '每条最多多少字（12-200，默认 60）' },
        temperature: { type: 'number', description: '温度（0.3-2，默认 1；高一点更野）' },
      },
      required: ['samples'],
    },
    run: ({ samples, count, maxChars, temperature }) => {
      const r = imitatePassage(samples || [], { count, maxChars, temperature })
      return renderPassage(r)
    },
  })

  register({
    name: 'practice_train',
    description: '训练：把一个语言特征拆成例句，按轮次机械重复（action=add 建目标 / run 跑一轮 / list 看进度）。判据是重复到第几轮，不是「我理解了」。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'run', 'list'], description: '要干什么' },
        name: { type: 'string', description: '训练目标的短名（add 必填）' },
        examples: { type: 'array', items: { type: 'string' }, description: '例句，一句一条' },
        id: { type: 'string', description: 'run 时指定哪一条' },
      },
      required: ['action'],
    },
    run: ({ action, name, examples, id }) => {
      if (action === 'add') {
        const r = addTarget(ws(), { name, examples }, {}, Date.now())
        return r.ok ? `建好了：${r.id}（${r.examples} 条例句，默认 ${TRAIN.defaultRounds} 轮）` : `没收：${r.why}`
      }
      if (action === 'run') {
        const r = runRound(ws(), id, {}, Date.now())
        if (!r.ok) return `没跑成：${r.why}`
        return [`第 ${r.rounds}/${r.target} 轮：${r.line}`, `强度 ${r.strength.toFixed(2)}`].join('\n')
      }
      return renderTargets(loadTargets(stateDir()))
    },
  })

  register({
    name: 'practice_distill',
    description: '蒸馏：从若干原话里数出「口音」（句长、短句比、括号动作、句尾语气、口头禅），再照着这些数把一句话机械改一遍。action=learn 蒸馏并存档 / show 看档案 / imitate 仿一句。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['learn', 'show', 'imitate'], description: '要干什么' },
        samples: { type: 'array', items: { type: 'string' }, description: 'learn 时的样本原话' },
        text: { type: 'string', description: 'imitate 时要改的那句话' },
        action_why: { type: 'string', description: 'imitate 时括号里那个动作（可省）' },
      },
      required: ['action'],
    },
    run: ({ action, samples, text, action_why }) => {
      if (action === 'learn') {
        const p = distill(samples || [])
        if (!p.ok) return `没收：${p.why}`
        saveProfile(ws(), p)
        return renderProfile(p)
      }
      if (action === 'imitate') {
        const r = imitate(loadProfile(ws()), text, { action: action_why })
        return r.ok ? `仿：${r.line}` : `没仿成：${r.why}`
      }
      const p = loadProfile(ws())
      return p ? renderProfile(p) : '还没有档案。先用 learn 蒸馏一次。'
    },
  })
}
