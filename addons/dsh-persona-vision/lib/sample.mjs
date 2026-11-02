/**
 * 挑帧：两张指纹差多少、这一串帧里哪几张值得留。
 *
 * 这个文件是整个包唯一带判据的地方，所以它必须是纯函数：
 * 不读盘、不联网、不看时钟。给数组就给结果，好测、好复现。
 *
 * 指纹是 32×18 的均值灰度，长度 576，值域 0..255（整数），
 * 由 capture.mjs 在 PowerShell 那一趟里顺手降采样出来。
 * 这里只管比，不管图。
 */

/** 指纹长度。SPEC 钉死的数，别在这里偷偷改成从数据推。 */
export const FP_LEN = 576

/**
 * 两张指纹差多少：逐格 |差| 的均值 / 255，落到 0..1。
 *
 * 为什么除 255：不除的话这个数跟着位深走，阈值就没法跨机器写死。
 * 除完 0.003 大约等于「平均每格差不到一格灰度」——低于它的，多半是噪声。
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} 0..1
 * @throws 长度不一致 / 不是数组 / 有格不是数
 */
export function diffScore(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) {
    throw new Error('diffScore 要两张指纹数组，拿到的是别的东西')
  }
  if (a.length !== b.length) {
    throw new Error(`diffScore 长度不一致：${a.length} vs ${b.length}，不是同一批指纹，比不了`)
  }
  if (a.length === 0) {
    throw new Error('diffScore 拿到空指纹，比不了')
  }
  let sum = 0
  for (let i = 0; i < a.length; i += 1) {
    const x = Number(a[i])
    const y = Number(b[i])
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`diffScore 指纹第 ${i} 格不是数（${a[i]} / ${b[i]}）`)
    }
    sum += Math.abs(x - y)
  }
  return sum / a.length / 255
}

/**
 * 从一串帧里挑值得看的。
 *
 * 规则（照 SPEC 写死，别散到别处去）：
 *   1. 第一帧永远进 kept——它是基准，没有它后面的百分比无从谈起。
 *   2. 相邻两帧 diffScore > threshold 才算「变了」，变了的帧进 kept。
 *   3. kept 最多 maxFrames 张；超了按「差异大的优先」留，不是按时间。
 *      留完仍按时间排回来——拼图要读得顺，不能按差异大小乱序摆。
 *   4. 一帧没变：kept 只剩第一帧，changedRatio = 0。
 *
 * @param {Array<{fp:number[], at?:any, path?:string}>} fps
 * @param {{threshold?:number, maxFrames?:number}} opts
 * @returns {{kept:Array, dropped:number, changedRatio:number}}
 */
export function pickFrames(fps, opts = {}) {
  if (!Array.isArray(fps)) {
    throw new Error('pickFrames 要一个帧数组，拿到的是别的东西')
  }
  const threshold = Number(opts.threshold ?? 0.003)
  const maxFrames = Number(opts.maxFrames ?? 6)
  if (!Number.isFinite(threshold)) {
    throw new Error(`pickFrames 的 threshold 不是数：${opts.threshold}`)
  }
  if (!Number.isFinite(maxFrames) || maxFrames < 1) {
    throw new Error(`pickFrames 的 maxFrames 要是至少 1 的整数：${opts.maxFrames}`)
  }
  const cap = Math.max(1, Math.floor(maxFrames))

  if (!fps.length) return { kept: [], dropped: 0, changedRatio: 0 }

  // 相邻两帧先比一遍，变了的连差异一起记下来——差异大小后面挑帧要用。
  const changed = []
  for (let i = 1; i < fps.length; i += 1) {
    const score = diffScore(fps[i - 1].fp, fps[i].fp)
    if (score > threshold) changed.push({ index: i, frame: fps[i], score })
  }

  let picked = changed
  if (changed.length > cap - 1) {
    picked = changed
      .slice()
      .sort((x, y) => y.score - x.score)
      .slice(0, cap - 1)
  }

  const kept = [fps[0], ...picked.slice().sort((x, y) => x.index - y.index).map((x) => x.frame)]

  // 「变了多少」= 变了的帧数 / 相邻对总数。它量的是这段屏幕动没动，
  // 不是 maxFrames 这个预算裁掉了多少——裁掉的帧也还是变过的。
  const pairs = fps.length - 1
  const changedRatio = pairs > 0 ? changed.length / pairs : 0

  return { kept, dropped: fps.length - kept.length, changedRatio }
}
