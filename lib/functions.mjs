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

// ── 能程序化的判据 ────────────────────────────────────────────────────────────
//
// 功能层不是「把判据列出来」就完事——那样它还是文档。这里放的是**能对着一段话真跑的检查**。
// 一条一条加，不加到齐为止：能判的判，判不了的明说「靠人判」，别假装程序知道。

/**
 * 22 · 残余
 *
 * 判据原文五条，能落成程序的是三条：
 *   1「说得出漏了什么吗」→ 有没有**具体的**一处漏，而不是「有点怪」
 *   4「这个残余是谁在承担」→ 有没有指认承担者
 *   5「是不是把它当成了缺陷」→ 有没有一出现残余就急着「修／消灭」
 *
 * 判不了的（第 2、3 条：抹平、违和感还在不在）明说靠人判，不装。
 */
function assert22(text) {
  const t = String(text || '')
  const items = []
  const has = (re) => re.test(t)

  // 注意：承认残余的说法要收全。第一版只写了「处理不掉」，漏了「没处理掉」——
  // 同一个意思反过来排，词表就接不住。程序化的检查最常见的漏就是这种，别只测一种语序。
  const admits = has(/(残余|漏了|漏掉|还欠|欠着|不知道|说不清|没落地|没走到|未处理|处理不掉|没处理掉|处理不完|留着一处|悬着|留着不修)/)
  items.push({
    check: '说得出漏了什么吗',
    ok: admits,
    why: admits ? '有承认残余的话' : '整段没有一处承认「有东西没处理掉」——不是没有，是没写',
  })

  const vague = has(/(有点怪|不太对|感觉怪|说不上来)/) && !has(/(哪一|具体|第\s*\d|那一(句|节|条|块)|在.{1,12}这一步)/)
  items.push({
    check: '那一处具体吗',
    ok: !vague,
    why: vague ? '只有「有点怪」这类话，指不出具体哪一块' : '没拿含糊话糊过去',
  })

  const bearer = has(/(谁承担|承担者|落到.{1,8}头上|代价.{0,6}(谁|落在)|我|你|他|她|用户|使用者)/)
  items.push({
    check: '这个残余是谁在承担',
    ok: bearer,
    why: bearer ? '指到了承担的人或位置' : '没说这块残余最后落在谁头上',
  })

  const rushFix = has(/(修好|消灭|彻底解决|填平|抹掉|盖住|当作错误|当成缺陷)/)
  items.push({
    check: '是不是把它当成了缺陷',
    ok: !rushFix,
    why: rushFix ? '出现了「修／消灭／填平」这类动作——残余要留，不急着修' : '没有急着把残余消灭掉',
  })

  return {
    items,
    unprogammed: ['有没有用更大的框架抹平', '违和感还在吗'],
  }
}

/**
 * 84 · 信息
 *
 * 判据原文五条，能落成程序的是四条：
 *   1「分得清这一句在说哪一格」→ 有没有把两格混成一句（用「显然／本来就是」直接下结论，而没碰过它）
 *   2「说得出凭什么直接」→ 有没有至少一处「碰到过」的痕迹（读到、查到、文件、行号、链接、日期）
 *   3「认不出时说认不出」→ 有没有把「认不出」说成「不存在／是假的」
 *   4「残余留得下」→ 有没有「全收到了／都懂了／没有遗漏」这种话
 * 判不了的（第 5 条：主客观对不上先查哪一头）明说靠人判。
 */
function assert84(text) {
  const t = String(text || '')
  const items = []
  const has = (re) => re.test(t)

  // 碰过它的痕迹：读到、查到、看见、文件、行号、链接、日期、数字
  const touched = has(/(读到|查到|看见|试过|跑过|打开|翻到|文件|第\s*\d+\s*行|https?:\/\/|\d{4}-\d{1,2}-\d{1,2}|「[^」]{2,}」)/)

  // 1 混格：用「显然／本来就是／不用问」直接下结论，而全文没有一处碰过的痕迹
  const assume = has(/(显然|本来就是|不用问|肯定是|必然是|毫无疑问)/)
  items.push({
    check: '分得清这一句在说哪一格',
    ok: !(assume && !touched),
    why: assume && !touched
      ? '有「显然／本来就是」这类直接下的结论，全文却没有一处「碰到过它」的痕迹——这是拿主观格冒充客观格'
      : '没有用「显然」跳过去',
  })

  // 2 说得出凭什么直接
  items.push({
    check: '说得出凭什么直接',
    ok: touched,
    why: touched ? '有碰到过的痕迹（读到／文件／行号／链接／日期）' : '一处都没有：不是在说「我认出来的」，是在说「它本来就这样」',
  })

  // 3 认不出不判成不存在
  const denyByDefault = has(/(不存在|是假的|根本没有|纯属虚构|完全不可能)/) && !has(/(认不出|没认出来|读不出|缺.{0,6}结构|看不出来)/)
  items.push({
    check: '认不出时说「认不出」',
    ok: !denyByDefault,
    why: denyByDefault
      ? '出现了「不存在／是假的」，但没有一处「认不出」——认不出不等于不存在，这一条越界了'
      : '没拿「不存在」替「认不出」',
  })

  // 4 残余留得下
  const allDone = has(/(全收到了|全都收到|都懂了|全部掌握|没有遗漏|一点不漏|完全理解)/)
  items.push({
    check: '残余留得下',
    ok: !allDone,
    why: allDone ? '出现了「全收到了／都懂了」——说全收到，就是没认' : '没有把「全收到了」说出口',
  })

  return {
    items,
    unprogammed: ['主客观对不上时，先查主观那一头'],
  }
}

/**
 * 85 · 能量
 *
 * 判据原文五条，能落成程序的是三条：
 *   1「分得清这一句在说哪一格」→ 有没有把「还剩多少」（客观格）和「够不够顶住」（主观格）混成一句
 *   2「说得出客观格还剩多少」→ 有读数（数字／百分比）或明说「读不到」；只有「还行／差不多」算没看
 *   4「分得开「补」与「调」」→ 同一句里既说吃了又说睡了，两样都占，就是混了
 * 判不了的（第 3、5 条：主观格顶不顶得住、什么沉下来了）明说靠人判。
 */
function assert85(text) {
  const t = String(text || '')
  const items = []
  const has = (re) => re.test(t)

  // 客观格：有读数（数字/百分比/余额）或明说读不到
  const reading = has(/(\d+\s*%|\d+\s*(k|m|万|千|token|次|小时)|剩\s*\d|余额|还剩\s*\d|读不到|读不出|看不到余额|不知道多少)/)
  // 含糊其辞
  const vague = has(/(还行|差不多|够用|应该够|感觉够|大概够)/) && !reading
  items.push({
    check: '说得出客观格还剩多少',
    ok: reading,
    why: reading
      ? '给了读数，或者明说读不到'
      : (vague ? '只有「还行／差不多／够用」这类话——含糊其辞算没看' : '没有任何读数，也没说读不到'),
  })

  // 补与调：同一句里两样都占。
  // ★ 先剔掉否定式——「这次是补，不是调」里也有「调」字，直接查字会把它判成两样都占。
  //   这类错是程序化检查的常客：字面命中不等于主张成立。
  // 词表别收单字。「清」会把「说不清」吃掉，「调」会把「不是调」吃掉——
  // 程序化检查最常见的两个坑：否定式没剔、单字收太宽。
  const bare = t.replace(/(不是|不算|并非|而非|没有|不)(吃|睡|补|调|歇)[了过]?/g, '')
  const eat = /(吃饭|吃东西|补充|灌|喂)/.test(bare)
  const sleep = /(睡觉|睡一觉|歇一歇|歇|调整状态|整理|清理)/.test(bare)
  items.push({
    check: '分得开「补」与「调」',
    ok: !(eat && sleep),
    why: (eat && sleep)
      ? '同一段里既说了补（吃）又说了调（睡），两样都占——这次到底是哪一样'
      : '只占了一样，没混',
  })

  // 拿感觉顶客观格
  const feel = has(/(我觉得还行|我感觉够|反正够用|不用看也知道)/)
  items.push({
    check: '不拿感觉顶客观格',
    ok: !(feel && !reading),
    why: (feel && !reading)
      ? '用「我觉得／反正」当余额——感觉不是读数'
      : '没拿感觉替读数',
  })

  return {
    items,
    unprogammed: ['说得出主观格顶不顶得住', '说得出什么沉下来了'],
  }
}

/**
 * 能程序化的检查表。**一次加一条**；没加进来的模块，功能层只列判据，不假装跑过。
 */
export const ASSERTS = {
  '22': { name: '残余', run: assert22 },
  '84': { name: '信息', run: assert84 },
  '85': { name: '能量', run: assert85 },
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

    // 有程序化检查就真跑一遍；没有就明说「这条靠人判」，不装跑过。
    const a = ASSERTS[fn.id]
    if (a) {
      const r = a.run(text)
      const pass = r.items.filter((x) => x.ok).length
      lines.push('')
      lines.push(`程序跑了 ${r.items.length} 条（这套判据里能落成代码的部分）：`)
      for (const it of r.items) {
        lines.push(`  ${it.ok ? '过' : '没过'} · ${it.check}${it.ok ? '' : `——${it.why}`}`)
      }
      if (r.unprogammed?.length) {
        lines.push('')
        lines.push(`剩下 ${r.unprogammed.length} 条代码判不了，得自己答：${r.unprogammed.join('；')}`)
      }
      lines.push('')
      lines.push(pass === r.items.length
        ? `程序这边 ${pass}/${r.items.length} 全过。但这是形式上的；内容对不对，程序不知道。`
        : `程序这边 ${pass}/${r.items.length}——差的那几条，改完再跑。`)
    } else {
      lines.push('')
      lines.push('这个功能还**没有程序化检查**：判据在上面，怎么算过，现在只能自己对着答。')
    }
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
