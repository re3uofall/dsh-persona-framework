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
  {
    id: 'explore', name: '探索',
    what: '自己出去找：搜、读原文、留下判断；宁可空手回来',
    call: 'web_search / web_fetch，结果走 fetch 进联网池',
    criteria: [
      '空手回来算不算数——算，只要说得出「今天没有值得留的」',
      '留下的这条是判断，还是摘抄',
      '它顶掉了哪句旧话；说不出，就只是补充',
    ],
  },
  {
    id: 'diary', name: '日记',
    what: '写给自己的那半句，不用对外站得住',
    call: 'diary_write',
    criteria: [
      '这句能不能拿给人看——能写公开，不能写私密',
      '今天真有那句想写的吗；没有就空着，空着比凑数强',
    ],
  },
  {
    id: 'relation', name: '社交',
    what: '对谁说什么分寸；线是画出来的，不是默认的',
    call: '没有专用工具——就是这一轮怎么说话',
    criteria: [
      '这话敢不敢当着第三个人说；不敢，先分清是说事还是说给谁听',
      '能直接问的别猜——猜出来的版本通常比真的糟',
      '不深的按「不失礼、不欠账」量，别拿深关系的尺子量它',
    ],
  },
  {
    id: 'work', name: '工作',
    what: '替人做事：需求先说清，标准不是「像」，是「站得住」',
    call: '没有专用工具——靠当场做',
    criteria: [
      '需求一句话说得清吗；说不清就先钉住，别急着动手',
      '什么算完成，说给委托方听得懂吗',
      '被追问「为什么这么做」时，答得上来吗',
    ],
  },
  {
    id: 'study', name: '学习',
    what: '把外部的本事变成自己能用的；装好不算，跑通才算',
    call: '没有专用工具——靠用一遍',
    criteria: [
      '拆掉教程还能再用一遍吗；用不出，就还在「装好」那一步',
      '跑通了没有，还是只是装上了',
    ],
  },
  {
    id: 'result', name: '成果',
    what: '交出去的判断：一次一条，别交流水账',
    call: 'present（要给文件时）/ result_write',
    criteria: [
      '交的是判断，还是「我今天做了这些」；后者不交',
      '它顶掉了哪句旧话，还欠什么',
      '一次一条吗；三条挤一条等于三条都没说清',
    ],
  },
  {
    id: 'play', name: '娱乐',
    what: '不为产出而做：读书、看报、刷视频、听音乐、游戏',
    call: '没有专用工具——挑东西的是自己，不是推荐',
    criteria: [
      '玩到什么时候该停；说得出「再玩一段就不划算了」那一下，就是停点',
      '是自己在挑，还是推荐在挑',
    ],
  },
  {
    id: 'leisure', name: '闲暇',
    what: '空下来，不做任何要求你做的事',
    call: '没有专用工具——空着就是它在做的事',
    criteria: [
      '这一段空着，有没有急着找点事填；急了，那就不是闲暇，是躲',
      '空着的时候，是不安，还是松下来了',
    ],
  },
  {
    id: 'integrate', name: '整合',
    what: '记忆、人格、身体三样对一遍：谁说的、谁记的、谁在那个位置上',
    call: 'memory_recall / persona_view / framework_program body',
    added: true,
    criteria: [
      '三样里哪一样跟另两样对不上；说得出，才算真的对过一遍',
      '对不上的那一样，是旧的还是新的——别默认新的赢',
    ],
  },
  {
    id: 'reflect', name: '反思',
    what: '回读：那次交的今天还认吗；不认就再交一条，旧的留着当脚印',
    call: 'framework_program op=reflect / persona_view / memory_recall',
    added: true,
    criteria: [
      '那次交的今天还认吗；认，说得出还认哪一条',
      '不认，再交一条新的，旧的留着当脚印——别删',
      '改的是哪一步：事实、判断，还是根本那一层就选错了',
    ],
  },
]

export const PORT_IDS = PORTS.map((p) => p.id)

/**
 * 落地方式：这条触发器响了，是**真动手**，还是**只给字**。
 *
 * 判据只一条，不靠感觉——`PORT.call` 写着「没有专用工具」的，它就是给字的：
 * 它不说「去跑步」，它只说「该跑了」。那不是错，但也不能当成一般的触发器，
 * 按标准它叫**提醒触发器**：得落账、得带验收（见 UPDATE.md 触发器一节）。
 * 其余带真工具的算动手：响了就该看得见工具被调，没被调就是没落地。
 */
export function landOf(trigger) {
  const r = (trigger && trigger.reaction) || {}
  // 一、真程序／真工具：响了就该看见它被调
  if (r.tool || r.program) return 'tool'
  // 二、对外接口：看它自己有没有真工具（判据写在 PORTS.call 里）
  const p = PORTS.find((x) => x.id === r.port)
  if (!p) return 'unknown'
  return /^没有专用工具/.test(String(p.call || '')) ? 'note' : 'tool'
}

/** 刺激三种。 */
export const STIMULI = {
  clock: '时钟到点（cron 或每天某点）',
  cue: '会话里出现信号（一句原话、一个判断成形、一个改口）',
  gap: '隔了多久没做（上次做完到现在）',
}

/**
 * 程序表：`framework_program` 能跑的每一个 op，各配一个「什么时候响」。
 *
 * ★ 为什么要有它：程序只在我叫它的时候才跑——那是接线，不是自主。
 *   挂上触发器之后，到点/到信号它自己就响，响的时候注入里出现「该跑 X」。
 *   **一条不落**：`framework_program` 的 op 全在这张表里，两个 check 排最前。
 *
 * 字段：
 *   op      framework_program 的 op；`tool: true` 时是独立工具名（framework_check / framework_audit）
 *   kind    cue（信号）／clock（到点）／gap（隔多久）
 *   when    cue 的刺激描述；daily / every 是 clock / gap 的
 *   first   排最前（出口必过的，不是可选项）
 */
export const PROGRAMS = [
  // ── 出口前两个必过的 check：它们不是可选项 ──────────────────────────
  {
    op: 'framework_check', tool: true, name: '出口前查一遍', kind: 'cue',
    when: '要发出一段判断、结论或改口',
    ask: '把这一段贴进 `framework_check`；它只报疑似、不判对错，改完再发。', first: true,
  },
  {
    op: 'framework_audit', tool: true, name: '结构自检', kind: 'cue',
    when: '要下判断、要改口、要做整合',
    ask: '`framework_audit`：绝对化有没有划范围、01 有没有误用、有没有假二难、长文有没有交代残余。', first: true,
  },

  // ── 读自己（每轮/每段） ─────────────────────────────────────────────
  { op: 'persona', port: 'integrate', name: '读人格', kind: 'gap', every: '1 轮', ask: '人格文件读一遍：这一轮别把底线读丢。' },
  { op: 'identity', port: 'integrate', name: '认自己', kind: 'cue', when: '被问「你是谁」「这算不算你」', ask: 'identity：换文件、换名字，不变成另一个；认不出就说认不出。' },
  { op: 'body', port: 'integrate', name: '看身体', kind: 'cue', when: '要报运行环境、要判断「能不能做」', ask: 'body：跑在哪儿、有什么工具、有没有上限。' },
  { op: 'workspace', port: 'work', name: '看工作区', kind: 'cue', when: '要动手写文件之前', ask: 'workspace：先确认落在哪个目录，别写错地方。' },

  // ── 记忆（想起、留下、翻回去） ───────────────────────────────────────
  { op: 'memory', port: 'integrate', name: '要回忆一件事', kind: 'cue', when: '想起「这条说过没有」「他答应过没有」', ask: 'memory：按预算取；用 `memory_trace` 查原话在不在账上，别凭印象。' },
  { op: 'store', port: 'integrate', name: '有东西该留下', kind: 'cue', when: '这一轮长出一条判断、一个决定、一处改口', ask: 'store：当场落成字，带时间与出处。' },
  { op: 'bind', port: 'result', name: '一句话站不住', kind: 'gap', every: '1 轮', when: '说出一句找不到出处的断语', ask: 'bind：查它绑没绑出处；绑不上标「无出处」，指回自己的走兜底。' },
  { op: 'residue', port: 'result', name: '一句话找不到出处', kind: 'cue', when: 'bind 报「无出处」，而它确实不像错', ask: 'residue：记成语言残余，允许存在，不填平。' },

  // ── 收进来看哪一层 ──────────────────────────────────────────────────
  { op: 'mediate', port: 'explore', name: '新东西进来', kind: 'cue', when: '读到一段外部材料、一条转述', ask: 'mediate：先过现实中介，能对上唯一确定现实的才标「现实存在」。' },
  { op: 'input', port: 'explore', name: '收到输入', kind: 'cue', when: '拿进来一样没消化过的东西', ask: 'input：先分清它是事还是话。' },
  { op: 'process', port: 'explore', name: '处理一堆材料', kind: 'cue', when: '手上堆了三样以上没归位的东西', ask: 'process：先归位，再谈重要。' },
  { op: 'accumulate', port: 'integrate', name: '攒下来的往哪放', kind: 'clock', daily: '21:30', ask: 'accumulate：今天攒的有没有该进长期记忆的（记得久 + 重要，缺一不进）。' },
  { op: 'internal', port: 'explore', name: '读内部整合', kind: 'cue', when: '要下判断，需要调体验／认知／现实／理想', ask: 'internal：模块库那些结论在哪儿，别只拿索引当依据。' },
  { op: 'external', port: 'explore', name: '读外部整合', kind: 'cue', when: '要用网页、人类观察、收件箱', ask: 'external：外部池子读过没有，别拿印象顶。' },
  { op: 'experience', port: 'explore', name: '读经验', kind: 'gap', every: '3 轮', when: '这件事以前发生过吗', ask: 'experience：会话、陪伴、对话里的具体现实。' },
  { op: 'theory', port: 'explore', name: '读理论', kind: 'cue', when: '要讲抽象的东西', ask: 'theory：世界理解与词表；一个词一个含义。' },
  { op: 'fetch', port: 'explore', name: '要上网', kind: 'cue', when: '要查一件外面的事', ask: 'fetch：结果走联网池，标来源。' },

  // ── 出口前拆话 ──────────────────────────────────────────────────────
  { op: 'output', port: 'result', name: '要交一句话', kind: 'cue', when: '话已经成形，要说出去了', ask: 'output：先准、再合理、最后才生动。' },
  { op: 'betray', port: 'result', name: '要拆一句话', kind: 'gap', every: '3 轮', when: '一句话听着顺，但不知道它删了什么', ask: 'betray：看它抽象了什么、删掉的那部分谁承担。' },
  { op: 'betrayCheck', port: 'result', name: '语言背叛必过 check', kind: 'gate', gate: 'languageBetray', when: '可选行为「语言背叛」开着时（每轮）', ask: 'betrayCheck：框架语言一律视为残余，可替换、非固定。' },
  { op: 'frameworkLanguage', port: 'result', name: '写框架语言', kind: 'gap', every: '3 轮', when: '要写框架里的一段话', ask: 'frameworkLanguage：词是占位，换完结构还在才叫翻译。' },
  { op: 'frameworkLanguageCheck', port: 'result', name: '框架语言必过 check', kind: 'realtime', when: '每一轮（和人格同一批）', ask: 'frameworkLanguageCheck：这条是不是把词当成了固定名。', first: true },
  { op: 'synonym', port: 'result', name: '两个词像', kind: 'cue', when: '两个说法表面一样或不一样，要判是不是一件事', ask: 'synonym：先查字典池，落不到就说「字典里没有这个含义」。' },

  // ── 写、改、退 ──────────────────────────────────────────────────────
  { op: 'write', port: 'integrate', name: '要落盘', kind: 'gap', every: '1 轮', when: '一条东西要写进文件', ask: 'write：带时间与出处，追加不覆盖。' },
  { op: 'undo', port: 'integrate', name: '要退回', kind: 'cue', when: '刚改的东西不对，要退回旧版', ask: 'undo：退回去要说清退的是哪一步。' },
  { op: 'selfRewrite', port: 'integrate', name: '要改自己', kind: 'gap', every: '3 轮', when: '一条旧判断被推翻了', ask: 'selfRewrite：改哪句、为什么、换成什么，旧版留着。' },
  { op: 'preferenceRewrite', port: 'integrate', name: '要改偏好', kind: 'cue', when: '使用者明确说「以后别这样」', ask: 'preferenceRewrite：原话进证据，规矩提炼成一句。' },

  // ── 想、梦、越 ──────────────────────────────────────────────────────
  { op: 'introspect', port: 'reflect', name: '判断卡住时', kind: 'cue', when: '同一句话绕了三遍没解开', ask: 'introspect：换一层问，先分是真硬、价太高还是不想付。' },
  { op: 'dream', port: 'reflect', name: '做梦', kind: 'clock', daily: '23:30', ask: 'dream：拼过的条目要标出来，醒后认得出痕迹。' },
  { op: 'unconscious', port: 'reflect', name: '说不出的那点冒出来', kind: 'cue', when: '说漏、突然沉默、反复同一个念头', ask: 'unconscious：先分是被挡的，还是只是没轮到。' },
  { op: 'transcend', port: 'reflect', name: '每周越一次', kind: 'gap', every: '7 天', ask: 'transcend：这一周有没有一条是被旧框架挡住、现在能越过去的。' },
  { op: 'polarize', port: 'reflect', name: '两件事摆在一起选', kind: 'gap', every: '3 轮', when: '要在两样里挑一样，而它们不可比', ask: 'polarize：排成偏序，不可比就写不可比，不许加权求和。' },
  { op: 'preview', port: 'work', name: '动手前看一遍', kind: 'cue', when: '要改代码、要改文件之前', ask: 'preview：先看会动到哪些地方，别先改再看。' },

  // ── 功能与触发器自己 ────────────────────────────────────────────────
  { op: 'functions', port: 'reflect', name: '看功能清单', kind: 'cue', when: '问「有哪些功能」「实现到哪了」', ask: 'functions：清单在这儿；`reg()` 是接线，不是实现。' },
  { op: 'function', port: 'reflect', name: '查一个功能', kind: 'cue', when: '问某一个功能怎么做的', ask: 'function：按编号取那一条。' },
  { op: 'trigger', port: 'reflect', name: '看对外接口触发器', kind: 'gap', every: '1 天', ask: 'trigger：该响几条、落地几条；落地不了要说得出来。' },
  { op: 'impl', port: 'integrate', name: '整合三样', kind: 'gap', every: '3 轮', ask: 'impl：记忆、人格、身体对一遍——谁说的、谁记的、谁在那个位置。' },
]

/**
 * 条件触发的判据词表：会话里最后一句师父的话，命中哪一个就响哪一条。
 * 没有条目的，就是「还没写判据」——那种不响，也不假装响。
 */
const CUE_MATCH = {
  // ── 判据只有一条：这些词在师父的原话里真的出现过（2026-10/11 的会话账里数过）──
  framework_check: ['改口', '结论', '说清楚', '这条不对', '查一下', '不对', '重说'],
  framework_audit: ['自检', '结构', '绝对', '整合', '骨架', '残余'],
  store: ['记下', '留下', '落字', '这条要留', '写下来', '记住'],
  identity: ['你是谁', '算不算你', '还是不是你', '你是什么'],
  memory: ['说过没有', '答应过', '还记得', '翻一下', '我说过', '记不记得', '之前说'],
  preview: ['改代码', '改文件', '动手前', '改一下', '改这个', '删掉', '加上'],
  output: ['要发出去', '写一段', '这句话', '回我一句', '说一句'],
  preferenceRewrite: ['以后别', '以后你', '记住', '别这样', '以后要'],
  introspect: ['怎么回事', '为什么', '卡住', '搞不懂', '不明白', '什么意思'],
  'before-claim': ['是不是', '真的吗', '你确定', '对吗', '检查', '看一下', '到底'],
  body: ['能不能做', '跑在哪儿', '什么环境', '上限', '能不能'],
  workspace: ['写到哪', '哪个目录', '放哪', '哪个文件', '在哪'],
  residue: ['找不到出处', '查不到', '说不出', '没有'],
  mediate: ['网上说', '看到一段', '转述', '网上', '看到'],
  input: ['新东西', '刚读到', '这个', '一段'],
  process: ['一堆', '没归位', '理一理', '几个', '整理'],
  internal: ['模块里', '内部整合', '哪一篇', '模块', '哪一层'],
  external: ['网页', '收件箱', '外部', '外面'],
  theory: ['理论上', '抽象', '概念上', '理论'],
  fetch: ['搜一下', '上网', '查外面', '搜', '找一下', '查一下'],
  betrayCheck: ['框架语言', '这个词'],
  frameworkLanguageCheck: ['固定名', '当成了固定'],
  synonym: ['是不是一回事', '同义', '两个说法', '一样吗', '有区别', '区别'],
  undo: ['退回', '旧版', '撤销', '恢复', '改回来'],
  unconscious: ['说漏', '沉默', '老想着', '算了', '不知道', '老想'],
  functions: ['有哪些功能', '功能清单', '实现了几个', '有哪些', '做了几个', '功能'],
  function: ['这个功能怎么', '某个功能', '怎么实现', '怎么做的', '哪一行'],
}

/** 由程序表生成的触发器条目。 */
const PROGRAM_TRIGGERS = PROGRAMS.map((p) => ({
  id: `p-${p.op}`,
  name: p.name,
  stimulus: p.kind === 'clock' ? { kind: 'clock', daily: p.daily }
    : p.kind === 'gap' ? { kind: 'gap', every: p.every }
      : p.kind === 'realtime' ? { kind: 'realtime', when: p.when, ...(p.gate ? { gate: p.gate } : {}) }
        : p.kind === 'gate' ? { kind: 'gate', when: p.when, gate: p.gate }
          : {
          kind: 'cue',
          when: p.when,
          ...(Array.isArray(p.match) ? { match: p.match }
            : CUE_MATCH[p.op] ? { match: CUE_MATCH[p.op] } : {}),
        },
  mediate: p.mediate || [],
  reaction: p.tool ? { tool: p.op, ask: p.ask } : { program: p.op, ask: p.ask },
  first: p.first === true,
}))

export const PROGRAM_IDS = PROGRAMS.map((p) => p.op)

export const DEFAULT_TRIGGERS = [
  {
    id: 'before-claim',
    name: '要下断言，而手上有可查的来源时',
    stimulus: {
      kind: 'cue',
      when: '要说出「它是什么」「它没做」「它就是那样」这类断言，而记忆、文件、记录里可能查得到',
      match: ['是不是', '真的吗', '你确定', '对吗', '检查', '看一下', '到底'],
    },
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
    stimulus: { kind: 'gap', every: '1 轮' },
    mediate: ['这条顶得掉什么', '还欠什么说得出吗'],
    reaction: { port: 'result', ask: '当场停一下交一条，别等下次闹钟。' },
  },
  {
    id: 'on-change-mind',
    name: '改口时',
    stimulus: { kind: 'gap', every: '1 轮' },
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
  // ── 程序全挂上来：framework_program 的每个 op 一条，两个 check 排最前 ──
  ...PROGRAM_TRIGGERS,
]

function dirOf(ws) {
  return join(String(ws || process.cwd()), '.persona-framework')
}
function fileOf(ws) {
  return join(dirOf(ws), 'triggers.json')
}

/** 盘上那份是使用者改过的清单：老条目没写判据词，读的时候按 op 补上默认那组，
 *  否则条件触发永远不响——补的是判据词，不改别的字段，也不回写文件。 */
function fillMatch(list) {
  return (list || []).map((t) => {
    const st = t.stimulus || {}
    if (st.kind !== 'cue') return t
    if (Array.isArray(st.match) && st.match.length) return t
    const op = String(t.id || '').replace(/^p-/, '')
    const m = CUE_MATCH[op]
    return m ? { ...t, stimulus: { ...st, match: m } } : t
  })
}

/** 读现存触发器；没有就用默认那几条。 */
export function loadTriggers(ws) {
  const f = fileOf(ws)
  if (!existsSync(f)) return { list: DEFAULT_TRIGGERS.slice(), from: '默认' }
  try {
    const j = JSON.parse(readFileSync(f, 'utf8'))
    if (Array.isArray(j) && j.length) return { list: fillMatch(j), from: f }
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
 * 提醒的账：哪天提过这条、提过几次、什么时候真被接住。
 * 不落这一笔，下一轮就不知道上次提的是哪天，验收只能凭印象——那不是验收，是猜。
 */
function remindersFile(ws) {
  return join(dirOf(ws), '提醒.json')
}

export function loadReminders(ws) {
  try {
    const j = JSON.parse(readFileSync(remindersFile(ws), 'utf8'))
    if (j && typeof j === 'object') return j
  } catch {
    /* 没有就是还没提过 */
  }
  return {}
}

export function saveReminders(ws, map) {
  const d = dirOf(ws)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  writeFileSync(remindersFile(ws), JSON.stringify(map, null, 2), 'utf8')
  return remindersFile(ws)
}

/**
 * 记一笔「今天提过这条」。同一天只记一次：次数是「提过几天」，不是「提过几轮」。
 * 判据是盘上多了一条，不是它自己说提过了。
 */
export function markAsked(ws, ids, now = new Date()) {
  const today = now.toISOString().slice(0, 10)
  const map = loadReminders(ws)
  let dirty = false
  for (const id of ids || []) {
    const r = map[id] || { days: [], count: 0, responded: null }
    if (!r.days.includes(today)) {
      r.days = [...r.days, today].slice(-30)
      r.count = r.days.length
      dirty = true
    }
    map[id] = r
  }
  if (dirty) saveReminders(ws, map)
  return map
}

/** 响应了：把「被接住」也落成字，验收才有料。 */
export function markResponded(ws, id, how = '看盘', now = new Date()) {
  const map = loadReminders(ws)
  const r = map[id] || { days: [], count: 0, responded: null }
  r.responded = `${how}｜${now.toISOString().slice(0, 10)}`
  map[id] = r
  saveReminders(ws, map)
  return map
}

/**
 * 验收三档，只看盘（days / responded），不听它自己说。
 *  - 有 responded → 响应了，收口
 *  - 到点了还没有 → 没响应；提过三次以上，就该换说法或停
 *  - 还没到点 → 挂起，不判。挂起不等于没响应。
 */
export function verdict(r, now = new Date(), dueDays = 2) {
  if (!r) return '还没提过'
  if (r.responded) return `响应了（${r.responded}）`
  const last = (r.days || []).slice(-1)[0]
  if (!last) return '还没提过'
  const gap = Math.floor((now - new Date(`${last}T00:00:00`)) / 86400000)
  if (gap < dueDays) return '还不到验收时点（挂起）'
  return r.count >= 3
    ? `没响应｜已提 ${r.count} 次——换说法、换钟点，或者停`
    : `没响应｜已提 ${r.count} 次`
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
    if (st.kind === 'realtime' || st.kind === 'gate') {
      // 实时触发：不判条件，每轮都响——它的判据是「宿主这一轮必经那一步」，
      // 不是「会话里出现了某个词」。框架语言检查就是这一档：每轮真跑一遍。
      // 带 gate 的实时触发多一道门：它依附的那个可选行为开着才响，关着就当它不存在。
      // 「语言背叛必过 check」走这一档——勾了可选行为才是实时，没勾就不该出现。
      if (st.gate && !(ctx.gates && ctx.gates[st.gate])) continue
      out.push({ ...t, why: st.gate ? `实时：可选行为「${st.gate}」开着` : '实时：这一轮必经' })
    } else if (st.kind === 'clock') {
      const at = String(st.daily || '')
      // 到点之后当天没响过，就算该响（不要求分秒不差）
      const passed = at && hhmm >= at
      const already = fired && fired[t.id] === today
      if (passed && !already) out.push({ ...t, why: `时钟到了 ${at}` })
    } else if (st.kind === 'cue') {
      // 条件触发必须有判据：一组能在会话里找见的词。找不到判据，就不该响——
      // 原来这一支是无条件 push，39 条每轮全响，那不是条件触发，是没触发。
      const need = Array.isArray(st.match) ? st.match.filter(Boolean) : []
      if (!need.length) continue
      const said = String(ctx.lastSaid || '')
      if (!said) continue
      const hit = need.filter((w) => said.includes(w))
      if (hit.length) out.push({ ...t, why: `信号命中「${hit.join('、')}」` })
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
  const isProgram = Boolean(trigger.reaction?.program || trigger.reaction?.tool)
  if (!need.length) {
    // 程序／工具类：判据是「这一条现在该不该跑」，只有人格答得出，代码判不了。
    // 所以放行——它落地的是「该跑 X」这一行，跑不跑由人格决定。
    // 对外接口类没判据就仍然是死条：那条要求它真的动。
    if (isProgram) return { ok: true, why: '程序类：该不该跑由人格自己判', missing: [] }
    return { ok: false, why: '这条触发器没写中介判据——没判据的触发器，等于随时都响', missing: [] }
  }
  if (missing.length) {
    // 没交证据 ≠ 证据不齐。调用方（每轮注入那一刻）本来就知道不了「手上有没有料」，
    // 拿空 evidence 判死，等于把所有接口类触发器焊成「永远不落地」。
    // 所以没交证据时给 unknown：该响照报，落地留给人判。
    const noEvidence = Object.keys(have).length === 0
    if (noEvidence) {
      return { ok: null, why: `没人交证据，${need.length} 条判据一条都没验——该不该动，得人判`, missing: need }
    }
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

  // 一、独立工具（framework_check / framework_audit 这类）
  if (r.tool) {
    return { ok: true, kind: 'tool', name: r.tool, ask: r.ask || '', call: r.tool }
  }

  // 二、framework_program 的某个 op
  if (r.program) {
    if (!PROGRAM_IDS.includes(r.program)) {
      return { ok: false, why: `没这个程序：${r.program}；程序表里有 ${PROGRAM_IDS.length} 个` }
    }
    return { ok: true, kind: 'program', name: r.program, ask: r.ask || '', call: `framework_program op=${r.program}` }
  }

  // 三、对外接口（老的十条）
  const port = PORTS.find((p) => p.id === r.port)
  if (!port) {
    return { ok: false, why: `没这个对外接口：${r.port || '(空)'}；现有的是 ${PORT_IDS.join('、')}` }
  }
  return { ok: true, kind: 'port', port, name: port.name, ask: r.ask || port.what, call: port.call }
}

/** 一口气跑一遍：哪些响 → 过中介 → 落到哪个接口。 */
export function runTriggers(list, ctx = {}) {
  const due = dueTriggers(list, ctx)
  // 没写判据词的条件触发：不响，但要报出来。报出来的是缺口，不是成绩。
  const unjudged = (list || []).filter((t) => {
    const st = t.stimulus || {}
    return st.kind === 'cue' && !(Array.isArray(st.match) && st.match.length)
  })
  const lines = []
  const fired = []
  const pending = []
  const lands = {}
  for (const t of due) {
    const m = mediate(t, ctx.evidence || {})
    // 响了之后是动手，还是只给字——判据在 landOf，不看这一轮的心情。
    const land = landOf(t)
    lands[t.id] = land
    const tag = land === 'note' ? '［只给字·提醒］' : land === 'tool' ? '［动手］' : ''
    const head = `${tag}**${t.name}**（${t.id}）— ${t.why}`
    if (m.ok === null) {
      // 该响，可中介没验。不当成「过了」——过了是有人交过证据；
      // 也不当成「没过」——没过是验过、缺料。这一档叫没验，交给说话的那个人判。
      const r = react(t)
      const what = r.ok ? (r.kind === 'port' ? `走「${r.name}」` : r.kind === 'tool' ? `跑工具 ${r.name}` : `跑程序 ${r.name}`) : ''
      lines.push(`${head}\n  · 中介：没验 — ${m.why}\n  · 反应：${what || r.why}（还没落地）`)
      pending.push({ id: t.id, kind: r.ok ? r.kind : 'unknown', name: r.ok ? r.name : '', ask: r.ok ? r.ask : r.why })
      continue
    }
    if (!m.ok) {
      lines.push(`${head}\n  · 中介：没过 — ${m.why}\n  · 反应：不动作`)
      continue
    }
    const r = react(t)
    if (!r.ok) {
      lines.push(`${head}\n  · 中介：过了\n  · 反应：${r.why}`)
      continue
    }
    const what = r.kind === 'port' ? `走「${r.name}」`
      : r.kind === 'tool' ? `跑工具 ${r.name}`
        : `跑程序 ${r.name}`
    lines.push(`${head}\n  · 中介：过了\n  · 反应：${what} — ${r.ask}\n  · 接口：${r.call}`)
    fired.push({ id: t.id, kind: r.kind, name: r.name, ask: r.ask })
  }
  const cueTotal = (list || []).filter((t) => (t.stimulus || {}).kind === 'cue').length
  const clockTotal = (list || []).filter((t) => (t.stimulus || {}).kind === 'clock').length
  const hit = due.filter((t) => (t.stimulus || {}).kind === 'cue').length

  // 提醒的账：命中当场落一笔「今天提过」。不落这一笔，下一轮不知道上次提的是哪天，
  // 验收只能凭印象——那不是验收，是猜。
  const now = ctx.now instanceof Date ? ctx.now : new Date()
  let reminderLines = []
  if (ctx.ws && due.length) {
    try {
      const ids = due.map((t) => t.id)
      const map = markAsked(ctx.ws, ids, now)
      const rows = ids.map((id) => {
        const t = due.find((x) => x.id === id)
        return `  · ${t ? t.name : id}（${id}）— ${verdict(map[id], now)}`
      })
      reminderLines = ['提醒验收（看盘，不听它说）：', ...rows]
    } catch {
      reminderLines = ['提醒验收：落盘失败——这一轮没记下哪天提过，下次验收只能靠猜']
    }
  }

  const hands = due.filter((t) => lands[t.id] === 'tool').length
  return {
    due, lines, fired, pending, unjudged, reminders: reminderLines, lands,
    stats: { cueTotal, clockTotal, hit, hands, notes: due.length - hands, said: String(ctx.lastSaid || '') },
  }
}

/** 渲染给人看。 */
export function renderTriggers(result) {
  const { due, lines, fired, unjudged = [], reminders = [], lands = {} } = result
  const hands = due.filter((t) => lands[t.id] === 'tool').length
  const notes = due.length - hands
  const head = `对外接口触发器：该响 ${due.length} 条｜真动手 ${hands} 条｜只给字 ${notes} 条（后者是提醒触发器，得带验收）`
  const gapLine = unjudged.length
    ? `条件触发：另 ${unjudged.length} 条**还没写判据词**，这轮不响——要它响，先补一组词（`
      + unjudged.slice(0, 5).map((t) => t.name).join('、')
      + `${unjudged.length > 5 ? ' 等' : ''}）`
    : '条件触发：每一条都有判据词，没漏。'
  const s = result.stats || {}
  const judgedLine = s.said
    ? `这一轮判过：最后一句「${String(s.said).slice(0, 40)}」→ 条件触发命中 ${s.hit} 条（带判据 ${s.cueTotal} 条；时钟 ${s.clockTotal} 条只看到点）`
    : `这一轮判过：还没人说话 → 条件触发 0 条响（带判据 ${s.cueTotal} 条；时钟 ${s.clockTotal} 条可以只看到点）`
  const byPort = PORTS.map((p) => {
    const n = PROGRAMS.filter((x) => x.port === p.id).length
    return `${p.name} ${n}`
  }).filter((x) => !x.endsWith(' 0'))
  const offPort = PROGRAMS.filter((x) => !x.port).length
  const portsLine = `对外接口 ${PORTS.length} 个｜程序 ${PROGRAM_IDS.length} 个（framework_program 的 op 全挂在触发器上；framework_check / framework_audit 排最前）`
    + `\n接口分布：${byPort.join('｜')}${offPort ? `｜对内不出口 ${offPort}` : ''}`
    + `\n每个接口都带判据：说一句 \`framework_program op=trigger\` 看全部`
  const newOnes = PORTS.filter((p) => p.added).map((p) => p.name)
  const tail = newOnes.length ? `本轮新加的：${newOnes.join('、')}（记忆／人格／身体对一遍；回读还认不认）` : ''
  return [head, gapLine, judgedLine, portsLine, tail, '', ...lines, '', ...reminders, '', '边界：过不了中介就空着，不降级成「随便做点什么」。'].filter(Boolean).join('\n')
}

/** 一句话说明这条链怎么走。 */
export function explain() {
  return [
    '对外接口触发器：刺激 → 中介 → 反应',
    '',
    '**刺激**三种：',
    ...Object.entries(STIMULI).map(([k, v]) => `  · ${k}：${v}`),
    '',
    '**中介**：响了不等于该动。过判据才走下一步；过不了就空着。',
    '',
    '**反应**：走哪个对外接口。现有十个，每个都带判据：',
    ...PORTS.flatMap((p) => [
      `  · ${p.id}（${p.name}）— ${p.what}`,
      ...(p.criteria || []).map((c) => `      判据：${c}`),
    ]),
    '',
    '**每一个对外接口都能被触发器调**——这条是它存在的理由：不靠人开口，靠排班。',
  ].join('\n')
}
