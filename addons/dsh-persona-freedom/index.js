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
import { DEFAULT_WINDOW, planOf, renderPlan } from './lib/plan.mjs'
import { addSpace, defaultSpaces, findSpace, isolationCheck, normalizeSpaces, probeSpace, renderSpaces } from './lib/space.mjs'
import { busyState } from './lib/busy.mjs'

export const name = 'persona-freedom'
export const version = '0.2.0'
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
  const spacePath = () => join(ws(), cfg.stateDir, '空间.json')

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

  const readSpaces = () => {
    try {
      const f = spacePath()
      if (!existsSync(f)) return defaultSpaces()
      return normalizeSpaces(JSON.parse(readFileSync(f, 'utf8')))
    } catch {
      return defaultSpaces()
    }
  }
  const writeSpaces = (state) => {
    try {
      const f = spacePath()
      mkdirSync(dirname(f), { recursive: true })
      writeFileSync(f, JSON.stringify(state, null, 2), 'utf8')
      return true
    } catch {
      return false
    }
  }

  /** 师父常用的那三块地：不算我的空间，落在里面就是出界。 */
  const forbiddenDirs = () => {
    const home = process.env.USERPROFILE || ''
    return home ? [join(home, 'Desktop'), join(home, 'Documents'), join(home, 'Downloads')] : []
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
        minutes: { type: 'number', description: '这段占多久（分钟，5–600，默认 30）；只对 fixed 有用，排表用它算空档' },
      },
      required: ['kind', 'text'],
      additionalProperties: false,
    },
    run: ({ kind, text, at, minutes }) => {
      const state = read()
      const res = addItem(state, { kind, text, at, minutes })
      if (!res.ok) return res.why
      write(res.state)
      return `记上了（${kind === 'fixed' ? `固定事，${String(at).trim()}${minutes ? `，${minutes} 分钟` : ''}` : '弹性事，不催'}）：${res.item.text}\n\n${describe(res.state)}`
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

  reg({
    name: 'free_plan',
    description:
      '看今天的时间骨架：固定事各占哪一段、中间还剩多少纯粹的空档、密度多少。只读。空档是排出来的，不是没排满。',
    parameters: {
      type: 'object',
      properties: {
        wake: { type: 'string', description: '几点算醒（HH:MM，默认 08:00）' },
        sleep: { type: 'string', description: '几点算睡（HH:MM，默认 23:30；跨零点允许）' },
      },
      additionalProperties: false,
    },
    run: (args) => {
      const state = read()
      const window = {}
      if (args.wake) window.wake = String(args.wake)
      if (args.sleep) window.sleep = String(args.sleep)
      return renderPlan(planOf(state, Date.now(), Object.keys(window).length ? { window } : {}))
    },
  })

  reg({
    name: 'free_space',
    description:
      '我自己的空间（自由空间）：list 看有哪几块 / add 划一块新的（computer 给目录、browser 给 ego space）/ check 查隔离得好不好、能不能用 / mkdir 把缺的目录建出来。别拿它启动任何东西——启动归手。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'add', 'check', 'mkdir'], description: 'list / add / check / mkdir' },
        key: { type: 'string', description: '哪一块（add 时是新名字，其余是已有名字）' },
        kind: { type: 'string', enum: ['computer', 'browser'], description: 'add 时必填：computer=自己的电脑（目录），browser=自己的浏览器（ego space）' },
        label: { type: 'string', description: 'add 时：给人看的名字' },
        path: { type: 'string', description: 'add 时（computer 必填）：放东西的目录，相对工作区或绝对路径' },
        space: { type: 'string', description: 'add 时（browser 用）：ego 的任务空间名' },
        note: { type: 'string', description: 'add 时：这块是干什么用的、什么不许碰' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    run: (args) => {
      const list = readSpaces()
      const action = String(args.action || 'list')
      const workspace = ws()
      if (action === 'list') return renderSpaces(list, { workspace })
      if (action === 'add') {
        const res = addSpace(list, {
          key: args.key,
          kind: args.kind,
          label: args.label,
          path: args.path,
          space: args.space,
          note: args.note,
        })
        if (!res.ok) return res.why
        if (res.item.kind === 'computer') {
          const chk = isolationCheck(res.item.path, { workspace, forbidden: forbiddenDirs() })
          if (!chk.ok) return `没加：${chk.why}`
        }
        writeSpaces(res.state)
        return `划出一块了：${res.item.label}（${res.item.kind}）\n\n${renderSpaces(res.state, { workspace })}`
      }
      const target = findSpace(list, args.key)
      if (!target) return `没有「${String(args.key || '').trim()}」这块。先 list 看一眼。`
      if (action === 'check') {
        const p = probeSpace(target, { workspace })
        return p.ok ? `能用：${target.label} —— ${p.why}${p.abs ? `\n${p.abs}` : ''}` : `还不能用：${target.label} —— ${p.why}`
      }
      if (action === 'mkdir') {
        if (target.kind !== 'computer') return '浏览器那块没有目录可建。'
        const chk = isolationCheck(target.path, { workspace, forbidden: forbiddenDirs() })
        if (!chk.ok) return `不建：${chk.why}`
        try {
          mkdirSync(chk.abs, { recursive: true })
          return `建好了：${chk.abs}`
        } catch (e) {
          return `没建成：${e && e.message ? e.message : String(e)}`
        }
      }
      return 'action 只有 list / add / check / mkdir。'
    },
  })

  reg({
    name: 'free_busy',
    description:
      '现在有没有人在用这台电脑（看距上一次真实键鼠输入多久，缓存 20 秒）。动鼠标键盘之前先问它：有人在用就只走后台通道，别抢光标焦点。',
    parameters: {
      type: 'object',
      properties: {
        force: { type: 'boolean', description: 'true = 不吃缓存，当场重查（约慢半秒）' },
      },
      additionalProperties: false,
    },
    run: (args) => {
      const r = busyState({ force: args.force === true })
      if (!r.ok) return `查不到：${r.why}。那就按「有人在用」办——只走后台通道，先别动光标。`
      return r.hint
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
        name: '实时环境:freedom',
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
