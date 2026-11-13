// 专门环境注入触发器：触发时只往会话里带一句话，其余全落在环境文件里。
//
// 三种触发方式（这一层只实现第三种，前两种由会话那边调工具完成）：
//   realtime 一次对话里不断触发——省掉重复注入人格记忆，但每轮都烧 token
//   session  触发时向会话带一句话，动作再走会话——每次都要把人格记忆重新注入
//   env      触发时只带一句话，桥另一边的全部信息写进环境文件，文件几乎实时更新
//
// 环境文件的头两行固定写着：人格与记忆已经注入过了，不要重复注入。

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { pendingEvents, readEvents, toLine, OUT_KINDS } from './home.mjs'

export const TRIGGERS = ['realtime', 'session', 'env']
export const TRIGGER_LABEL = { realtime: '实时触发', session: '会话触发', env: '专门环境注入' }

export const ENV = {
  dir: '.persona-framework',
  sub: '桥/环境',
  file: (id) => `${id}.md`,
  state: 'env.json',
  log: '触发账.jsonl',
  minGapMin: 3,
  maxFresh: 12,
}

export function envDir(ws, opts = {}) {
  return join(ws || '.', opts.dir || ENV.dir, ENV.sub)
}
export function envPath(ws, id, opts = {}) {
  return join(envDir(ws, opts), ENV.file(id))
}
export function envStatePath(ws, opts = {}) {
  return join(envDir(ws, opts), ENV.state)
}
export function triggerLogPath(ws, opts = {}) {
  return join(envDir(ws, opts), ENV.log)
}

export function readEnvState(ws, opts = {}) {
  const p = envStatePath(ws, opts)
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf8')) || {}
  } catch {
    return {}
  }
}

function writeEnvState(ws, next, opts = {}) {
  mkdirSync(envDir(ws, opts), { recursive: true })
  writeFileSync(envStatePath(ws, opts), JSON.stringify(next, null, 2), 'utf8')
}

// 桥的另一边：身体、家、时空、房间事件、我写回去的东西
export function collectSide(ws, opts = {}) {
  const pending = pendingEvents(ws, opts)
  const all = readEvents(ws, opts)
  return {
    pending,
    total: all.length,
    recent: all.slice(-ENV.maxFresh),
    at: new Date().toISOString(),
  }
}

// 环境文件正文：几乎实时、可整份替换
export function renderEnvDoc(id, side, extra = {}) {
  const L = []
  L.push(`# 桥的另一边：${id}（环境文件，几乎实时）`)
  L.push('')
  L.push('> 人格与记忆**已经注入过了**，这一份只是桥另一边的状态；不要在这里重复注入人格或记忆，只读它、只按它做。')
  L.push('')
  L.push(`- 刷新时间：${side.at}`)
  L.push(`- 还没进会话：${side.pending.length} 条（一共记了 ${side.total} 条）`)
  if (extra.mode) L.push(`- 触发方式：${TRIGGER_LABEL[extra.mode] || extra.mode}`)
  if (extra.life) L.push(`- 这会儿在过：${extra.life}`)
  L.push('')
  L.push('## 还没进会话的动静')
  if (!side.pending.length) L.push('- 没有')
  else for (const e of side.pending.slice(-ENV.maxFresh)) L.push(`- ${toLine(e)}`)
  L.push('')
  L.push('## 房间里最近发生过')
  if (!side.recent.length) L.push('- 屋里还没写过什么')
  else for (const e of side.recent) L.push(`- ${toLine(e)}`)
  if (extra.out && extra.out.length) {
    L.push('')
    L.push('## 我最近写回去的（输出不止话）')
    for (const o of extra.out.slice(-8)) {
      L.push(`- ${o.at || ''}｜${o.kind || 'say'}${o.label ? '（' + o.label + '）' : ''}：${o.text || o.desc || ''}`)
    }
  }
  L.push('')
  L.push('## 能做的输出通道')
  L.push(`- ${OUT_KINDS.join(' / ')}（bridge_emit：kind + text）`)
  L.push('')
  L.push('## 怎么用这一份')
  L.push('- 要回它：`bridge_say`（说一句）或 `bridge_emit`（做/换姿势/开灯/出声/走过去）。')
  L.push('- 读完了要推游标：`bridge_read op=mark`；只读别推：`bridge_read op=list`。')
  L.push('- 桥不替人格判断：这里的字是「那边发生了什么」，不是结论。')
  return L.join('\n')
}

// 触发一次：写环境文件、判断要不要往会话里带那一句
export function tickEnv(ws, id = 'home', opts = {}) {
  const side = collectSide(ws, opts)
  const st = readEnvState(ws, opts)
  const prev = st[id] || {}
  const fresh = side.pending.length
  const changed = (side.recent[side.recent.length - 1] || {}).at || ''
  const now = Date.now()
  const gapMin = prev.at ? (now - Date.parse(prev.at)) / 60000 : Infinity

  let fired = false
  let why = ''
  if (fresh > 0 && changed !== prev.changed) {
    fired = true
    why = `有新动静 ${fresh} 条`
  } else if (fresh > 0 && gapMin >= ENV.minGapMin) {
    fired = true
    why = `隔了 ${Math.round(gapMin)} 分钟，还没进会话的还有 ${fresh} 条`
  }

  const doc = renderEnvDoc(id, side)
  mkdirSync(envDir(ws, opts), { recursive: true })
  writeFileSync(envPath(ws, id, opts), doc, 'utf8')

  const next = { ...st, [id]: { at: side.at, changed, fired, fresh } }
  writeEnvState(ws, next, opts)

  const line = fired
    ? `（${id}：${why}；环境文件 ${envPath(ws, id, opts)} 已刷新，人格与记忆不用重复注入）`
    : ''

  if (fired) {
    appendFileSync(
      triggerLogPath(ws, opts),
      JSON.stringify({ at: side.at, id, kind: 'env', why, fresh, chars: doc.length }) + '\n',
      'utf8'
    )
  }

  return { ok: true, fired, why, line, pending: fresh, bytes: doc.length, path: envPath(ws, id, opts) }
}

export function renderEnvStatus(ws, id = 'home', opts = {}) {
  const st = readEnvState(ws, opts)[id] || {}
  const side = collectSide(ws, opts)
  const mins = st.at ? Math.max(0, Math.round((Date.now() - Date.parse(st.at)) / 60000)) : null
  return [
    `环境文件：${envPath(ws, id, opts)}`,
    `上次刷新：${mins === null ? '还没有' : mins + ' 分钟前'}`,
    `还没进会话：${side.pending.length} 条（一共 ${side.total} 条）`,
    `触发阈值：有新动静、或隔 ${ENV.minGapMin} 分钟还有没进会话的`,
  ].join('\n')
}

export const __internal = { collectSide }
