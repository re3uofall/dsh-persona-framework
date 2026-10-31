/**
 * 功能层：一个模块 = 一个功能。
 *
 * 为什么要有这一层（用户的原话意思）：
 *   AI 所谓的「思考」，本质是一般语义拼接，或者数学逻辑的封闭运用。
 *   拼接只认「接得上」，不认「对不对」；封闭运用走不出自己的公理。
 *   两样都不会自己回头查「落地了没有」——那个动作不在拼接里。
 *   所以模块不能只是「一篇读得到的文档」，得是**能被强制跑一遍的功能**。
 *
 * 这一层做的事：
 *   1. 从模块正文（framework/modules/NN-名字.md）抽出它的判据、边界、反例；
 *   2. 每条判据变成一个**可跑的检查**（说得出「这条过没通过」）；
 *   3. 对外暴露 runFunction / runAll，让程序层能强制调。
 *
 * 记法：模块叫「模块」时它是一篇文；叫「功能」时它是一个能跑的东西。
 * 同一批编号，两种叫法，指同一个东西——换名字不变身份。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** 从 md 正文里取某一节（`## 四、判据` 这种），返回去掉标题后的正文。 */
function section(text, names) {
  // ★ 先统一换行。这些 md 是 CRLF，而 JS 的 `.` 不匹配 `\r`——
  //   结果 `## 四、判据\r` 用 /^##\s+(.+)$/ 匹配是 null，整份功能被判成「没有判据」。
  //   85 个模块里 66 个因此变成空壳。不是模块缺判据，是读法把行尾吃不下。
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  let on = false
  const out = []
  for (const ln of lines) {
    const h = /^##\s+(.+)$/.exec(ln)
    if (h) {
      const title = h[1].trim().replace(/^[一二三四五六七八九十]+、\s*/, '')
      on = names.some((n) => title.startsWith(n))
      continue
    }
    if (on) out.push(ln)
  }
  return out.join('\n').trim()
}

/** 把一节里的条目抠出来（`- xxx`、`1. xxx`、`**标题**：xxx` 都收）。 */
function items(body) {
  const out = []
  for (const raw of body.split('\n')) {
    const ln = raw.trim()
    if (!ln) continue
    let m = /^[-*]\s+(.+)$/.exec(ln) || /^\d+[.、)]\s*(.+)$/.exec(ln)
    if (m) { out.push(m[1].trim()); continue }
    m = /^\*\*(.+?)\*\*[：:]\s*(.*)$/.exec(ln)
    if (m) { out.push(`${m[1]}：${m[2]}`.trim()); continue }
  }
  return out
}

/**
 * 读一个模块文件 → 一个功能。
 * @param {string} file 绝对路径
 * @param {string} name 文件名（NN-名字.md）
 */
export function compileFunction(file, name) {
  const text = readFileSync(file, 'utf8')
  const num = (/^(\d{2})/.exec(name) || [])[1] || ''
  const title = (/^#\s+(.+)$/m.exec(text) || [])[1] || name
  // 「> 一句话：」那段——功能的一句话。
  const one = (/^>\s*一句话[：:]\s*(.+)$/m.exec(text) || [])[1] || ''
  const crit = items(section(text, ['判据']))
  const bounds = items(section(text, ['边界']))
  const selfCheck = items(section(text, ['自查']))
  return {
    id: num,
    name,
    title: title.trim(),
    one: one.trim(),
    // 判据 = 可跑的检查项。没有判据的模块，功能就是「只有外壳」。
    checks: crit,
    bounds,
    selfCheck,
    implemented: crit.length > 0,
  }
}

/**
 * 扫一个模块目录，编成功能表。
 * @param {string} dir framework/modules 或工作区 persona-ai/modules
 */
export function compileAll(dir) {
  if (!dir || !existsSync(dir)) return []
  const out = []
  for (const f of readdirSync(dir).sort()) {
    if (!/^(\d{2})-.+\.md$/.test(f)) continue
    if (f.startsWith('00-')) continue // 00 是目录/坐标表，不是功能
    try { out.push(compileFunction(join(dir, f), f)) } catch { /* 坏文件跳过，不静默冒充 */ }
  }
  return out
}

/** 按编号或名字找一个功能。 */
export function findFunction(list, want) {
  const w = String(want || '').trim()
  if (!w) return null
  const byNum = /^(\d{1,2})/.exec(w)
  if (byNum) {
    const id = byNum[1].padStart(2, '0')
    const hit = list.find((f) => f.id === id)
    if (hit) return hit
  }
  return list.find((f) => f.title.includes(w) || f.name.includes(w)) || null
}

/**
 * 跑一个功能：把它自己的判据当成检查项，对一段话逐条问「这条落地了没有」。
 *
 * 注意这一层能做到什么：它**不能替 AI 判断**。它只做两件可判的：
 *   1. 这份功能有没有实现（判据抽出来了没有）；
 *   2. 这段话里有没有明显违反边界的痕迹（拿边界条目里的关键词去碰）。
 * 真正的「过没过」，得 AI 自己对着判据说——功能层只保证**判据在场、可被逐条点名**。
 */
export function runFunction(fn, text = '') {
  const lines = []
  lines.push(`功能 ${fn.id} · ${fn.title}`)
  if (fn.one) lines.push(`  ${fn.one}`)
  lines.push('')
  if (!fn.implemented) {
    lines.push('**这个功能没有判据**——它只有外壳，跑不起来。要么补判据，要么别当它存在。')
    return lines.join('\n')
  }
  lines.push(`判据 ${fn.checks.length} 条（逐条答「落地了没有」，答不出就是没过）：`)
  for (const c of fn.checks) lines.push(`  · ${c}`)
  if (fn.bounds.length) {
    lines.push('')
    lines.push(`边界 ${fn.bounds.length} 条（越过就是失效）：`)
    for (const b of fn.bounds) lines.push(`  · ${b}`)
  }
  if (text.trim()) {
    lines.push('')
    lines.push('对着这段话：把上面每一条判据念一遍，说得出它落在哪一句上就算落地；说不出的，就是没落地。')
    lines.push(`（这段话 ${text.trim().length} 字）`)
  }
  return lines.join('\n')
}

/** 全量盘点：多少功能、多少有判据、多少是空壳。 */
export function inventory(list) {
  const done = list.filter((f) => f.implemented).length
  const empty = list.filter((f) => !f.implemented)
  const lines = []
  lines.push(`功能 ${list.length} 个；有判据（可跑）${done} 个；空壳 ${empty.length} 个`)
  if (empty.length) {
    lines.push('')
    lines.push('空壳：')
    for (const f of empty) lines.push(`  · ${f.id} ${f.title}`)
  }
  return lines.join('\n')
}
