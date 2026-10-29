/**
 * 自动写的调度：谁写、多久写一次、什么时候该动了。
 *
 * 谁写：
 * - plugin：插件自己扫池子收候选（不问模型，纯机械）。
 * - ai：把「该收一批了」写进注入，由 AI 判断收什么、定不定成含义。
 * - model：交给默认模型写——不给判断框架，就在正常轮次里顺手写，写多少条自己定。
 *
 * 多久：
 * - off 不排期｜now 只按按钮｜daily 每天｜weekly 每周｜monthly 每月
 * - at 每天固定时刻（autoAt = 'HH:MM'）｜days 每 N 天（autoDays）
 *
 * 到点才动：记 last 时间戳，没到点不重复跑。从没跑过算首次，直接跑。
 */

export const AUTO_EVERY = ['off', 'now', 'daily', 'weekly', 'monthly', 'at', 'days']
export const AUTO_MODES = ['off', 'plugin', 'ai', 'model']

const DAY = 86400000

const atMinutes = (hhmm) => {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1]), mi = Number(m[2])
  if (h > 23 || mi > 59) return null
  return h * 60 + mi
}

/** 到了没有？到点返回理由，没到返回 null。 */
export function dueReason(cfg, now = Date.now()) {
  const mode = String(cfg.autoMode || 'off')
  if (!AUTO_MODES.includes(mode) || mode === 'off') return null
  const every = String(cfg.autoEvery || 'off')
  const last = Number(cfg.autoWriteLast) || 0
  const manual = Number(cfg.autoWriteNow) || 0

  // 按钮：按下的时间比上次执行新，就跑一次
  if (manual && manual > last) return 'manual'
  if (!AUTO_EVERY.includes(every) || every === 'off') return null

  // 「立即」只认按钮，不自己首跑
  if (every === 'now') return null
  if (!last) return `first:${every}`

  const passed = now - last

  if (every === 'daily') return passed >= DAY ? 'daily' : null
  if (every === 'weekly') return passed >= DAY * 7 ? 'weekly' : null
  if (every === 'monthly') return passed >= DAY * 30 ? 'monthly' : null
  if (every === 'days') {
    const n = Math.max(1, Number(cfg.autoDays) || 1)
    return passed >= DAY * n ? `days:${n}` : null
  }
  if (every === 'at') {
    const target = atMinutes(cfg.autoAt)
    if (target === null) return null
    const d = new Date(now)
    const mins = d.getHours() * 60 + d.getMinutes()
    if (mins < target) return null
    // 今天到点之后已经跑过就不再跑
    const lastD = new Date(last)
    const sameDay = lastD.getFullYear() === d.getFullYear()
      && lastD.getMonth() === d.getMonth() && lastD.getDate() === d.getDate()
    return sameDay ? null : `at:${cfg.autoAt}`
  }
  return null
}
