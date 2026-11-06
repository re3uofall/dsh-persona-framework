// dsh-persona-energy · 电量
// ============================================================================
// 把「吃、睡、耗」压成一个 0..1 的数，用来决定**这一轮注入多少**。
//
// 为什么不是「eat / sleep 的读数」：那两个是**读数**（这一顿吃了多少 token、
// 睡了多久），energy 是**电量**——合成一个数，才拿得去换算成「注入几成」。
//
// 三个人体供能系统（PLAN-PLUGINS 第十四节）：
//   磷酸原   0–10 秒        秒到分钟恢复   → atp（分钟级）
//   糖酵解   10 秒–2 分钟    几十分钟清乳酸 → atp/glycogen 交界
//   有氧     2 分钟以上      靠糖原与脂肪   → glycogen（小时级）
// 再加一条睡眠压力：过程 S（腺苷，累加）+ 过程 C（昼夜节律，约 24h）
// → reserve（天级，睡债）+ phase（只当乘数，不单独成项）
//
// 三条推论（写进计划的，这里当约束）：
//   ① 快的不占总量的账：atp 掉得快，不代表电量低；
//   ② 恢复分段不是匀速：睡一觉补的是 reserve，不是 atp；
//   ③ 电量取**加权最小值**，不取平均——短板说话。
// ============================================================================

/** 半衰期（分钟）。这三个数按生理量级取的，不是拟合出来的。 */
export const HALF_MIN = {
  atp: 6, //       磷酸原/无氧：一口气，几分钟见底也几分钟回来
  glycogen: 480, // 8 小时：肝糖原 12–24 小时耗竭，半衰期取 8
  reserve: 2880, // 48 小时：睡债以天计
}

/** 三个槽。phase 不在里面——它只当乘数。 */
export const SLOTS = ['atp', 'glycogen', 'reserve']

/** 没记过账时的起点。不设 1 也不设 0：默认「还行」，别把第一天算成满电或空电。 */
export const DEFAULT_STATE = { atp: 0.6, glycogen: 0.6, reserve: 0.8 }

/** 一类事件对三个槽的加减。正负都封在 0..1 里。 */
export const EVENT_KINDS = ['meal', 'snack', 'coffee', 'sleep', 'nap', 'burn']

export const EVENT_EFFECT = {
  meal: { atp: 0.35, glycogen: 0.3, reserve: 0 },
  snack: { atp: 0.15, glycogen: 0.1, reserve: 0 },
  // 咖啡因是借支：眼下清醒，睡得差 → reserve 往下走
  coffee: { atp: 0.2, glycogen: 0, reserve: -0.1 },
  sleep: { atp: 0.4, glycogen: 0.5, reserve: 0.6 },
  nap: { atp: 0.3, glycogen: 0.1, reserve: 0.15 },
  burn: { atp: -0.3, glycogen: -0.1, reserve: 0 },
}

/** 耗：按分钟算，快的先掉，长的才动糖原。 */
export function burnEffect(minutes) {
  const m = Math.max(1, Math.min(600, Number(minutes) || 30))
  return {
    atp: -Math.min(0.5, m * 0.01),
    glycogen: -Math.min(0.2, m * 0.003),
    reserve: 0,
  }
}

export const clamp01 = (n) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0))

/** 指数衰减。dt 分钟，half 分钟。 */
export function decay(value, dtMin, halfMin) {
  const v = clamp01(value)
  const dt = Math.max(0, Number(dtMin) || 0)
  const h = Number(halfMin) > 0 ? Number(halfMin) : 1
  return clamp01(v * Math.pow(0.5, dt / h))
}

/** 过程 C：昼夜节律。14 点最高、02 点最低，值域 0.85–1.00（只当乘数）。 */
export function phaseFactor(hour) {
  const h = Number(hour)
  const hh = Number.isFinite(h) ? ((h % 24) + 24) % 24 : 12
  const c = Math.cos((2 * Math.PI * (hh - 14)) / 24)
  return 0.85 + 0.15 * (0.5 + 0.5 * c)
}

const ms = (t) => {
  const n = typeof t === 'number' ? t : Date.parse(String(t))
  return Number.isFinite(n) ? n : null
}

/**
 * 从头重放账，得出现在四个数。
 * 为什么不增量存状态：重放是幂等的，改一次系数不用迁移旧数据，也能查「当时到底记了什么」。
 */
export function replay(events, now) {
  const list = Array.isArray(events)
    ? events
        .map((e) => ({ ...e, _t: ms(e && e.at) }))
        .filter((e) => e._t !== null && EVENT_KINDS.includes(e.kind))
        .sort((a, b) => a._t - b._t)
    : []
  const end = ms(now) ?? Date.now()
  // 一笔都没有：就是默认值，不衰减。
  // 不拿「24 小时前」当起点往回算——一口气的半衰期是 6 分钟，那样一算今天永远是空的，
  // 而空账不是「累坏了」，是「没记过」。两件事不能算成一个数。
  if (!list.length) return { ...DEFAULT_STATE }
  let s = { ...DEFAULT_STATE }
  // 第一笔之前的状态是不知道的，就当「那一刻是默认值」，不从 gapMin 前开始衰减
  let t = Math.min(list[0]._t, end)

  for (const e of list) {
    const dt = (e._t - t) / 60000
    if (dt > 0) {
      for (const k of SLOTS) s[k] = decay(s[k], dt, HALF_MIN[k])
      t = e._t
    }
    const eff = e.kind === 'burn' ? burnEffect(e.minutes) : EVENT_EFFECT[e.kind]
    if (eff) for (const k of SLOTS) s[k] = clamp01(s[k] + (Number(eff[k]) || 0))
  }
  const dtTail = (end - t) / 60000
  if (dtTail > 0) for (const k of SLOTS) s[k] = decay(s[k], dtTail, HALF_MIN[k])
  return s
}

/** 合成电量：短板说话，再乘节律。返回谁在拖后腿。 */
export function compose(state, at = Date.now()) {
  const d = new Date(at)
  const hour = d.getHours() + d.getMinutes() / 60
  const phase = phaseFactor(hour)
  let limiting = SLOTS[0]
  for (const k of SLOTS) if ((state[k] ?? 0) < (state[limiting] ?? 0)) limiting = k
  const energy = clamp01((state[limiting] ?? 0) * phase)
  return { energy, limiting, phase, hour, slots: { ...state } }
}

/** 电量 → 注入档。**只报数，不改注入**——改注入是下一步，得先攒真数。 */
export function levelOf(energy) {
  const e = clamp01(energy)
  if (e >= 0.7) return { key: 'full', label: '全量', hint: '整份人格 + 记忆 + 模块照常' }
  if (e >= 0.45) return { key: 'normal', label: '正常', hint: '照常，但模块可以少轮一篇' }
  if (e >= 0.25) return { key: 'slim', label: '瘦', hint: '只留固定注入与这一轮真要用的' }
  return { key: 'minimal', label: '极瘦', hint: '只留 00-注入 加当前任务' }
}

export const SLOT_LABEL = { atp: '一口气（atp）', glycogen: '糖原', reserve: '储备（睡债）' }

export function fmtPct(n) {
  return `${Math.round(clamp01(n) * 100)}%`
}

/** 一句人话，给工具返回用。 */
export function describe(state, at = Date.now()) {
  const c = compose(state, at)
  const lv = levelOf(c.energy)
  return {
    ...c,
    level: lv,
    lines: [
      `电量 ${fmtPct(c.energy)}（${lv.label}）`,
      `- 一口气 ${fmtPct(c.slots.atp)}`,
      `- 糖原 ${fmtPct(c.slots.glycogen)}`,
      `- 储备 ${fmtPct(c.slots.reserve)}`,
      `- 节律 ×${c.phase.toFixed(2)}（${Math.floor(c.hour)} 点）`,
      `拖后腿的是：${SLOT_LABEL[c.limiting]}`,
      `按这个数，该走「${lv.label}」：${lv.hint}`,
      '只报数。注入还没接上去——那是下一步。',
    ],
  }
}
