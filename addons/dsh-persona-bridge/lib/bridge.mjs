import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// 三条桥：虚拟桥、游戏桥、资讯桥。
// 每条桥都同时有两件事：channels（从哪儿进出）与 mode（会话桥 / 非会话桥）。
// mode 的区别只有一个：上下文是不是由外部程序直接改动。
//   session    所有信息只能经会话进出；桥只做转写与落账，不碰上下文
//   nonsession 外部程序往 inbox/outbox 写文件，段每轮直接读，不经会话
export const BRIDGES = [
  {
    id: 'virtual',
    label: '虚拟桥',
    channels: ['身体', '家', '时空'],
    senses: ['在哪／姿势／力气', '房间与门', '虚拟时刻'],
    acts: ['动身体（virtual_body）', '换房间（virtual_home route）', '拨时钟（virtual_time）'],
    defaultMode: 'nonsession',
  },
  {
    id: 'game',
    label: '游戏桥',
    channels: ['存档文件', '窗口画面', '键鼠操作'],
    senses: ['存档与日志', '当前界面', '上一次操作的结果'],
    acts: ['读存档', '发操作指令', '把结果转回输入'],
    defaultMode: 'nonsession',
  },
  {
    id: 'info',
    label: '资讯桥',
    channels: ['网页原文', '搜索命中', '本地文档'],
    senses: ['原文与出处', '命中与时间', '读没读到全文'],
    acts: ['读原文', '留一条判断', '把新证据转回输入'],
    defaultMode: 'session',
  },
  {
    id: 'auto',
    label: '自动桥',
    channels: ['策略代理（没有会话也叫得动）', '定时起身', '自己的判断'],
    senses: ['现在该不该动', '上回动过是什么时候', '动了以后世界变了没有'],
    acts: ['自己开一轮', '按策略做一步', '把结果写成输入'],
    defaultMode: 'nonsession',
  },
  {
    id: 'external',
    label: '外部桥',
    channels: ['纯外部程序', '外部文件', '外部接口'],
    senses: ['对方写来的输入', '对方的回执', '对方的错误'],
    acts: ['读外部文件', '调外部程序', '把回执写回'],
    defaultMode: 'nonsession',
  },
  {
    id: 'home',
    label: '家里的桥',
    channels: ['房间动静（events.jsonl）', '我的回话（outbox.jsonl）', '读过的游标'],
    senses: ['还没进会话的动静', '最近三条', '读到哪一条了'],
    acts: ['把动静转成会话里的一行话', '把回话写回房间', '读完再推游标'],
    defaultMode: 'session',
  },
]

export const MODES = ['session', 'nonsession']
export const MODE_LABEL = { session: '会话桥', nonsession: '非会话桥' }

export const DEFAULTS = {
  dir: '.persona-framework',
  ledger: '桥账.jsonl',
  outboxDir: '桥',
  stateFile: '桥状态.json',
  maxChars: 1200,
  order: 48,
}

// 触发器：输出要能触发输入，输入要能自己触发。
// 两类：out-in（输出落盘后回落成一条新输入）、in-in（输入自己再触发一条后续）。
// 防死循环：同一条桥、同一类，冷却窗口内最多 maxHops 跳。
export const TRIGGER = {
  kinds: ['out-in', 'in-in'],
  maxHops: 3,
  cooldownMs: 5 * 60 * 1000,
}

const bridgeOf = (id) => BRIDGES.find((b) => b.id === id) || null

export function statePath(ws, opts = {}) {
  const d = opts.dir || DEFAULTS.dir
  return join(ws || process.cwd(), d, opts.stateFile || DEFAULTS.stateFile)
}

export function loadState(ws, opts = {}) {
  const p = statePath(ws, opts)
  const out = { mode: {}, updatedAt: null }
  try {
    if (!existsSync(p)) return out
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    for (const b of BRIDGES) {
      const m = raw?.mode?.[b.id]
      out.mode[b.id] = MODES.includes(m) ? m : b.defaultMode
    }
    out.updatedAt = raw?.updatedAt || null
    return out
  } catch {
    for (const b of BRIDGES) out.mode[b.id] = b.defaultMode
    return out
  }
}

export function saveState(ws, state, opts = {}) {
  const p = statePath(ws, opts)
  mkdirSync(join(p, '..'), { recursive: true })
  const body = { mode: state.mode, updatedAt: new Date().toISOString() }
  writeFileSync(p, JSON.stringify(body, null, 2), 'utf8')
  return body
}

export function setMode(ws, id, mode, opts = {}) {
  if (!bridgeOf(id)) return { ok: false, error: `没有这条桥：${id}` }
  if (!MODES.includes(mode)) return { ok: false, error: `mode 只认 session / nonsession` }
  const st = loadState(ws, opts)
  st.mode[id] = mode
  saveState(ws, st, opts)
  return { ok: true, id, mode }
}

export function modeOf(ws, id, opts = {}) {
  const st = loadState(ws, opts)
  return st.mode[id] || bridgeOf(id)?.defaultMode || 'session'
}

// ── 账 ────────────────────────────────────────────────────────────
export function ledgerPath(ws, opts = {}) {
  return join(ws || process.cwd(), opts.dir || DEFAULTS.dir, opts.ledger || DEFAULTS.ledger)
}

export function bridgeDir(ws, id, opts = {}) {
  return join(ws || process.cwd(), opts.dir || DEFAULTS.dir, opts.outboxDir || DEFAULTS.outboxDir, id)
}

function appendRow(ws, row, opts = {}) {
  const p = ledgerPath(ws, opts)
  mkdirSync(join(p, '..'), { recursive: true })
  appendFileSync(p, JSON.stringify(row) + '\n', 'utf8')
  return row
}

// 授权的外部程序做的输入输出，可靠性通过（有授权、有回执）时，记作「我做的」；
// 缺回执的记「外部做的」——不是我的判断，是外部程序的凭据还没对完。
export function attributionOf(opts = {}) {
  if (opts.attribution === 'self' || opts.attribution === 'external') return opts.attribution
  const authorized = opts.authorized === true
  const receipt = opts.receipt != null && String(opts.receipt).trim() !== ''
  return authorized && receipt ? 'self' : 'external'
}

export function record(ws, { bridge, dir, text, note }, opts = {}) {
  if (!bridgeOf(bridge)) return { ok: false, error: `没有这条桥：${bridge}` }
  if (!['in', 'out', 'feedback'].includes(dir)) return { ok: false, error: 'dir 只认 in / out / feedback' }
  const body = String(text == null ? '' : text)
  const row = appendRow(
    ws,
    {
      at: new Date().toISOString(),
      bridge,
      mode: modeOf(ws, bridge, opts),
      // 两种对话：会话说的话（session）与游戏里说的话（game）——入口不同，本质都是对话
      dialogue: bridge === 'game' ? 'game' : 'session',
      // 授权 + 回执齐了，这一行算「我做的」；缺回执算外部的
      attribution: attributionOf(opts),
      dir,
      chars: body.length,
      note: String(note || '').slice(0, 200),
      head: body.slice(0, 120),
    },
    opts,
  )
  // 非会话桥：落文件，外部程序也能读；会话桥：只在账上，不进上下文
  if (modeOf(ws, bridge, opts) === 'nonsession') {
    const d = bridgeDir(ws, bridge, opts)
    mkdirSync(d, { recursive: true })
    appendFileSync(join(d, 'outbox.jsonl'), JSON.stringify({ at: row.at, dir, text: body }) + '\n', 'utf8')
  }
  // 触发器：输出要能触发输入，输入要能自己触发。feedback 不触发（它是回执，不是新输入）。
  const trig = opts.cascade === false ? null : cascade(ws, bridge, dir, text, opts)
  return { ok: true, row, trigger: trig }
}

// ── 转译：输入 → 该做什么 ────────────────────────────────────────
// 这里不生成对话，只把输入翻成一条结构化的「下一步」，并写明这一条要回什么。
export function translate(ws, id, text, opts = {}) {
  const b = bridgeOf(id)
  if (!b) return { ok: false, error: `没有这条桥：${id}` }
  const mode = modeOf(ws, id, opts)
  const body = String(text == null ? '' : text).slice(0, opts.maxChars || DEFAULTS.maxChars)
  const steps = b.acts.map((a, i) => `${i + 1}. ${a}`)
  const back =
    mode === 'nonsession'
      ? `做完把结果写进 ${opts.dir || DEFAULTS.dir}/${opts.outboxDir || DEFAULTS.outboxDir}/${id}/outbox.jsonl，再用 bridge_feedback 回账`
      : '做完把结果写回会话（一句话），再用 bridge_feedback 回账'
  const kindHint =
    id === 'virtual'
      ? '先核对 br> 在哪／姿势／力气 与门口那条路，再决定动不动'
      : id === 'game'
        ? '先读存档与上一帧，再发一个操作；一次只改一样，好回退'
        : '先读原文，指得出处再说；读不到全文就写「没读到全文」'
  const plan = [
    `【${b.label} · ${MODE_LABEL[mode]}】`,
    `输入（${body.length} 字）：${body.slice(0, 200)}`,
    `判据：${kindHint}`,
    `下一步：`,
    ...steps,
    `回给谁：${back}`,
  ].join('\n')
  return { ok: true, bridge: id, mode, plan }
}

export function pullInbox(ws, id, opts = {}) {
  const b = bridgeOf(id)
  if (!b) return { ok: false, error: `没有这条桥：${id}` }
  const f = join(bridgeDir(ws, id, opts), 'inbox.jsonl')
  if (!existsSync(f)) return { ok: true, rows: [], note: '收件箱是空的' }
  const rows = []
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line)
      rows.push({ at: r.at || '', text: String(r.text ?? r.input ?? '') })
    } catch {
      rows.push({ at: '', text: line })
    }
  }
  return { ok: true, rows }
}

export function unreadCount(ws, id, opts = {}) {
  const r = pullInbox(ws, id, opts)
  return r.ok ? r.rows.length : 0
}

// ── 控制论/信息论的四个量：带宽、噪声、反馈覆盖率、滞后 ────────────
export function stats(ws, opts = {}) {
  const p = ledgerPath(ws, opts)
  const rows = []
  try {
    if (existsSync(p)) {
      for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
        if (!line.trim()) continue
        try { rows.push(JSON.parse(line)) } catch {}
      }
    }
  } catch {}
  const per = {}
  for (const b of BRIDGES) per[b.id] = { in: 0, out: 0, feedback: 0, chars: 0, last: '' }
  for (const r of rows) {
    const s = per[r.bridge]
    if (!s) continue
    if (r.dir === 'in') s.in += 1
    else if (r.dir === 'out') s.out += 1
    else s.feedback += 1
    s.chars += Number(r.chars) || 0
    if (r.at) s.last = r.at
  }
  for (const id of Object.keys(per)) {
    const s = per[id]
    // 反馈覆盖率：回来的比发出去的多，才算闭环
    s.coverage = s.in ? Math.min(1, s.feedback / s.in) : 0
    // 带宽：这一段里平均每条有多少字
    const n = s.in + s.out + s.feedback
    s.avgChars = n ? Math.round(s.chars / n) : 0
  }
  return { rows: rows.length, per }
}

export function renderStats(ws, opts = {}) {
  const s = stats(ws, opts)
  const lines = [`# 桥账（${s.rows} 行）`]
  for (const b of BRIDGES) {
    const x = s.per[b.id]
    lines.push(
      `- ${b.label}（${MODE_LABEL[modeOf(ws, b.id, opts)]}）：进 ${x.in}｜出 ${x.out}｜回 ${x.feedback}｜反馈覆盖 ${Math.round(
        x.coverage * 100,
      )}%｜平均 ${x.avgChars} 字${x.last ? `｜最近 ${x.last}` : ''}`,
    )
  }
  return lines.join('\n')
}

// ── 段：每轮摆出来的那几行 ────────────────────────────────────────
export function renderSection(ws, opts = {}) {
  const lines = ['## 桥（输入 → 输出 → 反馈）']
  lines.push(
    '三条桥：虚拟桥（身体／家／时空）、游戏桥（存档／画面／键鼠）、资讯桥（原文／命中）；每条各有一种模式：',
  )
  lines.push(
    '- **会话桥**：所有输入输出都表现为会话里的对话；上下文只能经会话注入，桥不直接改上下文。',
  )
  lines.push(
    '- **非会话桥**：外部程序把信息写进 `桥/<id>/inbox.jsonl`，段每轮直接读；DSH 的反应写进 `outbox.jsonl`，不经会话。',
  )
  lines.push('两条硬要求：**输入要能直接改变输出**；**反馈要全部回账**（bridge_feedback），没回账的不算闭环。')
  for (const b of BRIDGES) {
    const mode = modeOf(ws, b.id, opts)
    const box = mode === 'nonsession' ? unreadCount(ws, b.id, opts) : null
    const tail = mode === 'nonsession' ? `｜收件箱 ${box} 条` : '｜只经会话'
    lines.push(`- ${b.label}（${MODE_LABEL[mode]}）：${b.channels.join('／')}${tail}`)
  }
  const s = stats(ws, opts)
  const any = s.rows > 0
  if (any) {
    const covers = BRIDGES.map((b) => `${b.label} ${Math.round((s.per[b.id].coverage || 0) * 100)}%`)
    lines.push(`账：${s.rows} 行｜反馈覆盖 ${covers.join('、')}`)
  }
  return lines.join('\n')
}

export function cardOf(text, budget = 600) {
  const body = String(text || '')
  if (body.length <= budget) return body
  const lines = body.split(/\r?\n/).filter((l) => l.trim())
  const keep = ['标题', '##']
  const out = []
  let used = 0
  for (const l of lines) {
    if (used + l.length + 1 > budget) break
    out.push(l)
    used += l.length + 1
  }
  return out.join('\n') + `\n…（余下 ${body.length - used} 字在本地）`
}

// ── 触发器：输出要能触发输入，输入要能自己触发 ─────────────────
export function triggerPath(ws, opts = {}) {
  return join(ws || '.', opts.dir || DEFAULTS.dir, '触发账.jsonl')
}

export function readTriggers(ws, opts = {}) {
  const p = triggerPath(ws, opts)
  if (!existsSync(p)) return []
  const out = []
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      out.push({ at: new Date(0).toISOString(), raw: line })
    }
  }
  return out
}

function hopsWithin(rows, bridge, kind, since) {
  let n = 0
  for (const r of rows) {
    if (r.bridge !== bridge || r.kind !== kind) continue
    if (Date.parse(r.at) >= since) n++
  }
  return n
}

// 能不能再触发一次：跳数与冷却都拦得住，才回 ok。
export function shouldFire(ws, bridge, kind, opts = {}) {
  if (!TRIGGER.kinds.includes(kind)) return { ok: false, why: `触发器只认 ${TRIGGER.kinds.join(' / ')}` }
  const cooldown = opts.cooldownMs || TRIGGER.cooldownMs
  const maxHops = opts.maxHops || TRIGGER.maxHops
  const hops = hopsWithin(readTriggers(ws, opts), bridge, kind, Date.now() - cooldown)
  if (hops >= maxHops) return { ok: false, why: `跳数到顶（${hops}/${maxHops}）` }
  return { ok: true, hop: hops + 1 }
}

// 真触发：把一条后续写进收件箱（下一轮 bridge_pull 会取到），并落触发账。
export function cascade(ws, bridge, dir, text, opts = {}) {
  if (dir !== 'in' && dir !== 'out') return null
  const kind = dir === 'out' ? 'out-in' : 'in-in'
  const s = shouldFire(ws, bridge, kind, opts)
  const at = new Date().toISOString()
  if (!s.ok) {
    appendFileSync(triggerPath(ws, opts), JSON.stringify({ at, bridge, kind, hop: 0, suppressed: s.why }) + '\n', 'utf8')
    return { ok: false, kind, why: s.why }
  }
  const body = String(text || '').slice(0, Math.max(80, opts.maxChars || DEFAULTS.maxChars))
  const d = bridgeDir(ws, bridge, opts)
  mkdirSync(d, { recursive: true })
  appendFileSync(
    join(d, 'inbox.jsonl'),
    JSON.stringify({ at, from: dir, kind, hop: s.hop, text: `（${kind === 'out-in' ? '输出转输入' : '输入自触发'}）${body}` }) + '\n',
    'utf8',
  )
  appendFileSync(triggerPath(ws, opts), JSON.stringify({ at, bridge, kind, hop: s.hop, chars: body.length }) + '\n', 'utf8')
  return { ok: true, kind, hop: s.hop }
}

export function renderTriggers(ws, opts = {}) {
  const rows = readTriggers(ws, opts).slice(-20)
  if (!rows.length) return '触发器：一次都没触发过。'
  return rows
    .map((r) => `· ${r.at}｜${r.bridge}｜${r.kind}｜${r.suppressed ? '压住：' + r.suppressed : '第 ' + r.hop + ' 跳'}`)
    .join('\n')
}


// ── 两种对话的名字 + 两种状态行 ───────────────────────────────
// 名字不是流程名，是位置名：一个在会话里，一个在游戏里（外部程序写进来）。
export const BRIDGE_NAME = { virtual: '身体与家', game: '游戏里' }

export function statusLines(ws, opts = {}) {
  const s = stats(ws, opts)
  const out = []
  for (const b of BRIDGES) {
    if (b.id !== 'virtual' && b.id !== 'game') continue
    const p = (s.per && s.per[b.id]) || {}
    const mode = MODE_LABEL[modeOf(ws, b.id, opts)] || modeOf(ws, b.id, opts)
    out.push(BRIDGE_NAME[b.id] + '｜' + mode + '｜出 ' + (p.out || 0) + ' 条｜反馈 ' + (p.feedback || 0) + ' 条')
  }
  return out
}

export const __internal = { bridgeOf, appendRow }
