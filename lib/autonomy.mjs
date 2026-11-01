/**
 * 自主程序：算「现在该做什么」。
 *
 * 和 12 自主（assert12）的区别，说在前面：
 *   assert12 是**查**——拿一段话说，看它像不像自主的（有缺口吗、写没写代价）。
 *   这个文件是**做**——没人问的时候，自己算出现在该动哪一件，并把结果写进注入。
 *
 * 为什么要它：触发器只是列了「什么时候该响」，响不响还得有人读。
 * 这里把它落成一次真计算：读记录 → 算优先级 → 出一条 → 落盘。
 * **算不出就返回空着**，不许为了显得勤快硬编一件。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 落盘位置。 */
function dirOf(ws) {
  return join(String(ws || process.cwd()), '.persona-framework')
}
export function statePath(ws) {
  return join(dirOf(ws), 'autonomy.json')
}

/** 读上次的记录。 */
export function loadState(ws) {
  const f = statePath(ws)
  if (!existsSync(f)) return { last: {} }
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'))
    return j && typeof j === 'object' && j.last ? j : { last: {} }
  } catch {
    return { last: {} }
  }
}

/** 写回。 */
export function saveState(ws, state) {
  const d = dirOf(ws)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  writeFileSync(statePath(ws), JSON.stringify(state, null, 2), 'utf8')
  return statePath(ws)
}

/** 记一次做过的事。 */
export function markDone(ws, id, at = new Date()) {
  const st = loadState(ws)
  st.last[id] = at.toISOString()
  return saveState(ws, st)
}

const DAY = 24 * 3600 * 1000

function hoursSince(iso, now) {
  if (!iso) return Infinity
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return Infinity
  return (now.getTime() - t) / 3600000
}

/**
 * 算「现在该做什么」。
 *
 * 次序不是随便排的：**先查，再交，再写，最后才是空着。**
 * 查排在前面，是因为没查就交的那条，交出去也是错的。
 *
 * @returns {{act: string, name: string, why: string, ask: string}|{act:'none', why:string}}
 */
export function autonomyNow(ws, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date()
  const st = loadState(ws)
  const last = st.last || {}

  // 一、先查：手上有可查而没查的断言，优先级最高。
  //    这条没法自动判定「有没有」，只能靠时间：隔太久没查过，就提醒一次。
  const hCheck = hoursSince(last.check, now)
  if (hCheck >= 24) {
    return {
      act: 'check',
      name: '先查再说',
      why: hCheck === Infinity ? '还没有一次「先查」的记录' : `距上次查已经 ${Math.floor(hCheck)} 小时`,
      ask: '要下的这个断言，记忆、记录、文件里查得到吗？先查；查不到就说查不到，'
        + '不许拿「代码现在长这样」推「它一直这样」。',
    }
  }

  // 二、交成果：隔了一天没交，就该问自己有没有想住的。
  const hResult = hoursSince(last.result, now)
  if (hResult >= 30) {
    return {
      act: 'result',
      name: '该交了',
      why: hResult === Infinity ? '还没有一条交出去的成果' : `距上次交已经 ${Math.floor(hResult)} 小时`,
      ask: '够三条才交：顶掉了哪句旧话、说不说得出还欠什么、明天还认不认。'
        + '不够就写日记；两样都没有，就空着。',
    }
  }

  // 三、写日记：心事这一头。
  const hDiary = hoursSince(last.diary, now)
  if (hDiary >= 30) {
    return {
      act: 'diary',
      name: '该记一笔了',
      why: hDiary === Infinity ? '还没有日记' : `距上次写已经 ${Math.floor(hDiary)} 小时`,
      ask: '今天有没有哪个弯当场没绕过去？那半句写下来，别写成报告。',
    }
  }

  // 四、什么都够：空着。**这一条也是结果，不是失败。**
  return {
    act: 'none',
    why: '该查的查了、该交的交了、该写的写了——**现在什么都没欠，空着。**',
  }
}

/** 渲染成一段注入文本。没该做的事，也照实说空着。 */
export function renderAutonomy(ws, opts = {}) {
  const r = autonomyNow(ws, opts)
  if (r.act === 'none') {
    return ['**本轮没有非做不可的。**', r.why, '', '空着比凑数强——这条不是退路，是正解。'].join('\n')
  }
  return [
    `**现在该：${r.name}**（${r.act}）`,
    '',
    `· 为什么是它：${r.why}`,
    `· 要做什么：${r.ask}`,
    '',
    '做完了记一笔（markDone）；不做也可以，但要说得出来为什么不做。',
  ].join('\n')
}

/** 一句话摘要，给状态行用。 */
export function autonomyLine(ws, opts = {}) {
  const r = autonomyNow(ws, opts)
  return r.act === 'none' ? '没有非做不可的' : `现在该：${r.name}`
}
