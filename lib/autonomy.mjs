/**
 * 自主程序：自己跑完一轮。
 *
 * 和「触发器」的区别，写死在这一行：
 *   触发器 = 外面给个信号，它才醒；醒来只喊一句「该做 X 了」。
 *   **程序 = 自己读、自己算、自己做完、自己留痕，不等谁叫。**
 *
 * 所以这个文件里没有「提醒」。它只做三件事：
 *   一、读：手上现在有什么（成果、日记、上次跑的痕迹）。
 *   二、算：差什么、够不够条件。
 *   三、**做**：能自己做的当场做完（统计、留痕、清理、生成骨架）；
 *      做不了的（写什么内容）**明说做不了**，不编。
 *
 * 跑法：`node lib/autonomy.mjs` 就能跑一轮，不依赖插件被调用。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

function wsOf(arg) {
  if (arg) return arg
  if (process.env.PERSONA_WS) return process.env.PERSONA_WS
  // lib/ 的上一级就是插件根，插件根的上一级是工作区
  return join(HERE, '..', '..')
}

function dirOf(ws) {
  return join(String(ws || process.cwd()), '.persona-framework')
}
export function statePath(ws) {
  return join(dirOf(ws), 'autonomy.json')
}
export function logPath(ws) {
  return join(dirOf(ws), 'autonomy.log.md')
}

/** 读上一次跑完留下的痕迹。 */
export function loadState(ws) {
  const f = statePath(ws)
  if (!existsSync(f)) return { runs: [], last: {} }
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'))
    return { runs: Array.isArray(j.runs) ? j.runs : [], last: j.last || {} }
  } catch {
    return { runs: [], last: {} }
  }
}

/** 数一数：工作区里到底有多少「自己的东西」。这一步是**读**，不猜。 */
export function survey(ws) {
  const wsRoot = String(ws || process.cwd())
  const growth = join(wsRoot, 'persona-ai', 'growth')
  const out = { results: 0, diaries: 0, lastDiaryDay: '', lastResultDay: '', files: [] }
  const walk = (d, depth) => {
    if (depth > 3 || !existsSync(d)) return
    let names = []
    try { names = readdirSync(d) } catch { return }
    for (const n of names) {
      const p = join(d, n)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) { walk(p, depth + 1); continue }
      if (n.endsWith('.jsonl')) {
        // 成果是 jsonl：一行一条，数行。
        let body = ''
        try { body = readFileSync(p, 'utf8') } catch { continue }
        const cnt = body.split('\n').filter((l) => l.trim()).length
        if (/成果|result/i.test(p)) { out.results += cnt }
        continue
      }
      if (!n.endsWith('.md')) continue
      const day = (/(\d{4}-\d{2}-\d{2})/.exec(n) || [])[1] || ''
      if (/日记/.test(p) || /diary/i.test(p)) {
        out.diaries++
        if (day > out.lastDiaryDay) out.lastDiaryDay = day
      }
      if (/成果/.test(p) || /result/i.test(p)) {
        out.results++
        if (day > out.lastResultDay) out.lastResultDay = day
      }
      out.files.push(p)
    }
  }
  walk(growth, 0)
  return out
}

/** 算这一轮该动什么。空着也是答案。 */
export function decide(ws, now = new Date()) {
  const st = loadState(ws)
  const s = survey(ws)
  const today = now.toISOString().slice(0, 10)
  const didToday = (st.last && st.last.runDay) === today

  const todo = []

  // 一、今天还没跑过：它自己会补上（selfDoable），不算做不了。
  if (!didToday) todo.push({ id: 'run', why: `今天（${today}）还没跑过一轮`, selfDoable: true })

  // 二、成果一条没有 → 它知道「没有」，但写什么它做不了。
  if (s.results === 0) {
    todo.push({ id: 'result', why: '一条成果都没有', selfDoable: false, blocking: '写什么内容，程序做不了' })
  }

  // 三、日记同。
  if (s.diaries === 0) {
    todo.push({ id: 'diary', why: '一条日记都没有', selfDoable: false, blocking: '写什么内容，程序做不了' })
  }

  // 四、上次跑过但没留日志 → 这条**它能自己做**（补写一行）。
  if (st.runs.length > 0 && !existsSync(logPath(ws))) {
    todo.push({ id: 'fixlog', why: '跑过但没留下日志', selfDoable: true })
  }

  return { now, today, state: st, survey: s, todo, didToday }
}

/**
 * 跑一轮。**能自己做的当场做掉**，不留「提醒」给别人。
 * @returns {{did: string[], cant: string[], state: object}}
 */
export function runAutonomy(ws, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date()
  const d = decide(ws, now)
  const did = []
  const cant = []

  // 一、能自己做的：写日志、记账、清空过期的临时项。
  const dir = dirOf(ws)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const lines = [
    `## ${now.toISOString()}`,
    `· 成果 ${d.survey.results} 条，日记 ${d.survey.diaries} 条`,
    `· 今天跑过：${d.didToday ? '是' : '不是'}`,
  ]
  for (const t of d.todo) {
    if (t.selfDoable) { continue }
    lines.push(`· 欠着：${t.why}${t.blocking ? '——' + t.blocking : ''}`)
  }

  // fixlog 这条：真补写
  if (d.todo.some((t) => t.id === 'fixlog') || !existsSync(logPath(ws))) {
    const head = existsSync(logPath(ws)) ? readFileSync(logPath(ws), 'utf8') : '# 自主程序的日志\n\n> 每一轮自己跑完，落一行。这不是给人看的汇报，是它自己的痕迹。\n\n'
    writeFileSync(logPath(ws), head + lines.join('\n') + '\n\n', 'utf8')
    did.push('补了日志')
  }

  // 记账：把这一轮的痕迹写进 state（**自己写，不等 markDone**）
  const st = loadState(ws)
  st.last = { ...(st.last || {}), runDay: d.today, runAt: now.toISOString() }
  st.runs = [...(st.runs || []), { at: now.toISOString(), results: d.survey.results, diaries: d.survey.diaries }].slice(-50)
  writeFileSync(statePath(ws), JSON.stringify(st, null, 2), 'utf8')
  did.push('记了这一轮')

  // 二、做不了的，明说做不了——不编内容。
  for (const t of d.todo) {
    if (t.selfDoable) continue
    cant.push(`${t.why}${t.blocking ? '（' + t.blocking + '）' : ''}`)
  }

  return { did, cant, state: d }
}

/** 人看的一行。 */
export function brief(ws, opts = {}) {
  const r = runAutonomy(ws, opts)
  const parts = []
  parts.push(`今天做了什么：${r.did.length ? r.did.join('、') : '没做'}`)
  if (r.cant.length) parts.push(`做不了的：${r.cant.join('；')}`)
  return parts.join('\n')
}

// —— 能直接跑：node lib/autonomy.mjs [工作区] ——
if (process.argv[1] && process.argv[1].endsWith('autonomy.mjs')) {
  const ws = wsOf(process.argv[2])
  const r = runAutonomy(ws)
  console.log(`自主程序跑完一轮（工作区 ${ws}）`)
  console.log('  做了：' + (r.did.length ? r.did.join('、') : '没做'))
  if (r.cant.length) for (const c of r.cant) console.log('  做不了：' + c)
  console.log('  日志：' + logPath(ws))
}
