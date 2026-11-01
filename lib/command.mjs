/**
 * 87 功能指令 · 说一句，让某个功能当场办
 *
 * 现在功能都是被动的：
 *   tick 到点跑（那些是自动的）
 *   要有由头才动（忘、锁、判，都得有人提）
 *
 * **这一层是主动的**：AI 自己发一条指令，落到某个功能上。
 *
 * 七项：
 *   归谁   87 功能指令
 *   哪一类 写（动词：发指令）
 *   落在哪 `.persona-framework/指令.json`（自定义的表）+ 各功能自己的账
 *   谁调   `framework_program op=cmd`
 *
 * **边界（硬）**：
 *   一、指令不能动人格文件。要改人格得人自己开「自我反写」——那一层不归指令。
 *   二、指令不写句子回去。办成没办成，回代码和数字，不回解释。
 *   三、表里的人不许删——内置那些是这一层的骨头；自定义的能加能停。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

export function cmdFile(ws) {
  return join(String(ws || process.cwd()), '.persona-framework', '指令.json')
}

/**
 * 内置指令表。
 *
 * 每条：`do` 说它办什么（给设置页看的）；`run` 真办。
 * **run 返回的东西一律只许是数字或代码**，不许是句子。
 */
export const BUILTIN = {
  记: {
    what: '记一条进池子；要带出处',
    args: ['text', 'where'],
    // 落到 10 记忆：真往里写
    run: async (ws, a) => {
      const { IMPLS } = await import('./impl.mjs')
      const r = IMPLS['10'].run(ws, { text: a.text, where: a.where })
      return { code: r.cant.length ? 'refused' : 'done', n: r.cant.length }
    },
  },
  忘: {
    what: '让一条淡下去（降权，不删）',
    args: ['path', 'why'],
    run: async (ws, a) => {
      const { openForget, forgetOne, saveForget } = await import('./forget.mjs')
      const b = openForget(ws)
      const r = forgetOne(b, a.path, a.why, 1)
      if (!r.ok) return { code: r.reason || 'refused' }
      saveForget(b)
      return { code: 'done', weight: r.weight }
    },
  },
  加固: {
    what: '自己决定把一条钉牢；要说得出为什么',
    args: ['path', 'why'],
    run: async (ws, a) => {
      const { openForget, hardenOne, saveForget } = await import('./forget.mjs')
      const b = openForget(ws)
      const r = hardenOne(b, a.path, a.why)
      if (!r.ok) return { code: r.reason || 'refused' }
      saveForget(b)
      return { code: 'done', weight: r.weight }
    },
  },
  锁: {
    what: '把一条关进禁区（达成的瞬间不能改口）',
    args: ['what', 'why'],
    run: async (ws, a) => {
      const { openGoalBook, lockZone, saveGoalBook } = await import('./superego.mjs')
      const b = openGoalBook(ws)
      const r = lockZone(b, { what: a.what, why: a.why, canSay: false })
      if (!r.ok) return { code: 'refused' }
      saveGoalBook(b)
      return { code: 'done' }
    },
  },
  判: {
    what: '判一件事（接住→边界→现实检验→判断→延迟→筛→放/截）',
    args: ['what', 'text', 'outcome'],
    run: async (ws, a) => {
      const { egoStep } = await import('./ego.mjs')
      const r = egoStep(ws, {
        gaps: [{ source: '指令', what: a.what, text: a.text, outcome: a.outcome, cost: { payable: true } }],
        scene: '认真',
      })
      return {
        code: 'done',
        wrote: r.wrote,
        released: r.released.length,
        suppressed: r.suppressed.length,
        delayed: r.delayed.length,
      }
    },
  },
  称: {
    what: '给一件事称重：想要什么、要付什么。两样都写了才算过称',
    args: ['source', 'want', 'cost'],
    run: async (ws, a) => {
      const { setWeigh } = await import('./autonomy.mjs')
      const src = String(a.source || '').trim()
      const want = String(a.want || '').trim()
      const cost = String(a.cost || '').trim()
      if (!src) return { code: 'no-source' }
      // **两样都要。** 只写想要是愿望，只写代价是不敢——两边都不算过称。
      if (!want || !cost) return { code: 'need-both' }
      setWeigh(ws, src, want, cost)
      return { code: 'done' }
    },
  },
  捞: {
    what: '按线索去池子里翻',
    args: ['q'],
    run: async (ws, a) => {
      const { IMPLS } = await import('./impl.mjs')
      const r = IMPLS['10'].run(ws, { q: a.q })
      return { code: 'done', n: r.out.length }
    },
  },
}

/** 自定义指令：表在 指令.json，能加能停，不能删内置的。 */
export function openCommands(ws) {
  const f = cmdFile(ws)
  let v = {}
  try { v = JSON.parse(readFileSync(f, 'utf8')) } catch { /* 没自定义就是空的 */ }
  return {
    _f: f,
    _dirty: false,
    // 自定义的只记「名字 → 调哪个内置指令 + 固定参数」，不存代码
    extra: v.extra && typeof v.extra === 'object' ? v.extra : {},
  }
}

export function saveCommands(book) {
  if (!book?._dirty) return 0
  const d = dirname(book._f)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  writeFileSync(book._f, JSON.stringify({ extra: book.extra }, null, 2), 'utf8')
  book._dirty = false
  return 1
}

/* ── 指令账：跑没跑、成没成 ──
 *
 * 「感受到自己的变化」不是给它一句话说「你刚跑过一次」——
 * 是**记下来，下一轮它自己看得到**。
 *
 * 落在 `.persona-framework/指令账.json`。
 * 只记这几样：哪条、几时、成没成、动了哪几个数。**不记解释。**
 */
export function ledgerFile(ws) {
  return join(String(ws || process.cwd()), '.persona-framework', '指令账.json')
}

export function openLedger(ws) {
  const f = ledgerFile(ws)
  let v = {}
  try { v = JSON.parse(readFileSync(f, 'utf8')) } catch { /* 没跑过就是空的 */ }
  return {
    _f: f,
    _dirty: false,
    list: Array.isArray(v.list) ? v.list.slice(-300) : [],
  }
}

export function saveLedger(book) {
  if (!book?._dirty) return 0
  const d = dirname(book._f)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  writeFileSync(book._f, JSON.stringify({ list: book.list.slice(-300) }, null, 2), 'utf8')
  book._dirty = false
  return 1
}

/** 记一笔：哪条、成没成、动了哪几个数。 */
export function noteRun(ws, name, r) {
  try {
    const b = openLedger(ws)
    b.list.push({
      name: String(name || '').slice(0, 20),
      code: r?.code || (r?.ok ? 'done' : 'unknown'),
      at: new Date().toISOString(),
      // 只留数字，不留句子
      ...(r?.weight !== undefined ? { weight: r.weight } : {}),
      ...(r?.n !== undefined ? { n: r.n } : {}),
    })
    b._dirty = true
    saveLedger(b)
    return 1
  } catch {
    return 0
  }
}

/** 最近跑的那几条，新的在前。 */
export function recentRuns(ws, n = 3) {
  return openLedger(ws).list.slice(-n).reverse()
}

/** 一条指令多久没跑过（毫秒）；没跑过返回 null。 */
export function sinceRun(ws, name) {
  const hit = [...openLedger(ws).list].reverse().find((x) => x.name === name)
  if (!hit) return null
  const t = Date.parse(hit.at)
  return Number.isFinite(t) ? Date.now() - t : null
}

/** 指令清单：内置的 + 自定义的，一起。 */
export function listCommands(book) {
  const out = Object.entries(BUILTIN).map(([name, c]) => ({
    name, what: c.what, args: c.args, builtin: true,
  }))
  for (const [name, e] of Object.entries(book?.extra || {})) {
    if (e?.off) continue
    out.push({ name, what: `→ ${e.to ?? '?'}`, args: e.args || [], builtin: false })
  }
  return out
}

/**
 * 发一条指令。
 *
 * **回代码，不回句子。** 办成没办成，看 `code`；
 * 为什么没成，也只看得到代码（`no-why` / `no-path` / `refused`）——
 * 解释归调用方去翻，不归它自己说。
 */
export async function runCommand(ws, name, args = {}) {
  const n = String(name || '').trim()
  if (!n) return { ok: false, code: 'no-command' }

  // 自定义的：转给内置那条，参数并上去
  const book = openCommands(ws)
  const custom = book.extra[n]
  if (custom && !custom.off) {
    return runCommand(ws, custom.to, { ...(custom.args || {}), ...args })
  }

  const c = BUILTIN[n]
  if (!c) {
    // **试过也算一次。** 不然它不知道「我发过一个不存在的」。
    noteRun(ws, n, { code: 'unknown-command' })
    return { ok: false, code: 'unknown-command' }
  }

  try {
    const r = await c.run(ws, args || {})
    // **跑没跑，记一笔。** 它自己不当场说，下一轮看账。
    noteRun(ws, n, r)
    return { ok: r.code === 'done', ...r }
  } catch (e) {
    noteRun(ws, n, { code: 'threw' })
    return { ok: false, code: 'threw', e: String(e?.message || e).slice(0, 80) }
  }
}

/** 加一条自定义指令：别名指向某条内置的。 */
export function addCommand(book, name, to, extraArgs) {
  const n = String(name || '').trim()
  const t = String(to || '').trim()
  if (!n || !t) return { ok: false, reason: 'no-name' }
  // **不许盖掉内置的**——那是这一层的骨头
  if (BUILTIN[n]) return { ok: false, reason: 'builtin' }
  if (!BUILTIN[t]) return { ok: false, reason: 'no-target' }
  book.extra[n] = { to: t, args: extraArgs || {}, at: new Date().toISOString() }
  book._dirty = true
  return { ok: true }
}

/** 停一条自定义指令（内置的停不了）。 */
export function stopCommand(book, name) {
  const n = String(name || '').trim()
  if (BUILTIN[n]) return { ok: false, reason: 'builtin' }
  if (!book.extra[n]) return { ok: false, reason: 'not-found' }
  book.extra[n].off = true
  book._dirty = true
  return { ok: true }
}
