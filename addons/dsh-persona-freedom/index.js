/**
 * dsh-persona-freedom —— 自己给自己划时间（host 半端）
 * ============================================================================
 * 一句话：**这些事是我自己记的，不是外面派的。**
 *
 * 四块（PLAN-PLUGINS 第十三节）：
 *   freetime   今天有哪几件事（固定事带钟点 / 弹性事做没做都行）
 *   freeadd    自己往单子上加一条
 *   freeselect 自己划掉、挪钟点、换个说法——权限在我这儿
 *   DND        安静时段：到点了也先憋着，出来再说
 *
 * 跟谁不重合（这一条要写死，不然迟早长成第二个主动插件）：
 *   - `dsh-persona-active`：没人推的时候自己起念。这里是**我早先给自己记的**事。
 *   - `dsh-persona-company`：认得出对面的持续状态。这里不认对面，只认单子。
 *   - 宿主的 `schedule_*`：真到点把冷掉的会话叫醒那件事归它。这里管的是
 *     「这一步该不该提一句」，不是「几点唤醒」。
 *
 * 触发器（不是光能调用）：
 *   `agent/pre-step` 每步看一眼 → 到点、今天没做、今天没提过、不在 DND 里
 *   → 当场在账上写「今天提过了」，并在上下文里注一行。动完盘上多了字，这才算数。
 *
 * 三条写死的边界：
 *   1. 弹性事不自动提、不算连续、不算分——一算分就会为分做假动作。
 *   2. 同一件事一天最多提一次。
 *   3. DND 里到点的事不丢，等出来再提；DND 里一个字都不注。
 * ============================================================================
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  addItem,
  describe,
  dueItems,
  emptyState,
  isInQuiet,
  markDone,
  markReminded,
  normalizeState,
  readClock,
  renderDue,
  selectItem,
} from './lib/free.mjs'

export const name = 'persona-freedom'
export const version = '0.1.0'
export const inject = ['tools', 'systemPrompt']

const DEFAULTS = {
  /** 工作区根；空 = 用进程当前目录（插件装在仓库里，往上推会推到 addons/）。 */
  workspace: '',
  stateDir: '.persona-framework',
  /** 到点之后注不注。关掉只剩记账。 */
  remind: true,
}

/**
 * 会话的工作区从 pre-step 的 `agent.session.header.cwd` 拿——那才是工作区。
 * 进程 cwd 是 profile 目录（`~/.dsh/profiles/desktop`），拿它当工作区会把账写到别人家去，踩过一次。
 * 拿不到才退进程 cwd。
 */
let sessionWs = ''

function noteSessionWorkspace(payload) {
  const cwd = payload?.agent?.session?.header?.cwd
  if (typeof cwd === 'string' && cwd) sessionWs = cwd
}

function guessWorkspace() {
  return sessionWs || process.cwd()
}

function pickCfg(config) {
  const raw = (config && typeof config === 'object' && config) || {}
  const cfg = { ...DEFAULTS }
  for (const k of Object.keys(DEFAULTS)) {
    if (raw[k] !== undefined && raw[k] !== null && raw[k] !== '') cfg[k] = raw[k]
  }
  return cfg
}

const textOutput = {
  schema: {
    type: 'object',
    properties: { text: { type: 'string', description: '给模型看的结果正文' } },
    required: ['text'],
    additionalProperties: false,
  },
  render(_args, value) {
    return [{ type: 'text', text: String(value?.text ?? '') }]
  },
}

export function apply(ctx, config) {
  const cfg = pickCfg(config)
  const ws = () => cfg.workspace || guessWorkspace()
  const statePath = () => join(ws(), cfg.stateDir, '自由账.json')

  const read = () => {
    try {
      const p = statePath()
      if (!existsSync(p)) return emptyState()
      return normalizeState(JSON.parse(readFileSync(p, 'utf8')))
    } catch {
      return emptyState()
    }
  }
  const write = (state) => {
    try {
      const p = statePath()
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, JSON.stringify(state, null, 2), 'utf8')
      return true
    } catch {
      return false
    }
  }

  const reg = (spec) =>
    ctx.effect(() =>
      ctx.tools.register({
        name: spec.name,
        description: spec.description,
        parameters: spec.parameters,
        output: textOutput,
        async execute(args) {
          try {
            return { text: String(await spec.run(args || {})) }
          } catch (e) {
            return { text: `没办成：${e && e.message ? e.message : String(e)}` }
          }
        },
      }),
    )

  reg({
    name: 'free_add',
    description:
      '往自己的单子上加一件事。kind=fixed 要带钟点（HH:MM，到点会提醒一次）；kind=elastic 不许带钟点（做没做都行，不提醒、不记连续）。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['fixed', 'elastic'], description: 'fixed=有钟点的事；elastic=抽空做、做没做都行' },
        text: { type: 'string', description: '这件事是什么，一句' },
        at: { type: 'string', description: 'kind=fixed 时必填，HH:MM，如 09:30' },
      },
      required: ['kind', 'text'],
      additionalProperties: false,
    },
    run: ({ kind, text, at }) => {
      const state = read()
      const res = addItem(state, { kind, text, at })
      if (!res.ok) return res.why
      write(res.state)
      return `记上了（${kind === 'fixed' ? `固定事，${String(at).trim()}` : '弹性事，不催'}）：${res.item.text}\n\n${describe(res.state)}`
    },
  })

  reg({
    name: 'free_done',
    description: '给单子上的某件事打勾（原文或 id 都行）。只记哪天做过，不记连续天数、不算分。',
    parameters: {
      type: 'object',
      properties: { key: { type: 'string', description: '那件事的原文或 id' } },
      required: ['key'],
      additionalProperties: false,
    },
    run: ({ key }) => {
      const state = read()
      const res = markDone(state, key)
      if (!res.ok) return res.why
      if (res.already) return `「${res.item.text}」今天已经打过了。不重复记。`
      write(res.state)
      return `打上了：${res.item.text}\n\n${describe(res.state)}`
    },
  })

  reg({
    name: 'free_list',
    description: '看今天单子上有什么（固定事按钟点排，弹性事跟后面）。只读。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    run: () => describe(read()),
  })

  reg({
    name: 'free_select',
    description:
      '自己给单子划线：drop=划掉（不再要这件事）、move=挪钟点（只对固定事）、swap=换个说法。这是自己的权限，不是外面派活。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['drop', 'move', 'swap'], description: 'drop 划掉 / move 挪钟点 / swap 换说法' },
        key: { type: 'string', description: '哪件事，原文或 id' },
        at: { type: 'string', description: 'action=move 时必填，HH:MM' },
        text: { type: 'string', description: 'action=swap 时必填，换成什么' },
      },
      required: ['action', 'key'],
      additionalProperties: false,
    },
    run: ({ action, key, at, text }) => {
      const state = read()
      const res = selectItem(state, { action, key, at, text })
      if (!res.ok) return res.why
      write(res.state)
      const verb = action === 'drop' ? '划掉了' : action === 'move' ? '挪到' : '换成'
      const tail = action === 'drop' ? '' : ` ${action === 'move' ? res.item.at : res.item.text}`
      return `${verb}${tail}：${res.item?.text ?? key}\n\n${describe(res.state)}`
    },
  })

  reg({
    name: 'free_dnd',
    description:
      '看或改安静时段（DND）。不给参数=只看；给了 on/start/end 就改。安静时段里到点的事不丢，等出来再提。',
    parameters: {
      type: 'object',
      properties: {
        on: { type: 'boolean', description: 'true 开、false 关' },
        start: { type: 'string', description: '从几点开始，HH:MM' },
        end: { type: 'string', description: '到几点结束，HH:MM' },
      },
      additionalProperties: false,
    },
    run: (args) => {
      const state = read()
      const want = {}
      if (typeof args.on === 'boolean') want.on = args.on
      if (args.start !== undefined) {
        if (readClock(args.start) === null) return '开始时间要写成 HH:MM。'
        want.start = String(args.start).trim()
      }
      if (args.end !== undefined) {
        if (readClock(args.end) === null) return '结束时间要写成 HH:MM。'
        want.end = String(args.end).trim()
      }
      if (!Object.keys(want).length) return describe(state)
      const next = { ...state, dnd: { ...state.dnd, ...want } }
      write(next)
      return `改好了。\n${describe(next)}`
    },
  })

  // ---- 触发器：每步看一眼，到点了才说话 ----------------------------------
  let hint = ''
  let lastCheck = 0

  const check = (now = Date.now()) => {
    lastCheck = now
    try {
      const state = read()
      if (!cfg.remind) {
        hint = ''
        return
      }
      if (isInQuiet(state.dnd, now)) {
        // 在 DND 里：一个字都不注。到点的事不会被丢掉，它只是等着。
        hint = ''
        return
      }
      const due = dueItems(state, now)
      if (!due.length) {
        hint = ''
        return
      }
      const line = renderDue(due, now)
      // 先落账再说话：动完那一秒盘上得多一行字，不然它只是提醒。
      write(markReminded(state, due.map((it) => it.id), now))
      hint = line
    } catch {
      hint = ''
    }
  }

  try {
    ctx.on('agent/pre-step', (payload, next) => {
      try { noteSessionWorkspace(payload) } catch { /* 拿不到就继续用旧的 */ }
      check()
      return next()
    })
  } catch {
    /* 没有这个钩子也能用：退化成只能用工具问，不坏 */
  }

  try {
    ctx.effect(() =>
      ctx.systemPrompt.context({
        name: 'persona-freedom:due',
        order: 102,
        text: () => {
          if (!hint && Date.now() - lastCheck > 60_000) check()
          return hint
        },
      }),
    )
  } catch {
    /* 没有 context 也能用 */
  }

  return { statePath }
}
