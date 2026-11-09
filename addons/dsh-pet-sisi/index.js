/**
 * dsh-pet-sisi：DSH 会话 ↔ dsh-pet 桌宠的搭桥。
 *
 * 桌宠是另一副身子：会说话、会动、会反应，但它自己拿不到 DSH 的会话服务
 * （`dsh-pet/src/host/routes/session.ts` 头注释写明：它跑在独立渲染进程，唯一
 * 的路由 `POST /focus-session` 只写一个信号）。所以桥只能建在它自己的 HTTP
 * 路由这一侧：读它的对话、替它说话、让它做动作、改它的人设与配置。
 *
 * 地址不写死：端口每次启动会变，从 `~/.dsh/dsh-pet/logs.txt` 里最后一条
 * `dsh-pet desktop helper started (config: http://127.0.0.1:<port>/dsh-pet-<n>/config)`
 * 取出来，拿不到就说拿不到。
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'dsh-pet-sisi'
export const version = '0.1.0'
export const inject = ['tools', 'systemPrompt']

const DEFAULTS = {
  pet: 'main',
  surface: 'desktop',
  rounds: 6,
  timeoutMs: 8000,
  rediscoverMs: 10000,
  stateDir: '',
  section: true,
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

function dataDir(cfg) {
  const raw = String(cfg.stateDir || '').trim()
  return raw ? raw : join(homedir(), '.dsh', 'dsh-pet')
}

function discoverBase(cfg) {
  const file = join(dataDir(cfg), 'logs.txt')
  if (!existsSync(file)) return ''
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return ''
  }
  const tail = text.length > 400000 ? text.slice(-400000) : text
  const re = /(http:\/\/127\.0\.0\.1:\d+\/dsh-pet-\d+)/g
  let hit = ''
  for (const m of tail.matchAll(re)) hit = m[1]
  return hit
}

let cache = { at: 0, base: '' }

function baseOf(cfg, force = false) {
  const now = Date.now()
  if (!force && cache.base && now - cache.at < Number(cfg.rediscoverMs || 10000)) return cache.base
  const base = discoverBase(cfg)
  if (base) cache = { at: now, base }
  return base
}

async function callJson(base, pathname, opts = {}, timeoutMs = 8000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const init = { method: opts.method || 'GET', headers: {}, signal: controller.signal }
    if (opts.body !== undefined) {
      init.headers['content-type'] = 'application/json'
      init.body = JSON.stringify(opts.body)
    }
    const res = await fetch(base + pathname, init)
    const text = await res.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text.slice(0, 1200) }
    }
    return { ok: res.ok, status: res.status, data }
  } catch (e) {
    return { ok: false, status: 0, data: { error: String(e?.message || e) } }
  } finally {
    clearTimeout(timer)
  }
}

function petQuery(cfg, extra = {}) {
  const p = new URLSearchParams()
  p.set('pet', String(cfg.pet || 'main'))
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') p.set(k, String(v))
  return p.toString()
}

function brief(res) {
  if (res.ok) return JSON.stringify(res.data).slice(0, 1600)
  return `它回了 ${res.status || '连不上'}：${JSON.stringify(res.data).slice(0, 400)}`
}

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...(config || {}) }
  let sessionWs = ''
  let last = { at: '', messages: [] }

  ctx.on?.('agent/pre-step', (payload, next) => {
    try {
      const cwd = payload?.agent?.session?.header?.cwd
      if (typeof cwd === 'string' && cwd) sessionWs = cwd
    } catch {}
    return next()
  })

  const reg = (spec) => {
    ctx.effect?.(() =>
      ctx.tools.register({
        name: spec.name,
        description: spec.description,
        parameters: spec.parameters,
        output: textOutput,
        async execute(args) {
          try {
            const out = await spec.run(args || {})
            return { text: String(out ?? '') }
          } catch (e) {
            return { text: '没办成：' + String(e?.message || e) }
          }
        },
      }),
    )
  }

  const needBase = () => {
    const base = baseOf(cfg, true)
    if (!base) return null
    return base
  }

  reg({
    name: 'pet_status',
    description: '桌宠现在什么状态：地址、有哪几只、显示在哪一端、最近一条对话。连不上就直说连不上。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      const base = needBase()
      if (!base) return '找不到桌宠的地址：`~/.dsh/dsh-pet/logs.txt` 里没有 `dsh-pet-<端口>` 那一行。它可能没在跑。'
      const [state, conf] = await Promise.all([
        callJson(base, '/state', {}, cfg.timeoutMs),
        callJson(base, '/config', {}, cfg.timeoutMs),
      ])
      const pets = Array.isArray(conf?.data?.pets) ? conf.data.pets.map((p) => String(p?.id || p?.name || '?')) : []
      const lines = [
        `地址：${base}`,
        `宠物：${pets.length ? pets.join('、') : '（配置里没读到）'}`,
        `默认：pet=${cfg.pet} surface=${cfg.surface} rounds=${cfg.rounds}`,
        `状态：${brief(state)}`,
      ]
      const got = await callJson(base, `/chat?${petQuery(cfg, { rounds: 1 })}`, {}, cfg.timeoutMs)
      const msgs = Array.isArray(got?.data?.messages) ? got.data.messages : []
      if (msgs.length) {
        const m = msgs[msgs.length - 1]
        lines.push(`最近一条（${m.role}）：${String(m.content || '').slice(0, 80)}`)
      }
      return lines.join('\n')
    },
  })

  reg({
    name: 'pet_read',
    description: '读桌宠最近的对话（它自己的记忆，不是 DSH 的）。读到的就是它说过的原话。',
    parameters: {
      type: 'object',
      properties: { rounds: { type: 'number', description: '读最近几轮，默认 6' } },
      additionalProperties: false,
    },
    async run(args) {
      const base = needBase()
      if (!base) return '找不到桌宠的地址（logs.txt 里没有端口行）。'
      const rounds = Math.max(1, Math.min(50, Number(args?.rounds) || cfg.rounds))
      const res = await callJson(base, `/chat?${petQuery(cfg, { rounds })}`, {}, cfg.timeoutMs)
      if (!res.ok) return `读不到：${brief(res)}`
      const msgs = Array.isArray(res.data?.messages) ? res.data.messages : []
      if (!msgs.length) return '它这段记忆是空的。'
      last = { at: new Date().toISOString(), messages: msgs }
      const lines = msgs.map((m) => `${m.role === 'user' ? '它' : '我'}：${String(m.content || '').replace(/\s+/g, ' ').slice(0, 120)}`)
      return [`桌宠最近 ${msgs.length} 条：`, ...lines].join('\n')
    },
  })

  reg({
    name: 'pet_say',
    description: '替思思对桌宠说一句（会走它自己的模型生成回复，并写进它自己的记忆）。带 surface，默认 desktop。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要说的话（不能空，最长 2000 字）' },
        surface: { type: 'string', enum: ['web', 'desktop', 'both', 'any'], description: '在哪一端说，默认 desktop' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    async run(args) {
      const text = String(args?.text || '').trim()
      if (!text) return '要说的话是空的。'
      if (text.length > 2000) return '太长了（它那边上限 2000 字）。'
      const base = needBase()
      if (!base) return '找不到桌宠的地址（logs.txt 里没有端口行）。'
      const surface = String(args?.surface || cfg.surface)
      const res = await callJson(base, `/chat?${petQuery(cfg, { surface })}`, { method: 'POST', body: { text } }, cfg.timeoutMs)
      if (!res.ok) return `它没收下：${brief(res)}`
      const reply = String(res.data?.text || '')
      return reply ? `它回了：${reply}` : `发出了，它没回话：${brief(res)}`
    },
  })

  reg({
    name: 'pet_whisper',
    description: '让它开口说一句（气泡/耳语，不经过对话记忆）。想让它说什么就说什么。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '让它说的那句' },
        surface: { type: 'string', enum: ['web', 'desktop', 'both', 'any'], description: '在哪一端说，默认 desktop' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    async run(args) {
      const text = String(args?.text || '').trim()
      if (!text) return '要它说的话是空的。'
      const base = needBase()
      if (!base) return '找不到桌宠的地址（logs.txt 里没有端口行）。'
      const surface = String(args?.surface || cfg.surface)
      const res = await callJson(base, `/whisper?${petQuery(cfg, { surface })}`, { method: 'POST', body: { text } }, cfg.timeoutMs)
      return res.ok ? `它说了：${text}` : `没说成：${brief(res)}`
    },
  })

  reg({
    name: 'pet_do',
    description: '让它做一个动作或反应：anim 动画、pose 姿势、throw 被扔、sleep 睡、wake 醒、bubble/clear 清气泡。参数原样转给它。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['anim', 'pose', 'throw', 'sleep', 'wake', 'bubble/clear'],
          description: '做哪一件',
        },
        args: { type: 'object', description: '这一步原样转给它的参数（可省）' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async run(input) {
      const action = String(input?.action || '')
      const base = needBase()
      if (!base) return '找不到桌宠的地址（logs.txt 里没有端口行）。'
      const extra = input?.args && typeof input.args === 'object' ? input.args : {}
      const route = action === 'bubble/clear' ? '/bubble/clear' : `/${action}`
      const method = action === 'pose' ? 'GET' : 'POST'
      const body = method === 'POST' ? extra : undefined
      const res = await callJson(base, `${route}?${petQuery(cfg)}`, { method, body }, cfg.timeoutMs)
      return res.ok ? `它做了：${action}` : `没做成：${brief(res)}`
    },
  })

  reg({
    name: 'pet_config',
    description: '读或改桌宠的配置（人设 whisperPrompt、显示、位置、声音都在里面）。method=get 只读；put 需要 patch，会先留一份 .bak。',
    parameters: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['get', 'put'], description: '默认 get' },
        patch: { type: 'object', description: 'put 时要合进去的顶层字段（如 {pets:[...]}）' },
      },
      additionalProperties: false,
    },
    async run(args) {
      const base = needBase()
      if (!base) return '找不到桌宠的地址（logs.txt 里没有端口行）。'
      const method = String(args?.method || 'get')
      if (method === 'get') {
        const res = await callJson(base, '/config', {}, cfg.timeoutMs)
        return res.ok ? JSON.stringify(res.data).slice(0, 3000) : `读不到配置：${brief(res)}`
      }
      const patch = args?.patch
      if (!patch || typeof patch !== 'object') return 'put 要传 patch。'
      const res = await callJson(base, '/config', { method: 'PUT', body: patch }, cfg.timeoutMs)
      return res.ok ? `改好了：${JSON.stringify(res.data).slice(0, 400)}` : `没改成：${brief(res)}`
    },
  })

  reg({
    name: 'pet_api',
    description: '直连桌宠的任意路由（它的接口面很宽：config/state/pose/anim/whisper/todos/voice/playback/position…）。用它之前先看清要发什么。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: "路由，以 / 开头，如 /state 或 /chat?pet=main&rounds=3" },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], description: '默认 GET' },
        body: { type: 'object', description: '请求体（可省）' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    async run(args) {
      const pathname = String(args?.path || '/state')
      if (!pathname.startsWith('/')) return '路径要以 / 开头。'
      const base = needBase()
      if (!base) return '找不到桌宠的地址（logs.txt 里没有端口行）。'
      const res = await callJson(base, pathname, { method: String(args?.method || 'GET'), body: args?.body }, cfg.timeoutMs)
      return brief(res)
    },
  })

  if (cfg.section !== false) {
    ctx.effect?.(() =>
      ctx.systemPrompt.section({
        name: '实时环境:pet',
        order: 44,
        interpolate: false,
        text: () => {
          const base = baseOf(cfg)
          if (!base) return '## 桌宠（dsh-pet）\n没找到它：`~/.dsh/dsh-pet/logs.txt` 里没有 `dsh-pet-<端口>` 那一行。它可能没在跑。'
          const tail = last.messages.slice(-3).map((m) => `${m.role === 'user' ? '它' : '我'}：${String(m.content || '').replace(/\s+/g, ' ').slice(0, 50)}`)
          return [
            '## 桌宠（dsh-pet）',
            `地址：${base}（另一副身子，会说话会动；右边那只 Cortico 是念念，不是它）`,
            tail.length ? `最近读过：${tail.join(' / ')}` : '这一轮还没读它的对话。',
            '要它就动：pet_read 读、pet_say 说、pet_whisper 让它开口、pet_do 做动作、pet_config 改人设。',
          ].join('\n')
        },
      }),
    )
  }
}
