/**
 * lib/free.mjs —— freedom 的纯逻辑（不碰 fs、不碰 ctx）
 * ============================================================================
 * 三块，各管一件事：
 *   - freetime：固定事（有钟点）与弹性事（没钟点，做没做都行）。
 *   - freeselect：自己给这些事划线、挪、换——不是外面派活。
 *   - DND：安静时段。到点了也先憋着，出来再提。
 *
 * 为什么不自己写定时器：宿主已经有 schedule_*，真到点把人叫醒那件事归它。
 * 这里管的是「今天这件事该不该由我提」，不是「几点把会话唤醒」。
 *
 * 三条写死的规矩：
 *   1. 弹性事不算连续天数、不算分。一算分，就会为了分去做假动作。
 *   2. 同一件事一天最多提一次；提过了就不再提。
 *   3. DND 里到点的事不丢，挪到出 DND 后第一次检查再提。
 * ============================================================================
 */

export const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/

export const DEFAULT_DND = {
  on: true,
  start: '22:30',
  end: '08:00',
  timeZone: 'Asia/Shanghai',
}

export const KINDS = ['fixed', 'elastic']

/** 固定事占多久：5 分钟到 10 小时，整数；没写或读不懂就是 30 分钟。 */
export function clampMinutes(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return 30
  return Math.max(5, Math.min(600, Math.round(n)))
}

export function readClock(text) {
  const m = CLOCK.exec(String(text ?? '').trim())
  if (!m) return null
  const [h, mi] = String(text).trim().split(':')
  return Number(h) * 60 + Number(mi)
}

/** 某个时刻在给定时区的本地分钟数（0..1439）。 */
export function localMinutes(now, timeZone = DEFAULT_DND.timeZone) {
  const epoch = typeof now === 'number' ? now : now.getTime()
  const parts = new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(epoch)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

/** 某个时刻在给定时区的日子（YYYY-MM-DD）。 */
export function dayKeyOf(now, timeZone = DEFAULT_DND.timeZone) {
  const epoch = typeof now === 'number' ? now : now.getTime()
  const parts = new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(epoch)
  const get = (t) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/**
 * 是否在安静时段里。两端：起点算进去、终点不算；跨零点允许。
 * 起点等于终点 = 这个时段不成立（不是「全天安静」）——写错的时候宁可不拦，
 * 也不要因为一个手滑的 08:00–08:00 把一整天都堵死。
 */
export function isInQuiet(dnd, now = Date.now()) {
  if (!dnd || dnd.on === false) return false
  const start = readClock(dnd.start)
  const end = readClock(dnd.end)
  if (start === null || end === null || start === end) return false
  const nowMin = localMinutes(now, dnd.timeZone || DEFAULT_DND.timeZone)
  if (start < end) return nowMin >= start && nowMin < end
  return nowMin >= start || nowMin < end
}

export function dndLabel(dnd) {
  if (!dnd || dnd.on === false) return '免打扰：关'
  return `免打扰：${dnd.start}–${dnd.end}${isInQuiet(dnd) ? '（现在在里面）' : ''}`
}

let seq = 0
export function newId(now = Date.now()) {
  seq = (seq + 1) % 1000
  return `f${now.toString(36)}${seq.toString(36)}`
}

/**
 * 加一件事。kind=fixed 必须带钟点（HH:MM）；elastic 不许带钟点——
 * 弹性事一旦有了钟点，它就不是弹性的了，是「我给自己派的活」。
 */
export function addItem(state, { kind, text, at, minutes }, now = Date.now()) {
  const body = String(text ?? '').trim()
  if (!body) return { ok: false, why: '这件事得有个说法，空的记不了。' }
  if (!KINDS.includes(kind)) return { ok: false, why: 'kind 只有 two 种：fixed（有钟点）或 elastic（做没做都行）。' }
  if (kind === 'fixed' && readClock(at) === null) {
    return { ok: false, why: '固定事要带钟点，写成 HH:MM，比如 09:30。' }
  }
  if (kind === 'elastic' && at) {
    return { ok: false, why: '弹性事不带钟点，否则就成了派活——它该是「今天抽空」，不是「到点必须」。' }
  }
  const items = Array.isArray(state.items) ? state.items : []
  if (items.some((it) => it.text === body && !it.dropped)) {
    return { ok: false, why: `「${body}」已经在单子上了，不重复记。` }
  }
  const item = {
    id: newId(now),
    kind,
    text: body,
    at: kind === 'fixed' ? String(at).trim() : null,
    // 固定事占多久。没写就是半小时——写死一个数，好让「排表」可判。
    minutes: kind === 'fixed' ? clampMinutes(minutes) : null,
    created: new Date(now).toISOString(),
    doneDays: [],
    remindedDays: [],
    dropped: false,
  }
  return { ok: true, item, state: { ...state, items: [...items, item] } }
}

/** 打勾。只记「哪天做过」，不记连续、不算总分。 */
export function markDone(state, key, now = Date.now()) {
  const day = dayKeyOf(now, state.dnd?.timeZone || DEFAULT_DND.timeZone)
  const target = String(key ?? '').trim()
  if (!target) return { ok: false, why: '要打勾得说出是哪件事（原文或 id）。' }
  const items = Array.isArray(state.items) ? state.items : []
  const hit = items.find((it) => it.id === target) || items.find((it) => it.text === target)
  if (!hit) return { ok: false, why: `单子上没有「${target}」。`, state }
  const doneDays = Array.isArray(hit.doneDays) ? hit.doneDays : []
  if (doneDays.includes(day)) return { ok: true, already: true, item: hit, state }
  const next = items.map((it) => (it === hit ? { ...it, doneDays: [...doneDays, day] } : it))
  return { ok: true, already: false, item: hit, state: { ...state, items: next } }
}

/** 划掉（不再要这件事）、挪钟点、换一个说法。 */
export function selectItem(state, { action, key, at, text }, now = Date.now()) {
  const items = Array.isArray(state.items) ? state.items : []
  const target = String(key ?? '').trim()
  const hit = items.find((it) => it.id === target) || items.find((it) => it.text === target)
  if (!hit) return { ok: false, why: `单子上没有「${target}」。` }
  if (action === 'drop') {
    const next = items.map((it) => (it === hit ? { ...it, dropped: true, droppedAt: new Date(now).toISOString() } : it))
    return { ok: true, state: { ...state, items: next } }
  }
  if (action === 'move') {
    if (hit.kind !== 'fixed') return { ok: false, why: '弹性事没有钟点可挪；它本来就不该有钟点。' }
    if (readClock(at) === null) return { ok: false, why: '挪到几点要写成 HH:MM。' }
    const next = items.map((it) => (it === hit ? { ...it, at: String(at).trim(), movedAt: new Date(now).toISOString() } : it))
    return { ok: true, state: { ...state, items: next }, item: { ...hit, at: String(at).trim() } }
  }
  if (action === 'swap') {
    const body = String(text ?? '').trim()
    if (!body) return { ok: false, why: '换成什么，得写出来。' }
    const next = items.map((it) => (it === hit ? { ...it, text: body, swappedAt: new Date(now).toISOString() } : it))
    return { ok: true, state: { ...state, items: next }, item: { ...hit, text: body } }
  }
  return { ok: false, why: 'action 只有 drop（划掉）、move（挪钟点）、swap（换说法）。' }
}

/** 今天该做的事：固定事按钟点排，弹性事跟在后面。 */
export function todayItems(state, now = Date.now()) {
  const day = dayKeyOf(now, state.dnd?.timeZone || DEFAULT_DND.timeZone)
  const items = (Array.isArray(state.items) ? state.items : []).filter((it) => !it.dropped)
  const fixed = items.filter((it) => it.kind === 'fixed').sort((a, b) => readClock(a.at) - readClock(b.at))
  const elastic = items.filter((it) => it.kind === 'elastic')
  return [...fixed, ...elastic].map((it) => ({ ...it, doneToday: (it.doneDays || []).includes(day) }))
}

/**
 * 到点该提的：固定事、今天没做、今天没提过。
 * DND 里返回空数组——不是丢掉，是「等出来再说」，靠调用方下次再问。
 * 弹性事永远不自动提：它本来就是「抽空」，一到点就催，就把弹性做成了派活。
 */
export function dueItems(state, now = Date.now()) {
  const tz = state.dnd?.timeZone || DEFAULT_DND.timeZone
  const day = dayKeyOf(now, tz)
  const nowMin = localMinutes(now, tz)
  const items = (Array.isArray(state.items) ? state.items : []).filter((it) => !it.dropped && it.kind === 'fixed')
  return items.filter((it) => {
    const at = readClock(it.at)
    if (at === null) return false
    if ((it.doneDays || []).includes(day)) return false
    if ((it.remindedDays || []).includes(day)) return false
    return nowMin >= at
  })
}

/** 记下「今天提过了」，一件一天一次。 */
export function markReminded(state, ids, now = Date.now()) {
  const tz = state.dnd?.timeZone || DEFAULT_DND.timeZone
  const day = dayKeyOf(now, tz)
  const set = new Set(ids || [])
  const items = (Array.isArray(state.items) ? state.items : []).map((it) =>
    set.has(it.id) ? { ...it, remindedDays: [...new Set([...(it.remindedDays || []), day])] } : it,
  )
  return { ...state, items }
}

export function describe(state, now = Date.now()) {
  const tz = state.dnd?.timeZone || DEFAULT_DND.timeZone
  const day = dayKeyOf(now, tz)
  const list = todayItems(state, now)
  const lines = [dndLabel(state.dnd), `今天是 ${day}（${tz}）`]
  if (!list.length) {
    lines.push('单子上是空的。空着不是欠着。')
    return lines.join('\n')
  }
  const fixed = list.filter((it) => it.kind === 'fixed')
  const elastic = list.filter((it) => it.kind === 'elastic')
  if (fixed.length) {
    lines.push('固定的事：')
    for (const it of fixed) {
      lines.push(`  ${it.doneToday ? '✓' : '·'} ${it.at} ${it.text}`)
    }
  }
  if (elastic.length) {
    lines.push('弹性的事（做没做都行，不记连续）：')
    for (const it of elastic) {
      lines.push(`  ${it.doneToday ? '✓' : '·'} ${it.text}`)
    }
  }
  return lines.join('\n')
}

export function emptyState() {
  return { dnd: { ...DEFAULT_DND }, items: [] }
}

/** 旧账升级：缺字段补上，认不出的条目原样留着（不删——删不是忘，是抹）。 */
export function normalizeState(raw) {
  const base = emptyState()
  if (!raw || typeof raw !== 'object') return base
  const dnd = { ...base.dnd, ...(raw.dnd && typeof raw.dnd === 'object' ? raw.dnd : {}) }
  if (readClock(dnd.start) === null) dnd.start = base.dnd.start
  if (readClock(dnd.end) === null) dnd.end = base.dnd.end
  if (typeof dnd.timeZone !== 'string' || !dnd.timeZone) dnd.timeZone = base.dnd.timeZone
  dnd.on = dnd.on !== false
  const items = Array.isArray(raw.items)
    ? raw.items.filter((it) => it && typeof it === 'object' && typeof it.text === 'string').map((it) => ({
        id: typeof it.id === 'string' ? it.id : newId(),
        kind: KINDS.includes(it.kind) ? it.kind : 'elastic',
        text: it.text,
        at: it.kind === 'fixed' && readClock(it.at) !== null ? it.at : null,
        minutes: it.kind === 'fixed' ? clampMinutes(it.minutes) : null,
        created: typeof it.created === 'string' ? it.created : new Date().toISOString(),
        doneDays: Array.isArray(it.doneDays) ? it.doneDays : [],
        remindedDays: Array.isArray(it.remindedDays) ? it.remindedDays : [],
        dropped: it.dropped === true,
      }))
    : []
  return { ...base, ...raw, dnd, items }
}

export function renderDue(due, now = Date.now()) {
  if (!due || !due.length) return ''
  const tz = DEFAULT_DND.timeZone
  const nowMin = localMinutes(now, tz)
  const head = due.map((it) => {
    const late = nowMin - readClock(it.at)
    const when = late >= 5 ? `过了 ${late} 分钟` : '到点了'
    return `${it.at} ${it.text}（${when}）`
  })
  return `自己给自己记的事：${head.join('；')}。做不了就划掉，别让它一直挂着。`
}
