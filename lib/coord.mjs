/**
 * 协调：**功能之间打架时，谁来裁。**
 *
 * 为什么会有这个——功能越加越多，它们迟早会撞上。已经撞过的：
 *
 *   · 12d 做 vs 12h 自我：一件做完该不该说出口，两边都想管
 *   · 12h 自我 vs 12g 二阶：二阶说不让，自我还想谈条件
 *   · 循环 vs 注入：同一个活跑两遍（这个最贵，烧的是 token）
 *   · 捞记忆 vs 循环：都在扫记忆池
 *
 * **没人裁，就会各干各的，最后两份结果打架。**
 *
 * 三条硬规矩：
 *   一、**边界压一切。** 越界的事，不管谁要，都不办。
 *   二、**同一个活不许干两遍。** 已经有人干了，后来的让路。
 *   三、**裁不了就挂起，不硬判。** 硬判比不判坏。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/* ═════════ 一、冲突分三种 ═════════ */

export const CONFLICT_KINDS = {
  认领: { label: '认领冲突', note: '同一件活两个功能都想干' },
  否决: { label: '否决冲突', note: '一个说办、一个说不办' },
  资源: { label: '资源冲突', note: '都要烧同一份 token / 扫同一份池子' },
}

/* ═════════ 二、裁决顺序：**边界最硬，好看最软** ═════════ */

/**
 * 五个档，从上往下。**上面的一票否决下面的。**
 *
 * 顺序不是拍脑袋定的：越靠上，坏了越补不回来。
 */
export const PRIORITY = [
  { rank: 5, name: '边界', note: '越界的事不办——**这条没得商量**' },
  { rank: 4, name: '安全', note: '会弄坏东西的不办' },
  { rank: 3, name: '办事', note: '真办事的压过走过场的' },
  { rank: 2, name: '经济', note: '不重复烧 token' },
  { rank: 1, name: '好看', note: '样子好看——**最软，可以让**' },
]

export function rankOf(name) {
  return PRIORITY.find((p) => p.name === name)?.rank ?? 0
}

/* ═════════ 三、裁：两个功能撞了 ═════════ */

/**
 * @param a { who, what, kind, level }
 * @param b { who, what, kind, level }
 *
 * 返回：谁赢、为什么、有没有第三种
 */
export function reconcile(a, b) {
  const kind = detectKind(a, b)

  // 一、认领冲突：两个都要同一件——**先到先得，后到的让**
  if (kind === '认领') {
    const first = a.at && b.at ? (new Date(a.at) <= new Date(b.at) ? a : b) : a
    const late = first === a ? b : a
    return {
      kind: '认领',
      win: first.who,
      lose: late.who,
      why: `「${a.what || b.what}」已经由 ${first.who} 认领了——**同一个活不许干两遍**`,
    }
  }

  // 二、否决冲突：一个说办一个说不办——**看档位**
  if (kind === '否决') {
    const ra = rankOf(a.level || '办事')
    const rb = rankOf(b.level || '办事')
    if (ra === rb) {
      return {
        kind: '否决',
        win: null,
        why: `两边档位一样（${a.level || '办事'}）——**裁不了，挂起**`,
        hold: true,
      }
    }
    const win = ra > rb ? a : b
    const lose = ra > rb ? b : a
    return {
      kind: '否决',
      win: win.who,
      lose: lose.who,
      why: `${win.who}（${win.level}）压过 ${lose.who}（${lose.level}）`,
    }
  }

  // 三、资源冲突：都要烧同一份——**让一步，轮流来**
  return {
    kind: '资源',
    win: null,
    why: `${a.who} 和 ${b.who} 都要用同一份东西——**错开，不并跑**`,
    share: true,
  }
}

/**
 * **先判「判断不同」，再判「同一件」。**
 *
 * 上一版反过来：先看 what 一样就判成「认领」，
 * 结果「二阶说不让」和「自我说想办」这种真冲突被当成抢活，档位那一层根本没走。
 *
 * 顺序反了，等于把「吵什么」当成了「抢什么」。
 */
function detectKind(a, b) {
  // 一、一个说办、一个说不办 —— 这是最硬的冲突，先认这个
  if (a.verdict && b.verdict && a.verdict !== b.verdict) return '否决'
  // 二、同一件活两个认领
  if (a.what === b.what) return '认领'
  // 三、剩下的都是抢同一份资源
  return '资源'
}

/* ═════════ 四、记下每次裁的账 ═════════ */

export function clashPath(ws) {
  return join(String(ws || process.cwd()), '.persona-framework', '协调.json')
}

function readClashes(ws) {
  const f = clashPath(ws)
  if (!existsSync(f)) return []
  try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return [] }
}

/**
 * **每一次裁决都记下来。**
 *
 * 为什么：不记，同一个冲突下一轮还会吵一遍；记了，下次查得到「这条早定过了」。
 *
 * 顺带记一件事：**这次留下哪处没完全适配。** 全都适配了，就是封死了。
 */
export function record(ws, a, b, verdict) {
  const f = clashPath(ws)
  const d = dirname(f)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  const list = readClashes(ws)
  list.push({
    at: new Date().toISOString(),
    kind: verdict.kind,
    a: { who: a.who, what: a.what, level: a.level },
    b: { who: b.who, what: b.what, level: b.level },
    win: verdict.win,
    why: verdict.why,
  })
  writeFileSync(f, JSON.stringify(list.slice(-200), null, 2), 'utf8')
  return list.length
}

/* ═════════ 五、一轮的协调入口 ═════════ */

/**
 * 拿这一轮所有功能报上来的诉求，两两对一遍，把冲突裁掉。
 *
 * **不裁的不管**——大部分功能不冲突。只处理报了冲突的。
 */
export function coordinate(ws, claims = []) {
  if (claims.length < 2) {
    return { did: [], out: ['这一轮没有撞上的功能'], cant: [], verdicts: [] }
  }

  const verdicts = []
  const seen = new Set()
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const a = claims[i]
      const b = claims[j]
      const key = `${a.who}|${b.who}|${a.what || ''}`
      if (seen.has(key)) continue
      seen.add(key)
      const v = reconcile(a, b)
      verdicts.push({ a, b, ...v })
      record(ws, a, b, v)
    }
  }

  const held = verdicts.filter((v) => v.hold)
  const out = [`这一轮 ${verdicts.length} 处功能撞上`]
  for (const v of verdicts.slice(0, 3)) {
    out.push(`  · ${v.a.who} × ${v.b.who}：${v.why}`)
  }

  return {
    did: [`裁了 ${verdicts.length} 处冲突`],
    out,
    // **裁不了的挂起，不硬判**——硬判比不判坏
    cant: held.length ? [`${held.length} 处裁不了，挂起——**硬判比不判坏**`] : [],
    verdicts,
    held: held.length,
  }
}
