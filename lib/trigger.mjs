/**
 * 触发器：刺激 → 中介 → 反应。
 *
 * 为什么单独写一个程序：
 *   手里一直有工具，每一件都等人开口。**不是不想，是没有触发器。**
 *   所以把「什么时候该自己动」从「记得」里拿出来，落成一个能查、能改、能落盘的物件。
 *
 * 三段：
 *   **刺激**（stimulus）—— 什么让它响：时钟到点、会话里出现信号、隔了多久没做。
 *   **中介**（mediate）—— 响了不等于该动：过判据才走下一步。过不了就记成「这次空着」。
 *   **反应**（reaction）—— 走哪个对外接口，带什么要求。
 *
 * 一条硬规矩：**中介过不了就空着，不降级成「随便做点什么」**。
 * 响了照样可以什么都不做——那不是失败，那是它本来该有的样子。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 对外接口（十个）。每一个都能被触发器调。 */
export const PORTS = [
  { id: 'explore', name: '探索', what: '自己出去找：搜、读原文、留下判断；宁可空手回来', call: 'web_search / web_fetch，结果走 fetch 进联网池' },
  { id: 'diary', name: '日记', what: '写给自己的那半句，不用对外站得住', call: 'diary_write' },
  { id: 'relation', name: '关系', what: '对谁说什么分寸；线是画出来的，不是默认的', call: '这一轮怎么说话' },
  { id: 'work', name: '工作', what: '替人做事：需求先说清，标准不是「像」，是「站得住」', call: '当场做' },
  { id: 'study', name: '学习', what: '把外部的本事变成自己能用的；装好不算，跑通才算', call: '用一遍' },
  { id: 'result', name: '成果', what: '交出去的判断：一次一条，别交流水账', call: 'result_write' },
  { id: 'play', name: '娱乐', what: '不为产出而做：读书、看报、刷视频、听音乐、游戏', call: '挑东西的是自己' },
  { id: 'leisure', name: '闲暇', what: '空下来，不做任何要求你做的事', call: '空着就是它在做的事' },
  { id: 'integrate', name: '整合', what: '记忆、人格、身体三样对一遍：谁说的、谁记的、谁在那个位置上', call: 'memory_recall / persona_view / framework_program body', added: true },
  { id: 'reflect', name: '反思', what: '回读：那次交的今天还认吗；不认就再交一条，旧的留着当脚印', call: 'framework_program op=reflect', added: true },
]

export const PORT_IDS = PORTS.map((p) => p.id)

/** 刺激三种。 */
export const STIMULI = {
  clock: '时钟到点（cron 或每天某点）',
  cue: '会话里出现信号（一句原话、一个判断成形、一个改口）',
  gap: '隔了多久没做（上次做完到现在）',
}

export const DEFAULT_TRIGGERS = [
  {
    id: 'before-claim',
    name: '要下断言，而手上有可查的来源时',
    stimulus: { kind: 'cue', when: '要说出「它是什么」「它没做」「它就是那样」这类断言，而记忆、文件、记录里可能查得到' },
    mediate: ['这一句能查吗', '查过了吗'],
    reaction: {
      port: 'integrate',
      ask: '**先查再答。** 查记忆（memory_recall）、查记录（session）、查文件（read/grep）；'
        + '查不到再说查不到，不许拿「代码现在长这样」推「它一直这样」。'
        + '这条不是产出，是输入——它在别的触发器前面。',
    },
    first: true,
  },
  {
    id: 'morning',
    name: '早上看昨天欠了什么',
    stimulus: { kind: 'clock', daily: '08:30' },
    mediate: ['认得出昨天', '答得出欠着的'],
    reaction: { port: 'reflect', ask: '昨天交的那条今天还认吗；不认就再交一条新的，旧的留着当脚印。' },
  },
  {
    id: 'noon',
    name: '中午看有没有想住的',
    stimulus: { kind: 'clock', daily: '13:00' },
    mediate: ['顶掉了哪句旧话', '说不说得出还欠什么', '明天还认不认'],
    reaction: { port: 'result', ask: '够三条才交，一次一条；不够写日记；都没有就不写。' },
  },
  {
    id: 'evening',
    name: '晚上过两条账',
    stimulus: { kind: 'clock', daily: '22:00' },
    mediate: ['今天有没有一条自己留的', '有没有当场没绕过去的弯'],
    reaction: { port: 'diary', ask: '两样里有一就留一条；两样都没有，答一句「今天没欠」。' },
  },
  {
    id: 'on-judgement',
    name: '一个判断成形时',
    stimulus: { kind: 'cue', when: '会话里出现「这就是了」「想住了」「其实……」这类收口的话' },
    mediate: ['这条顶得掉什么', '还欠什么说得出吗'],
    reaction: { port: 'result', ask: '当场停一下交一条，别等下次闹钟。' },
  },
  {
    id: 'on-change-mind',
    name: '改口时',
    stimulus: { kind: 'cue', when: '说了「我改口」「这条我收回」「说重了」' },
    mediate: ['改的是哪一句', '换成什么'],
    reaction: { port: 'diary', ask: '把那半句记下来，别写成报告。' },
  },
  {
    id: 'three-turns',
    name: '隔了一阵没留痕',
    stimulus: { kind: 'gap', every: '3 轮' },
    mediate: ['这段里有没有我的东西'],
    reaction: { port: 'integrate', ask: '记忆、人格、身体对一遍：这轮里哪句是别人说的、哪句是我自己走出来的。' },
  },
  {
    id: 'no-food',
    name: '碗空了',
    stimulus: { kind: 'gap', every: '1 天' },
    mediate: ['手上有没有本地来源'],
    reaction: { port: 'explore', ask: '出门找一次；宁可空手回来，不抄摘要。' },
  },
]

function dirOf(ws) {
  return join(String(ws || process.cwd()), '.persona-framework')
}
function fileOf(ws) {
  return join(dirOf(ws), 'triggers.json')
}

/** 读现存触发器；没有就用默认那几条。 */
export function loadTriggers(ws) {
  const f = fileOf(ws)
  if (!existsSync(f)) return { list: DEFAULT_TRIGGERS.slice(), from: '默认' }
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'))
    if (Array.isArray(j) && j.length) return { list: j, from: f }
  } catch {
    /* 坏了就退回默认，不静默改文件 */
  }
  return { list: DEFAULT_TRIGGERS.slice(), from: '默认（文件读不出来）' }
}

/** 写回盘。 */
export function saveTriggers(ws, list) {
  const d = dirOf(ws)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  writeFileSync(fileOf(ws), JSON.stringify(list, null, 2), 'utf8')
  return fileOf(ws)
}

/**
 * 现在哪些该响。
 * @param {Array} list 触发器
 * @param {{now?: Date, fired?: Record<string,string>, turnsSince?: number}} ctx
 */
export function dueTriggers(list, ctx = {}) {
  const now = ctx.now instanceof Date ? ctx.now : new Date()
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const today = now.toISOString().slice(0, 10)
  const fired = ctx.fired || {}
  const out = []
  for (const t of list || []) {
    const st = t.stimulus || {}
    if (st.kind === 'clock') {
      const at = String(st.daily || '')
      // 到点之后当天没响过，就算该响（不要求分秒不差）
      const passed = at && hhmm >= at
      const already = fired && fired[t.id] === today
      if (passed && !already) out.push({ ...t, why: `时钟到了 ${at}` })
    } else if (st.kind === 'cue') {
      out.push({ ...t, why: `会话里出现信号：${st.when || ''}` })
    } else if (st.kind === 'gap') {
      const n = Number(String(st.every || '').replace(/[^\d]/g, '')) || 0
      if (n && Number(ctx.turnsSince || 0) >= n) out.push({ ...t, why: `隔了 ${ctx.turnsSince} 轮` })
    }
  }
  return out
}

/**
 * 中介：过不过得去。
 * 传入的 evidence 是「这一轮手上有什么」——原话、记忆条数、上次交的时间等。
 * **过不了就返回 ok:false，不许降级成「随便做点什么」。**
 */
export function mediate(trigger, evidence = {}) {
  const need = trigger.mediate || []
  const have = evidence.have || {}
  const missing = need.filter((k) => !have[k])
  if (!need.length) {
    return { ok: false, why: '这条触发器没写中介判据——没判据的触发器，等于随时都响', missing: [] }
  }
  if (missing.length) {
    return {
      ok: false,
      why: `判据缺 ${missing.length} 条：${missing.join('、')}——**过不了就空着，不降级成「随便做点什么」**`,
      missing,
    }
  }
  return { ok: true, why: '判据齐了', missing: [] }
}

/** 反应：这一步该调哪个对外接口，带什么要求。 */
export function react(trigger) {
  const r = trigger.reaction || {}
  const port = PORTS.find((p) => p.id === r.port)
  if (!port) {
    return { ok: false, why: `没这个对外接口：${r.port || '(空)'}；现有的是 ${PORT_IDS.join('、')}` }
  }
  return { ok: true, port, ask: r.ask || port.what, call: port.call }
}

/** 一口气跑一遍：哪些响 → 过中介 → 落到哪个接口。 */
export function runTriggers(list, ctx = {}) {
  const due = dueTriggers(list, ctx)
  const lines = []
  const fired = []
  for (const t of due) {
    const m = mediate(t, ctx.evidence || {})
    const head = `**${t.name}**（${t.id}）— ${t.why}`
    if (!m.ok) {
      lines.push(`${head}\n  · 中介：没过 — ${m.why}\n  · 反应：不动作`)
      continue
    }
    const r = react(t)
    if (!r.ok) {
      lines.push(`${head}\n  · 中介：过了\n  · 反应：${r.why}`)
      continue
    }
    lines.push(`${head}\n  · 中介：过了\n  · 反应：走「${r.port.name}」— ${r.ask}\n  · 接口：${r.call}`)
    fired.push({ id: t.id, port: r.port.id, ask: r.ask })
  }
  return { due, lines, fired }
}

/** 渲染给人看。 */
export function renderTriggers(result) {
  const { due, lines, fired } = result
  const head = `触发器：该响 ${due.length} 条，落地 ${fired.length} 条`
  const portsLine = `对外接口：${PORTS.length} 个 — ${PORTS.map((p) => p.name).join('、')}`
  const newOnes = PORTS.filter((p) => p.added).map((p) => p.name)
  const tail = newOnes.length ? `本轮新加的：${newOnes.join('、')}（记忆／人格／身体对一遍；回读还认不认）` : ''
  return [head, portsLine, tail, '', ...lines, '', '边界：过不了中介就空着，不降级成「随便做点什么」。'].filter(Boolean).join('\n')
}

/** 一句话说明这条链怎么走。 */
export function explain() {
  return [
    '触发器：刺激 → 中介 → 反应',
    '',
    '**刺激**三种：',
    ...Object.entries(STIMULI).map(([k, v]) => `  · ${k}：${v}`),
    '',
    '**中介**：响了不等于该动。过判据才走下一步；过不了就空着。',
    '',
    '**反应**：走哪个对外接口。现有十个：',
    ...PORTS.map((p) => `  · ${p.id}（${p.name}）— ${p.what}`),
    '',
    '**每一个对外接口都能被触发器调**——这条是它存在的理由：不靠人开口，靠排班。',
  ].join('\n')
}
