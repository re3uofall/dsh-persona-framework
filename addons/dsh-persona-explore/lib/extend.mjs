// 探索插件的扩展层：触发器（不只定时）+ 侧栏页的数据接口 + 探索三维目录工具。
// 这一层不注册提示词段——它只改状态、只落账，判据是 GUIDE-FEATURES：改状态、不给人格字、下一轮真的变了。
import { existsSync, mkdirSync, readFileSync, appendFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson, nowIso, localDate } from './store.mjs'
import { TRIGGERS, DEFAULTS, evaluate, mergeState, ledgerPath, readFires, renderFires } from './triggers.mjs'
import { KINDS, edit as editCatalog, hintIn, listOf, planIn, renderCatalogIn } from './catalog.mjs'

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

  // ── 工具：探索三维目录 / 出一趟的计划 / 手动看一眼触发 ──────────────────
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
