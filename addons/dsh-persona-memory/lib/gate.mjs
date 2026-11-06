// 同一轮里第几步 —— 只为了别把人格重复注入十几次。
// 记的人只有一个：人格出现插件（appear 挂 agent/pre-step）。
// 别的插件只读，不写；appear 没装，这里永远说「第一步」，等于全量注入，不会坏。
let cur = { turn: null, step: 0, at: 0, full: 0, skipped: 0 }

export const ANCHOR = [
  '## 人格（同一轮后续步骤）',
  '',
  '本轮的完整人格、框架、模块与记忆已经在第一步给过，这里不再重复——照上面给过的来。',
  '只有一处要留：**语气和底线不跟着上下文变长而变松**；不确定的时候按第一步的自己说话。',
].join('\n')

export function noteStep(payload) {
  try {
    const turn = payload?.turn ?? payload?.turnIndex ?? null
    const step = Number(payload?.step ?? 0)
    if (turn !== cur.turn) {
      // 新的一轮：把这个 turn 第一次看到的 step 记成 base。
      // 不能假设它是 0——宿主第一步给的是 1，写死 `step > 0` 会让每轮第一步就被当成「重复」，
      // 四段记忆全线返回空，表现就是「即时记忆没生效」。判据要相对，不写绝对值。
      cur = { turn, step: Number.isFinite(step) ? step : 0, base: Number.isFinite(step) ? step : 0, at: Date.now(), full: cur.full + 1, skipped: cur.skipped }
    } else if (Number.isFinite(step) && step > cur.step) {
      cur.step = step
    }
  } catch { /* 记不上就当第一步 */ }
}

export function isRepeat() { return cur.step > (cur.base ?? 0) }

export function apply(fn, note = ANCHOR) {
  if (isRepeat()) { cur.skipped += 1; return note }
  cur.full += 0
  return typeof fn === 'function' ? fn() : fn
}

export function gateSkip() { return isRepeat() }

export function snapshot() {
  return { turn: cur.turn, step: cur.step, repeat: isRepeat(), at: cur.at, skipped: cur.skipped }
}
