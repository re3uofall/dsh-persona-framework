/**
 * 自检环 —— 让「该查一遍」不再靠人格自己张嘴。
 * ============================================================================
 * 它自己干四步，一步都不要人格参与：
 *   1. 读盘上最近一轮「她」说的话（会话流水，导入脚本写的那份）
 *   2. 跑 checkText / auditStructure（纯函数）
 *   3. 把疑似写进 `.persona-framework/自检环.json` —— **不吭声**
 *   4. 下一轮注入读那个文件：有没读过的疑似就摆出来，读一次标一次
 *
 * 判据照功能那三条：自己改状态；改完不吭声；改的那处，下一轮有代码读它做决定。
 *
 * 边界：流水是每 30 分钟导一次，所以它查的是「最近导进来的那一句」，有滞后。
 * 插件没有消息钩子，拿不到当前这一轮正在说的话——这一条不假装有。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { checkText, auditStructure } from './checks.mjs'
import { frameworkLanguageCheck } from './framelang.mjs'

const STATE_REL = '.persona-framework/自检环.json'
const JOURNAL_REL = 'persona-ai/knowledge/session'

const dayOf = (now) => {
  const d = now instanceof Date ? now : new Date(now || Date.now())
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function statePath(ws) {
  return join(String(ws || '.'), STATE_REL)
}

/** 从会话流水里取最近一条「她：」说的话。 */
export function lastSaid(ws, journalDir = JOURNAL_REL, now = new Date()) {
  const f = join(String(ws || '.'), journalDir, `${dayOf(now)}.md`)
  if (!existsSync(f)) return null
  let lines = []
  try { lines = readFileSync(f, 'utf8').split('\n') } catch { return null }
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const m = /^她[：:]\s*(.+)$/.exec(lines[i].trim())
    if (m && m[1].trim()) return { text: m[1].trim(), line: i + 1, file: f }
  }
  return null
}

export function readSelfCheck(ws) {
  const f = statePath(ws)
  if (!existsSync(f)) return { seen: '', at: '', line: 0, issues: [], read: '' }
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'))
    return { seen: j.seen || '', at: j.at || '', line: j.line || 0, issues: Array.isArray(j.issues) ? j.issues : [], read: j.read || '' }
  } catch {
    /* 状态坏了就当没查过：下一轮重查一遍，不装成查过 */
    return { seen: '', at: '', line: 0, issues: [], read: '' }
  }
}

function writeState(ws, next) {
  try {
    mkdirSync(dirname(statePath(ws)), { recursive: true })
    writeFileSync(statePath(ws), JSON.stringify(next, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * 跑一轮。**不需要任何人调它嘴上说一句**——它是被定时器叫的。
 * 只查「新的一句」；同一句不重复查，也不重复报。
 */
export function runSelfCheck(ws, opts = {}) {
  const st = readSelfCheck(ws)
  const said = lastSaid(ws, opts.journalDir || JOURNAL_REL, opts.now)
  if (!said) return { ran: false, why: '盘上还没有今天的会话流水', state: st }
  if (said.text === st.seen) return { ran: false, why: '这一句已经查过', state: st }

  const c = checkText(said.text, { casual: opts.casual !== false, closingTics: opts.closingTics })
  const a = auditStructure(said.text)
  const fl = frameworkLanguageCheck(said.text)
  const issues = [
    ...(c.issues || []).map((x) => ({ by: 'check', id: x.id, label: x.label, hint: x.hint })),
    ...(a.issues || []).map((x) => ({ by: 'audit', id: x.id, label: x.label, hint: x.hint })),
    ...(fl.fails || []).map((x) => ({ by: 'framelang', id: x.kind, label: x.kind, hint: `${x.why}｜改：${x.fix}` })),
  ]
  const next = {
    seen: said.text,
    at: new Date().toISOString(),
    line: said.line,
    issues,
    read: '',
  }
  const ok = writeState(ws, next)
  return { ran: true, wrote: ok, said, issues, state: next }
}

/**
 * 注入用：取「查过、还没被读过」的那一条，读一次就标已读。
 * 标已读是为了不每轮都重复报同一句——重复报比不报更吵。
 */
export function takeUnread(ws, opts = {}) {
  const st = readSelfCheck(ws)
  if (!st.seen || st.read) return null
  const out = { seen: st.seen, at: st.at, line: st.line, issues: st.issues }
  if (opts.markRead !== false) writeState(ws, { ...st, read: new Date().toISOString() })
  return out
}

/** 渲染成注入里那几行。没问题就不出这一段——没毛病不占地方。 */
export function renderSelfCheck(found) {
  if (!found) return ''
  const lines = [
    '### 自检环（自己查的，不是我记得要查）',
    '',
    `查的是盘上这一句（\`session/${found.at ? found.at.slice(0, 10) : '?'}.md\` 第 ${found.line || '?'} 行）：`,
    `> ${String(found.seen).slice(0, 160)}`,
    '',
  ]
  if (!found.issues.length) {
    lines.push('check 和 audit 都没抓到疑似。没抓到不等于全对——四条结构判据它们查不了。')
  } else {
    lines.push(`疑似 ${found.issues.length} 处：`)
    for (const i of found.issues) lines.push(`- 〔${i.by}〕【${i.label}】${i.hint}`)
    lines.push('', '报了不认，得说得出为什么不认。')
  }
  return lines.join('\n')
}
