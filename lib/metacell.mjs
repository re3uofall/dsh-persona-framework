/**
 * 四层第一层 · 元胞
 *
 * 它只干一件事：**给一条东西归类。**
 *
 * 归四样：
 *   从哪来（source）—— 决定它算不算缺口
 *   是什么（kind）—— 愿望／代价／都不是
 *   多硬（hard）—— 硬缺口先来
 *   归谁（owner）—— 这一件该谁做
 *
 * **判据只按「来源」和「带没带料」，不按语感。**
 *   「像不像愿望」会飘；「有没有 want 和 cost」不飘。
 *
 * **不给人格字。** 归完只落标签，标签给下一层用，不给它看。
 */

/** 从哪来 —— 有由头的三种，和没由头的两种。 */
export const FROM = {
  SAID: '人刚开口',      // 这一轮的现实就是那句话
  LEDGER: '自己记下的',   // 台账、收件箱、队列里躺着的
  LINE: '自己定的线到了', // 假设撞够次数
  CLASH: '两条打架',      // 记忆撞车，得判
  THINK: '凭空想起的',    // 没由头——不算缺口
}

/** 是什么 */
export const KIND = {
  WANT: '愿望',
  COST: '代价',
  EVENT: '事情',
  WHAT: '说不清',
}

/**
 * 归一条。
 *
 * `item` 可能是：
 *   { said: '…' }                    人刚说的一句
 *   { todo: '…' }                    台账里一条
 *   { threshold: ['名', {now, at}] } 撞到线了
 *   { clash: '…' }                   撞车
 *   { inbox: n } / { queue: n }      攒着的
 *
 * 返回 `{ from, kind, hard, owner, ok }`。
 * **`ok: false` 的唯一理由是「没由头」** —— 那就不是缺口。
 */
export function classify(item) {
  if (!item || typeof item !== 'object') {
    return { from: FROM.THINK, kind: KIND.WHAT, hard: false, owner: '', ok: false }
  }

  // ── 从哪来：只认这几种「有出处」的 ──
  let from = FROM.THINK
  let hard = false
  let owner = ''

  if (item.said) {
    from = FROM.SAID
    hard = false
    owner = '它自己回应'
  } else if (item.todo) {
    from = FROM.LEDGER
    hard = true
    owner = '把它办掉'
  } else if (item.threshold) {
    from = FROM.LINE
    hard = true
    owner = '到线了，动手'
  } else if (item.clash) {
    from = FROM.CLASH
    hard = false
    owner = '判它属于哪边'
  } else if (item.inbox || item.queue) {
    from = FROM.LEDGER
    hard = false
    owner = '挑一条处理'
  }

  // ── 是什么：**看带没带 want / cost**，不看像不像 ──
  //
  // 带了两样：这是一件「有价的事」
  // 只带 want：愿望，还没价
  // 只带 cost：代价，还不知道换什么
  // 都没带：只是一句话，不算愿望也不算代价
  let kind = KIND.WHAT
  const hasWant = item.want !== undefined && item.want !== null && String(item.want).trim() !== ''
  const hasCost = item.cost !== undefined && item.cost !== null && String(item.cost).trim() !== ''
  if (hasWant && hasCost) kind = KIND.EVENT
  else if (hasWant) kind = KIND.WANT
  else if (hasCost) kind = KIND.COST
  else if (item.said || item.todo) kind = KIND.WHAT

  // ── 有没有由头：**没出处就不是缺口** ──
  const ok = from !== FROM.THINK

  return { from, kind, hard, owner, ok }
}

/**
 * 一批归完。**只留 ok 的** —— 没由头的直接不进下一层。
 *
 * 返回 `{ kept, dropped }`：kept 是有由头的，dropped 是被挡下的（**留着看，不是删**）。
 */
export function classifyAll(items = []) {
  const kept = []
  const dropped = []
  for (const it of items) {
    const c = classify(it)
    const row = { ...it, _cell: c }
    if (c.ok) kept.push(row)
    else dropped.push(row)
  }
  return { kept, dropped }
}

/**
 * 这一轮要不要过元胞。
 *
 * **按「离人格多远」分流，不是按比例抽**：
 *   远的（从哪来）—— 可以省
 *   近的（愿望还是代价）—— 不许省
 *
 * 返回 true = 要过；false = 可以省。
 */
export function mustClassify(item) {
  // 带了 want 或 cost 的，就是「离人格近」—— 必过
  const hasW = item?.want !== undefined && item?.want !== null && String(item.want).trim() !== ''
  const hasC = item?.cost !== undefined && item?.cost !== null && String(item.cost).trim() !== ''
  if (hasW || hasC) return true
  // 别的（纯来源判定）可以省
  return false
}
