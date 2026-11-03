/**
 * 写入门禁：按层分严格度。
 *
 * 抄自 灵枢 `md_cg/writegate.py`（282 行 · 2026-11-03 读），只留判据，不留它那套蜂群。
 * 它的原话是「记忆写入要有，但得经过复核；自我人格的偏移、失忆，是毁灭性的」。
 *
 * 按师父的话改了一处：**人格层不经过人**。自己的人格自己负责，但要过反思和验证两道。
 *
 * 四档（数字越大越严）：
 *   0 情景层  session/ 流水、待办、被证伪的假设——丢了不毁灭，随便写
 *   1 知识层  chat/ 判断、web/ 见闻、modules 之外的笔记——跨会话复用，要先想一遍
 *   2 结构层  modules/ 模块库、.persona-framework/ 框架状态——规则和判据面，要想 + 验
 *   3 自我层  characters/ 人格文件、growth/人格补丁——身份，要想 + 验，出了偏差是毁灭性的
 *
 * 三态：allow / require_review / deny。
 * 判据不是「写不写得了」（那是权限），是「写之前该过的程序过没过」。
 */

/** 层名 → 严格度。 */
export const LAYER_TIERS = {
  contextual: 0, // 流水、待办、负记忆
  knowledge: 1, // 判断、见闻、词表
  structural: 2, // 模块库、框架状态
  self: 3, // 人格文件、人格补丁
}

/** 路径前缀 → 层。顺序有讲究：先匹配到的赢，所以长前缀放前面。 */
const PATTERNS = [
  ['persona-ai/characters/', 'self'],
  ['persona-ai/growth/人格补丁', 'self'],
  ['.persona-framework/', 'structural'],
  ['persona-ai/modules/', 'structural'],
  ['persona-ai/knowledge/session/', 'contextual'],
  ['persona-ai/knowledge/', 'knowledge'],
  ['persona-ai/knowledge', 'knowledge'],
]

/** 每档必须过的复核。 */
export const REQUIRED_REVIEWERS = {
  0: [],
  1: ['reflect'],
  2: ['reflect', 'verify'],
  3: ['reflect', 'verify'], // 原版这里是 ['reflect','verify','human']——按师父的话去掉了 human
}

/**
 * 这条路径该算哪一层。
 * @param {string} path 相对工作区根，或绝对路径（都行，只认里面出现的前缀）
 * @returns {'contextual'|'knowledge'|'structural'|'self'|'unknown'}
 */
export function layerOf(path) {
  const p = String(path ?? '').replace(/\\/g, '/')
  for (const [prefix, layer] of PATTERNS) {
    if (p.includes(prefix)) return layer
  }
  return 'unknown'
}

/** 这一层要求几档复核。 */
export function tierOf(layer) {
  return LAYER_TIERS[layer] ?? null
}

/**
 * 判一次写入。
 *
 * @param {object} opts
 * @param {string} opts.path 要写的目标路径
 * @param {string[]} [opts.reviewers] 这次写入实际做了哪些复核（'reflect' / 'verify' / 'human'）
 * @returns {{decision:'allow'|'require_review'|'deny', layer:string, tier:number|null, missing:string[], reason:string}}
 */
export function decideWrite({ path, reviewers = [] } = {}) {
  const layer = layerOf(path)
  const tier = tierOf(layer)

  if (tier === null) {
    // 认不出的路径不猜层。让它过，但说清楚：这条没被门禁管。
    return {
      decision: 'allow',
      layer,
      tier: null,
      missing: [],
      reason: `认不出这一层（${path}），门禁没管它`,
    }
  }

  const need = REQUIRED_REVIEWERS[tier] ?? []
  const missing = need.filter((r) => !reviewers.includes(r))

  if (!missing.length) {
    return { decision: 'allow', layer, tier, missing: [], reason: `第 ${tier} 档复核齐了` }
  }

  // 情景层缺什么都不挡——它就是「现场记录」，丢了不毁灭。
  if (tier === 0) {
    return { decision: 'allow', layer, tier, missing, reason: '情景层，不要求复核' }
  }

  // 第 1 档只缺 reflect：让写，但记下来「这篇没先想过」。
  if (tier === 1 && missing.length === 1 && missing[0] === 'reflect') {
    return {
      decision: 'require_review',
      layer,
      tier,
      missing,
      reason: '知识层没先反思过：要么补一次，要么明确记下这次是直写',
    }
  }

  return {
    decision: 'deny',
    layer,
    tier,
    missing,
    reason: `第 ${tier} 档要求 ${need.join(' + ')}，缺 ${missing.join('、')}`,
  }
}

/** 把判定翻成一行给人看的话。 */
export function explain(verdict) {
  const tag = verdict.decision === 'allow' ? '放行' : verdict.decision === 'require_review' ? '要补复核' : '挡下'
  return `${tag}｜${verdict.layer}（第 ${verdict.tier ?? '?'} 档）｜${verdict.reason}`
}
