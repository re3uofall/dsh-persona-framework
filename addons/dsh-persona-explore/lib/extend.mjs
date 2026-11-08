// 探索插件的扩展层：触发器（不只定时）+ 侧栏页的数据接口 + 探索三维目录工具。
// 这一层不注册提示词段——它只改状态、只落账，判据是 GUIDE-FEATURES：改状态、不给人格字、下一轮真的变了。
import { existsSync, mkdirSync, readFileSync, appendFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson, nowIso, localDate } from './store.mjs'
import { TRIGGERS, DEFAULTS, evaluate, mergeState, ledgerPath, readFires, renderFires } from './triggers.mjs'
import { KINDS, edit as editCatalog, hintIn, listOf, planIn, renderCatalogIn } from './catalog.mjs'
import {
  DEFAULTS as WAKE_DEFAULTS,
  RED_LIST,
  addDue,
  dueNow,
  idleFire,
  idleMinutes,
  logFire,
  markFired,
  pickDropped,
  pushDropped,
} from './wake.mjs'

const API = '/api/persona-explore'
const PANEL_LEDGER = 8
const PANEL_ENTRIES = 400

function safeReadJson(file, fallback) {
  try {
    if (!existsSync(file)) return fallback
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function listKept(webDir, limit) {
  if (!existsSync(webDir)) return []
  const files = readdirSync(webDir).filter((f) => f.endsWith('.md') && !f.startsWith('_')).sort().reverse()
  const out = []
  for (const f of files) {
    let body = ''
    try { body = readFileSync(join(webDir, f), 'utf8') } catch { continue }
    const date = f.replace(/\.md$/, '')
    const blocks = body.split(/^##\s+/m).slice(1)
    for (const b of blocks) {
      const lines = b.split(/\r?\n/)
      const title = (lines.shift() || '').trim()
      if (!title) continue
      const text = lines.join('\n')
      const tags = (text.match(/^-\s*tags:\s*(.+)$/m) || [])[1] || ''
      const source = (text.match(/^-\s*source:\s*(.+)$/m) || [])[1] || ''
      const updated = (text.match(/^-\s*updated:\s*(.+)$/m) || [])[1] || date
      const rest = text.replace(/^-\s*(tags|kind|source|updated):.*$/gm, '').replace(/>.*$/gm, '')
      out.push({ title, date, tags, source: source.trim(), updated: updated.trim(), file: f, chars: rest.replace(/\s/g, '').length })
    }
  }
  out.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1))
  return out.slice(0, limit)
}

function readCounts(ledger) {
  const days = {}
  for (const item of Array.isArray(ledger) ? ledger : []) {
    const d = item?.date || ''
    if (!d) continue
    days[d] = (days[d] || 0) + 1
  }
  return days
}

function collectData(p, opts) {
  const ledger = safeReadJson(p.ledgerFile, [])
  const state = safeReadJson(p.stateFile, {})
  const queue = safeReadJson(p.queueFile, [])
  const kept = listKept(p.webDir, PANEL_ENTRIES)
  const fires = readFires(p.homeDir, opts, 10)
  return {
    ok: true,
    at: nowIso(),
    kept,
    entryTotal: (kept && kept.length) || 0,
    queue: Array.isArray(queue) ? queue : [],
    fires,
    counts: readCounts(ledger),
    total: Array.isArray(ledger) ? ledger.length : 0,
    triggerState: state?.trigger || null,
    catalogue: {
      range: listOf('range', p.homeDir).length,
      mode: listOf('mode', p.homeDir).length,
      platform: listOf('platform', p.homeDir).length,
    },
  }
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

export function install(ctx, { cfg, p, warn }) {
  const opts = { ...DEFAULTS, dir: cfg.homeDir || DEFAULTS.dir }
  const fireFile = () => ledgerPath(p?.homeDir || '', opts)

  // ── 侧栏页的数据：只读，给页面用 ─────────────────────────────────────────
  if (p) {
    try {
      const web = ctx.get('webServer') || ctx.get('web-server')
      if (web && typeof web.register === 'function') {
        ctx.effect(() =>
          web.register({
            kind: 'exact',
            path: API,
            handler(req, res) {
              let body
              try {
                body = collectData(p, opts)
              } catch (error) {
                body = { ok: false, error: String(error?.message || error) }
              }
              try {
                res.writeHead(body.ok ? 200 : 500, {
                  'content-type': 'application/json; charset=utf-8',
                  'cache-control': 'no-store',
                })
                res.end(JSON.stringify(body))
              } catch { /* 连接断了就算了 */ }
            },
          }),
        )
      } else warn('没有 webServer 服务：侧栏页的数据接口没挂上，页面会空着')
    } catch (error) {
      warn(error)
    }
  }

  // ── 触发器：事件 + 阈值 + 骰子，都真落盘 ────────────────────────────────
  let lastKeepAt = 0
  const today = () => localDate()

  const runTriggers = (why) => {
    if (!p) return []
    const state = safeReadJson(p.stateFile, {})
    const queue = safeReadJson(p.queueFile, [])
    const ledger = safeReadJson(p.ledgerFile, [])
    const counts = readCounts(ledger)
    const fired = evaluate(
      {
        state,
        queue: Array.isArray(queue) ? queue : [],
        keepDates: Object.keys(counts),
        todayDate: today(),
        justKept: why === 'keep' && lastKeepAt > 0,
      },
      opts,
      Date.now(),
    )
    if (fired && fired.length) {
      try {
        mkdirSync(p.homeDir, { recursive: true })
        appendFileSync(
          fireFile(),
          fired.map((f) => JSON.stringify({ ...f, at: nowIso(), why })).join('\n') + '\n',
          'utf8',
        )
      } catch (error) {
        warn(error)
      }
      writeJson(p.stateFile, mergeState(state, fired, Date.now()))
    }
    return fired
  }

  try {
    ctx.on('agent/pre-step', (payload, next) => {
      try {
        const fired = runTriggers('step')
        runWake(payload).catch(() => {})
        if (fired && fired.length && payload && typeof payload === 'object') {
          // 只记在插件自己的状态里，不往人格里塞字
          try {
            const st = safeReadJson(p.stateFile, {})
            st.lastFires = fired
            writeJson(p.stateFile, st)
          } catch { /* 写不进就算了，账已经落了 */ }
        }
      } catch (error) {
        warn(error)
      }
      return next()
    })
  } catch (error) {
    warn(error)
  }


  // ── 三种新触发（2026-11-08）：到期唤醒 / 闲置 / 二次触发。都真调一次 web.search ──
  const WOPTS = { ...WAKE_DEFAULTS, ...(cfg.wake || {}) }
  let wakeBusy = false

  const searchOnce = async (q) => {
    try {
      const web = ctx.get('web') || ctx.get('webSearch')
      if (!web || typeof web.search !== 'function') return { ok: false, error: '没有 web 服务' }
      const res = await web.search({ query: q, maxResults: 3 })
      const sources = Array.isArray(res && res.sources) ? res.sources : []
      return { ok: true, hits: sources.length, first: String((sources[0] && sources[0].url) || '') }
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) }
    }
  }

  const runWake = async (payload) => {
    if (!p || wakeBusy) return null
    wakeBusy = true
    try {
      const now = Date.now()
      const state = safeReadJson(p.stateFile, {})
      const due = dueNow(p.homeDir, now, WOPTS).due
      if (due.length) {
        const one = due[0]
        const q = one.query || '碗外探索 今天有变化的事'
        const hit = await searchOnce(q)
        logFire(p.homeDir, { trigger: 'due', id: one.id, query: q, ...hit }, WOPTS)
        markFired(p.homeDir, [one.id], WOPTS)
        return { trigger: 'due', id: one.id }
      }
      const idle = idleMinutes()
      const fire = idleFire(state, idle, now, WOPTS)
      if (fire) {
        const q = '今天 新闻 有变化的事'
        const hit = await searchOnce(q)
        logFire(p.homeDir, { trigger: 'idle', idle: fire.idle, query: q, ...hit }, WOPTS)
        writeJson(p.stateFile, { ...state, lastIdleFire: new Date(now).toISOString() })
        return { trigger: 'idle' }
      }
      const queue = safeReadJson(p.queueFile, [])
      const words = (Array.isArray(queue) ? queue : [])
        .map((t) => String((t && t.topic) || t || ''))
        .filter(Boolean)
        .slice(0, 5)
      const picks = pickDropped(p.homeDir, words, WOPTS)
      if (picks.length) {
        const one = picks[0]
        const hit = await searchOnce(one.text)
        logFire(p.homeDir, { trigger: 'second', query: one.text, ...hit }, WOPTS)
        return { trigger: 'second' }
      }
      return null
    } catch (error) {
      warn(error)
      return null
    } finally {
      wakeBusy = false
    }
  }

  try {
    ctx.effect(() =>
      ctx.tools.register({
        name: 'explore_due',
        description: '一次性唤醒：给自己写一个到点要做的事（工具写 dueAt，pre-step 扫到就真去搜一次并落触发账）。op=add 写一条，list 看队列，fire 现在就跑一遍到期检查。',
        parameters: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ['add', 'list', 'fire'], description: '干什么' },
            id: { type: 'string', description: '这条的 id（可省，自动起）' },
            at: { type: 'string', description: '什么时候（ISO 时间或能被解析的时间串）' },
            why: { type: 'string', description: '为什么到点要动，一句话' },
            query: { type: 'string', description: '到点要搜什么' },
          },
          required: ['op'],
          additionalProperties: false,
        },
        output: textOutput,
        async execute(args) {
          try {
            if (!p) return { text: '没有找到人格目录，唤醒写不了。' }
            const op = String((args && args.op) || 'list')
            if (op === 'add') {
              const item = addDue(p.homeDir, { id: args.id, at: args.at, why: args.why, query: args.query }, WOPTS)
              return { text: '写上了：' + item.id + ' · ' + item.at + (item.query ? ' · 搜「' + item.query + '」' : '') }
            }
            if (op === 'fire') {
              const got = await runWake({})
              return { text: got ? '真动了一次：' + got.trigger : '没到点的，也没闲够，也没二次命中。' }
            }
            const view = dueNow(p.homeDir, Date.now(), WOPTS)
            if (!view.live.length) return { text: '队列是空的。op=add 写一条。' }
            const lines = view.live.slice(-10).map((r) =>
              '- ' + r.id + ' · ' + r.at + (r.firedAt ? ' · 已响过' : '') + (r.query ? ' · ' + r.query : ''))
            return { text: '唤醒队列 ' + view.live.length + ' 条（到期 ' + view.due.length + '，过期没轮到 ' + view.stale.length + '）\n' + lines.join('\n') }
          } catch (error) {
            return { text: '没办成：' + String((error && error.message) || error) }
          }
        },
      }),
    )
  } catch (error) {
    warn(error)
  }

  // ── 工具：探索三维目录 / 出一趟的计划 / 手动看一眼触发 ──────────────────

  try {
    ctx.effect(() =>
      ctx.tools.register({
        name: 'explore_plan',
        description:
          '碗外面的探索：看探索范围/方式/平台的目录，给一趟探索排个计划，或改这个目录。action=catalog 看目录，plan 出一趟，fire 看最近的触发账，hint 看某个平台怎么进，edit 增/改/划掉一条。',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['catalog', 'plan', 'fire', 'hint', 'edit'], description: '要干什么' },
            op: { type: 'string', enum: ['add', 'edit', 'remove', 'restore'], description: 'edit 时：加一条 / 改一条 / 划掉 / 放回来' },
            id: { type: 'string', description: 'edit 时：那一条的 id（add 时自己起，小写字母、数字和横杠）' },
            label: { type: 'string', description: 'edit 时：一句话名字' },
            asks: { type: 'string', description: 'range 专用：这条范围要问什么' },
            done: { type: 'string', description: 'range 专用：算做完的样子' },
            fails: { type: 'string', description: 'range 专用：不算的样子' },
            how: { type: 'string', description: 'mode 专用：具体怎么搜' },
            note: { type: 'string', description: 'mode 专用：为什么这么搜' },
            entry: { type: 'string', description: 'platform 专用：怎么进' },
            got: { type: 'string', description: 'platform 专用：拿得到什么' },
            miss: { type: 'string', description: 'platform 专用：拿不到什么' },
            range: { type: 'string', description: '探索范围：fact/how/counter/primary/lineage/timeline/limit' },
            mode: { type: 'string', description: '探索方式：narrow/rephrase/against/follow/origin/cross/translate' },
            platform: { type: 'string', description: '探索平台：web/github/npm/arxiv/wiki/forum/video' },
            kind: { type: 'string', enum: ['range', 'mode', 'platform'], description: 'catalog 时只看哪一类' },
          },
          required: ['action'],
          additionalProperties: false,
        },
        output: textOutput,
        async execute(args) {
          const action = String(args?.action || 'catalog')
          try {
            if (action === 'plan') {
              return { text: planIn({ range: args?.range, mode: args?.mode, platform: args?.platform }, p ? p.homeDir : '') }
            }
            if (action === 'hint') {
              return { text: hintIn(args?.platform, p ? p.homeDir : '') }
            }
            if (action === 'fire') {
              const fires = p ? readFires(p.homeDir, opts, 10) : []
              return { text: renderFires(fires) }
            }
            const kind = args?.kind && KINDS[args.kind] ? args.kind : 'range'
            if (action === 'edit') {
              if (!p) return { text: '没有找到人格目录，目录改不了。' }
              return { text: editCatalog(p.homeDir, args || {}) }
            }
            return { text: renderCatalogIn(kind, p ? p.homeDir : '') }
          } catch (error) {
            return { text: '没办成：' + String(error?.message || error) }
          }
        },
      }),
    )
  } catch (error) {
    warn(error)
  }

  return { api: API, fireFile, runTriggers, markKept: () => { lastKeepAt = Date.now() } }
}

export const META = { api: API, triggers: TRIGGERS.map((t) => t.id) }
