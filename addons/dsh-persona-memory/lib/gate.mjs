// 同一轮里第几步 —— 只为了别把人格重复注入十几次。
// 记的人只有一个：人格出现插件（appear 挂 agent/pre-step）。
// 别的插件只读，不写；appear 没装，这里永远说「第一步」，等于全量注入，不会坏。
let cur = { turn: null, step: 0, base: null, at: 0, full: 0, skipped: 0 }

export const ANCHOR = [
  '## 人格（同一轮后续步骤）',
  '',
  '本轮的完整人格、框架、模块与记忆已经在第一步给过，这里不再重复——照上面给过的来。',
  '只有一处要留：**语气和底线不跟着上下文变长而变松**；不确定的时候按第一步的自己说话。',
].join('\n')

export function noteStep(payload) {
  try {
    const turn = payload?.turn ?? payload?.turnIndex ?? null
    const s0 = Number(payload?.step ?? 0)
    const s = Number.isFinite(s0) ? s0 : 0
    // base = 这一轮第一次看到的 step。判「是不是重复」只许跟它比，不跟 0 比——
    // 宿主第一步给的可能是 1；拿 0 当基准的话，每轮第一步就被判成重复，四段记忆全线返回空。
    // 另外两种「换了一轮」的信号也认：turn 变了；或者 step 退回去了（有些宿主不带 turn）。
    if (cur.base === null) {
      cur = { ...cur, turn, step: s, base: s, at: Date.now() }
    } else if (turn !== cur.turn || s < cur.step) {
      cur = { ...cur, turn, step: s, base: s, at: Date.now(), full: cur.full + 1 }
    } else if (s > cur.step) {
      cur.step = s
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
