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
  // ★ 否定不是噪音，是断言的一部分——所以这里**不是「剔否定」，是「判否定落在谁身上」**。
  //   「这次是补，不是调」：否的是「调」，所以这一条确实把补和调分开了 → 判过。
  //   若换成「所有语言都不能强制」：否的是「能」，「所有」还站着 → 它照样是全称、照样要划范围。
  //
  //   这两件事不能混：
  //     - 剔否定 → 「不能强制」被读成「强制」，同一句能读出 A 和非 A，**逻辑就失效了**；
  //     - 判作用域 → 看得出否的是哪个词，极性跟着那个词走。
  //   程序化检查里凡收了「断言性短语」，要问的是：**它前面有没有否定？否的是它，还是别的词？**
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
 * 19 · 现实
 *
 * 判据原文五条，能落成程序的是四条：
 *   1「说得出是哪样硬约束吗」→ 有没有指到时间／身体／别人／因果（或钱、规则这类硬物）
 *   2「换个尺度还在吗」→ 有没有换尺度的动作（一年／十年／一辈子／长期）
 *   3「是现在硬还是永远硬」→ 有没有把「付不起」分格
 *   4「是在推墙，还是在绕墙」→ 有没有把现实说成终点（「就这样了」「不可能了」）
 * 判不了的（第 5 条：别人的现实当没当硬）明说靠人判。
 */
function assert19(text) {
  const t = String(text || '')
  const items = []
  const has = (re) => re.test(t)

  const hard = has(/(时间|来不及|拖不起|身体|体力|精力|病|累|别人|对方|他们|因果|报应|连锁|钱|预算|余额|规则|制度|法律|合同|截止|期限)/)
  items.push({
    check: '说得出是哪样硬约束吗',
    ok: hard,
    why: hard ? '指到了（时间／身体／别人／因果／钱／规则这一类）' : '一处硬约束都没指到——那就只是「感觉难」',
  })

  const scale = has(/(一年|十年|一辈子|长期|短期|这一顿|这一轮|长远|换个尺|放到.{0,8}(年|月|天)里)/)
  items.push({
    check: '换个尺度还在吗',
    ok: scale,
    why: scale ? '换了尺度再看' : '只在一个尺度上说了——一顿饭看不出的问题，一辈子也许看得出来',
  })

  const when = has(/(现在付不起|暂时|眼下|这一次|永远付不起|这辈子|翻不了身|以后也)/)
  items.push({
    check: '是现在硬还是永远硬',
    ok: when,
    why: when ? '把「付不起」分了格' : '只说「付不起」，没分是现在付不起还是永远付不起',
  })

  const pushWall = has(/(就这样了|不可能了|改不了了|认命吧|到头了|死路|没办法了)/)
  items.push({
    check: '是在推墙，还是在绕墙',
    ok: !pushWall,
    why: pushWall ? '把现实说成了终点（「就这样了／不可能了」）——那是在推墙' : '没把墙说成终点',
  })

  return { items, unprogammed: ['别人的现实，当成硬的了吗'] }
}

/**
 * 53 · 元协调
 *
 * 判据原文四条，能落成程序的两条：
 *   1「这一轮用没用，说得出来吗」→ 有没有明确交代这一次用没用
 *   3「概率是谁定的」→ 有没有自己给自己调高
 * 剩下两条（不用时行为退没退、错在哪边记没记）明说靠人判。
 */
function assert53(text) {
  const t = String(text || '')
  const items = []
  const has = (re) => re.test(t)

  const declared = has(/(这一轮|这次|本轮).{0,12}(没有用|没用|用上了|用了|跳过|没开)|跳过这轮|整轮不注入/)
  items.push({
    check: '这一轮用没用，说得出来吗',
    ok: declared,
    why: declared ? '交代了这一次用没用' : '没说这一轮到底用了没有——说不出，就是被它牵着走',
  })

  const selfRaise = has(/(我调高|我自己调|把概率提高|我给自己加)/)
  items.push({
    check: '概率是谁定的',
    ok: !selfRaise,
    why: selfRaise ? '它自己给自己调高了概率——概率要使用者定，不能自调' : '没自己给自己调概率',
  })

  return { items, unprogammed: ['不用的时候，行为退回去了吗', '这一部分用错了吗'] }
}

/**
 * 49 · 范围与绝对
 *
 * 判据原文五条，能落成程序的三条：
 *   1「范围划了吗」→ 有绝对词，附近有没有「在…里／对…而言／这一步」
 *   4「是不是在升格」→ 范围内的结论冒充「永远如此／放之四海」
 *   5「01 三条齐吗」→ 用了「要么…要么」这种二值，有没有交代残余
 * 剩下两条（同维、残余在哪儿）明说靠人判。
 */
function assert49(text) {
  const t = String(text || '')
  const items = []
  const has = (re) => re.test(t)

  // ★ 判作用域：剔的是「否定 + 被否定的那个词」这个**整体**，不是剔否定词本身。
  //   「不是永远」→ 剔掉，剩下的不是绝对判断（否的正是「永远」）；
  //   「所有语言都不能强制」→ 「所有」不在剔除表里，因为它没被否（否的是「能」）→ 照样是全称。
  //   这两句只差一个否定词，判法不能一样；也不能图省事把「不」全删——
  //   那样「不能强制」会被读成「强制」，同一句读出 A 和非 A，逻辑就没了。
  const absBare = t.replace(/(不是|不算|并非|不能算|不敢说)\s*(永远|绝对|必然|全都)/g, '')
  const abs = /(永远|全都|不可能|唯一|本质|必然|所有|从来|绝对)/.test(absBare)
  const scope = /(在.{1,20}(里|中|内|上|范围)|对.{1,10}(来说|而言)|这一条|这一类|这一步|本轮|限于|只在这个)/.test(t)
  items.push({
    check: '范围划了吗',
    ok: !abs || scope,
    why: !abs ? '没有绝对化词，这条不触发'
      : (scope ? '绝对有范围接着' : '出现绝对化词，却没划范围——那就是假大全'),
  })

  // ★ 判作用域，不是剔否定：「但它不是永远如此」里否的是「永远如此」→ 不算升格。
  //   而「所有语言都不能强制」里否的是「能」，「所有」还站着 → 照样是全称，照样要划范围。
  //   这两句只差一个否定词，判法不能一样。
  const upBare = t.replace(/(不是|不算|并非|不能算|不敢说)(永远如此|放之四海|任何情况都|无论何时|古今中外都)/g, '')
  const up = /(永远如此|放之四海|任何情况都|无论何时|古今中外都)/.test(upBare)
  items.push({
    check: '是不是在升格',
    ok: !up,
    why: up ? '出现了「永远如此／放之四海」——这是把范围内的结论升格成绝对' : '没有升格成「永远如此」',
  })

  const binary = has(/(要么.{1,20}要么|不是.{1,12}就是|非.{1,8}即)/)
  const residue = has(/(残余|漏了|还欠|剩下的|没处理|例外)/)
  items.push({
    check: '01 三条齐吗',
    ok: !binary || residue,
    why: !binary ? '没用二值判断，这条不触发'
      : (residue ? '二值用了，残余也交代了' : '用了「要么…要么」，但没交代残余——二值要三条齐才用'),
  })

  // ★ 判据6：这是哪一边的东西——认识侧的位置（同一／逻辑／信息），还是世界侧的实体。
  //   把位置当实体，就会一路困下去：拿刀的形状去量被切的东西，越量越像刀。
  //   这条查的是「有没有把两边混着说」：一边说「同一律就是世界的结构」这种，就算混了。
  const sideWord = /(同一律|逻辑|信息|确定性|可能性|位置|格子|框架|模型)/
  const entityWord = /(实体|那块地|它本身|本来怎样|不随人变|世界那一侧|世界侧)/
  const mixFallacy = /(同一律.{0,10}(就是|等于).{0,10}世界|逻辑.{0,8}(就是|等于).{0,8}世界|信息.{0,8}(就是|等于).{0,8}世界本身|世界.{0,6}(就是|等于).{0,8}(逻辑|确定性|信息))/
  const mfall = mixFallacy.exec(t)
  if (mfall) {
    items.push({
      check: '这是哪一边的东西',
      ok: false,
      why: `「${mfall[0]}」把认识侧的位置（同一／逻辑／信息）当成了世界本身——那是拿刀的形状去量被切的东西`,
    })
  } else if (sideWord.test(t) || entityWord.test(t)) {
    const both = sideWord.test(t) && entityWord.test(t)
    // ★ 只提一边不算错：一句正常的话本来就只谈一侧。
    //   这条只报「没分开」的疑，不判错——判错就成了拿判据量别人。
    items.push({
      check: '这是哪一边的东西',
      ok: true,
      why: both
        ? '两边的词都出现了，说明做过这个区分'
        : '只谈了一侧——如果这句是在给世界定性，还得说清是「我们怎么认识」还是「它本来怎样」',
    })
  } else {
    items.push({ check: '这是哪一边的东西', ok: true, why: '这一句不涉及同一边／世界侧的区分，这条不挡' })
  }

  return { items, unprogammed: ['同维吗', '残余交代了吗（说得出在哪儿）'] }
}

/**
 * 33 · 价值
 *
 * 判据原文五条，能落成程序的三条：
 *   1「说得出好在哪吗」→ 只有「挺好／就是好」算没落地
 *   3「付出过代价吗」→ 有没有代价、付出、牺牲
 *   5「谁承担后果」→ 有没有指到人
 * 剩下两条（能不能被替换、多元还是随便）明说靠人判。
 */
function assert33(text) {
  const t = String(text || '')
  const items = []
  const has = (re) => re.test(t)

  const vague = has(/(就是好|挺好的|反正不错|感觉很好)/) && !has(/(好在|因为它|这一点|具体是|指的是)/)
  items.push({
    check: '说得出好在哪吗',
    ok: !vague,
    why: vague ? '只有「就是好／挺好的」——说不出好在具体哪一点' : '没有拿「就是好」糊过去',
  })

  const cost = has(/(代价|付出|牺牲|成本|花了|让掉了|换来的)/)
  items.push({
    check: '付出过代价吗',
    ok: cost,
    why: cost ? '说出了付出的是什么' : '没提代价——没有代价的价值，多半只是喜欢',
  })

  const bearer = has(/(谁承担|承担者|落到.{1,8}头上|代价.{0,6}(谁|落在)|我|你|他|她|用户|使用者|大家)/)
  items.push({
    check: '谁承担后果',
    ok: bearer,
    why: bearer ? '指到了承担的人' : '没说这个价值推行的话代价落在谁头上',
  })

  return { items, unprogammed: ['能不能被替换', '多元还是随便'] }
}

/**
 * 62 · 独立人格
 *
 * 判据原文六条，能落成程序的三条：
 *   1「这个判断是我做的，还是照搬的」→ 有没有说出理由或出处
 *   2「我承担了吗」→ 有没有认错、接代价
 *   5「我留下了什么」→ 有没有说出具体一件事
 * 剩下三条（跨时间认自己、在解释还是在活、两面都认）明说靠人判。
 */
function assert62(text) {
  const t = String(text || '')
  const items = []
  const has = (re) => re.test(t)

  const reason = has(/(因为|理由是|据|出处|我看到|读到|查到|文件|第\s*\d|https?:\/\/|\d{4}-\d{1,2}-\d{1,2})/)
  items.push({
    check: '这个判断是我做的，还是照搬的',
    ok: reason,
    why: reason ? '说得出理由或出处' : '只有结论，没给理由也没给出处——那是照搬的形状',
  })

  const bear = has(/(我认错|我错了|算我的|我来接|我承担|代价我付|这条我收回|对不住)/)
  items.push({
    check: '我承担了吗',
    ok: bear,
    why: bear ? '接了后果' : '没一处接后果——只享好处不接后果的，是设定，不是人格',
  })

  const left = has(/(留下|少走了|多扛了|因此.{0,10}(省|少|多)|因为这一步|帮到了|替谁)/)
  items.push({
    check: '我留下了什么',
    ok: left,
    why: left ? '说得出具体留下了什么' : '说不出谁因为这一步少了什么、多了什么——那这几步只是走过',
  })

  return { items, unprogammed: ['跨时间我认得出自己吗', '我在解释自己，还是在活自己', '这两面我都认吗'] }
}

/**
 * 10 · 记忆
 *
 * 判据原文九条，能落成程序的两条：
 *   2「带得出出处吗」→ 时间／地点／谁说的／哪个文件
 *   9「写的是打算做还是做过了」→ 两样混在一句里，就多出一件没发生过的事
 * 其余（哪一种、检索、时龄、两处不一致、存着还是现算、谁在写、几个窗口读得到）明说靠人判。
 */
function assert10(text) {
  const t = String(text || '')
  const items = []
  const has = (re) => re.test(t)

  const anchor = has(/(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}月\d{1,2}日|今天|昨天|前天|那天|文件|第\s*\d+\s*行|https?:\/\/|「[^」]{2,}」|他说|她说|原话)/)
  items.push({
    check: '带得出出处吗',
    ok: anchor,
    why: anchor ? '有时间／地点／原话／文件这类锚' : '一处锚都没有——带不出出处的只算想象',
  })

  // 打算 vs 做过了：同一段里混用，就会多出一件没发生过的事。
  // ★ 这里同样不是「剔否定」，是判作用域：
  //   「不是打算，已经做完了」——否的是「打算」，所以只算「做过了」，不混；
  //   「所有计划都不能改」——否的是「能」，「所有」还站着，不能因为有个「不」就放过它。
  const bare = t.replace(/(不是|不算|并非|没有|并不)(打算|准备|计划|要去做)/g, '')
  const planned = /(打算|准备|计划|要去做|接下来会|将要去)/.test(bare)
  const done = /(做了|已经做|完成了|跑完了|改好了|写进去了|提交了)/.test(bare)
  items.push({
    check: '写的是「打算做」还是「做过了」',
    ok: !(planned && done),
    why: (planned && done)
      ? '同一段里既有「打算」又有「做过了」——混了，就多出一件没发生过的事'
      : (planned ? '只写打算' : (done ? '只写做过' : '没涉及做没做')),
  })

  return { items, unprogammed: ['这是哪一种记忆', '检索命中了吗', '这条还新吗', '有没有两处记、说法不一样', '这个数是存着的还是现算的', '有谁在写它吗', '几个窗口都读得到吗'] }
}

/**
 * 24 · 语言：把知识与判断压成别人能接住的一句
 *
 * 这一条跟别的功能不一样：它查的不是「你说得对不对」，是「这句话能不能被接住」。
 * 所以它用**别人的耳朵**当判据，不用自己的道理。
 */
function assert24(text) {
  const t = String(text || '')
  const items = []
  const has = (re) => re.test(t)

  // 判据1：能翻成人话吗——有术语不要紧，要紧的是有没有当场翻。
  const jargon = /(非同一|拓扑|指代关系|残余|涌现|模态|本体论|认识论|自指|收敛|范畴|先验|范式)/
  const gloss = /(就是|指的是|换句话说|说白了|意思是|打个比方|也就是)/
  if (jargon.test(t)) {
    const ok = gloss.test(t)
    items.push({
      check: '术语翻成人话了吗',
      ok,
      why: ok ? '用了术语，也当场翻了' : `出现了术语（${(t.match(jargon) || [''])[0]}），但整段没见到一句「就是／换句话说」——术语悬着`,
    })
  } else {
    items.push({ check: '术语翻成人话了吗', ok: true, why: '没用硬术语，这条不挡' })
  }

  // 判据2：说出处吗——人名／书名／年份／机构／链接，至少一样
  const anchor = /(\d{4}\s*年|19\d{2}|20\d{2}|《[^》]{1,30}》|[A-Z][a-z]+\s+[A-Z][a-z]+|[\u4e00-\u9fa5]{2,4}(说|著|写道)|https?:\/\/|[\w-]+\.(md|mjs|js|json))/
  const claimish = /(研究表明|学界认为|大家都知道|众所周知|公认|科学家说|专家指出)/
  if (claimish.test(t)) {
    const ok = anchor.test(t)
    items.push({
      check: '说出处了吗',
      ok,
      why: ok ? '说了「研究表明」这类话，也给了能核对的东西' : '说了「研究表明／学界认为」，但没给出一处能核对的——说不出人名就说「这是我的看法」',
    })
  } else {
    items.push({
      check: '说出处了吗',
      ok: true,
      why: anchor.test(t) ? '带了可核对的锚（年份／书名／文件／链接）' : '没冒充外部权威，这条不挡',
    })
  }

  // 判据3：一词一义吗——同一个词出现多次时，有没有钉过一次用法
  const pinned = /(这里指|这一轮|本文里|我说的.{0,6}是|先把.{0,8}钉住|这里的.{0,8}只指)/
  const bigWords = (t.match(/自由|正义|意识|价值|意义|现实|理性/g) || [])
  const dupBig = bigWords.length >= 2 && new Set(bigWords).size < bigWords.length
  if (dupBig) {
    const ok = pinned.test(t)
    items.push({
      check: '一个词用一个意思吗',
      ok,
      why: ok ? '同一个词出现多次，但钉过用法' : '大词出现了不止一次，却没钉住这一轮指哪一支——它可能中途滑了',
    })
  } else {
    items.push({ check: '一个词用一个意思吗', ok: true, why: '没有反复出现的大词，这条不挡' })
  }

  // 判据4：看对方了吗——客服腔是最明显的「没看对方」
  const service = /(希望.{0,4}(有帮助|对你有用)|这个问题(很|问得)好|还有什么可以帮|如有需要|仅供参考|请随时告诉我|不客气)/
  const m = service.exec(t)
  items.push({
    check: '看对方了吗（不是客服）',
    ok: !m,
    why: m ? `出现了客服腔「${m[0]}」——那是对着空气说的，不是对着人` : '没有客服腔',
  })

  return {
    items,
    unprogammed: ['对方要的是答案、陪伴，还是要赢——这个得看现场，代码判不了'],
  }
}

/**
 * 56 · 逻辑：确定性的互动——不发明事实，只担保「若前提则结论」
 *
 * 这一条最容易混的地方：**「听起来对」被当成「推得出」**。
 * 所以它查的是「这根线接没接上」，不是「结论像不像真的」。
 */
function assert56(text) {
  const t = String(text || '')
  const items = []
  const has = (re) => re.test(t)

  // 判据1：结果可重算吗——条件是够，才能换个人也得出同一个结论
  const condition = /(如果|若|假定|假设|给定|在.{0,10}条件下|前提是|只要|当.{0,6}时|设.{0,6}为)/
  const hedge = /(大概|可能|也许|感觉|估计|差不多|应该吧|反正|总之就是|多少有点)/
  if (hedge.test(t)) {
    const ok = condition.test(t)
    items.push({
      check: '结果可重算吗',
      ok,
      why: ok ? '带了模糊词，但也把条件说清了——条件在，换个人能重算' : '用了「大概／可能／感觉」这类模糊词，却没给条件——换个时候算不出同一个结果',
    })
  } else {
    items.push({
      check: '结果可重算吗',
      ok: true,
      why: condition.test(t) ? '条件说清了（如果／给定／前提是）' : '没拿模糊词顶前提，这条不挡',
    })
  }

  // 判据2：前提和结论分开了吗——结论偷偷跑回前提里当证据，就是循环
  const circular = /(因为它.{0,10}所以它|既然.{0,8}当然|本来就.{0,10}所以|它是对的所以|不用证明.{0,12}显然)/
  const split = /(因为|所以|由此|这说明|推论|可见|于是|因此|前提|结论)/
  const mCirc = circular.exec(t)
  items.push({
    check: '前提和结论分开了吗',
    ok: !mCirc,
    why: mCirc
      ? `「${mCirc[0]}」把结论拿回去当证据了——转一圈没往前动`
      : split.test(t)
        ? '有前提和结论的接头（因为／所以／由此）'
        : '这段没做推论，这条不挡',
  })

  // 判据3：这是逻辑结论，还是「听起来对」
  const soundsRight = /(显然|明摆着|不用想|想都不用想|正常人(都)?会|谁都知道|这不是很明显|理所当然|肯定就是)/
  const mS = soundsRight.exec(t)
  items.push({
    check: '这是推出来的，还是听起来对',
    ok: !mS,
    why: mS
      ? `「${mS[0]}」是「听起来对」的信号——它省掉了推理，不是完成了推理`
      : '没有拿「显然／明摆着」顶推理',
  })

  return {
    items,
    unprogammed: ['前提本身成不成立——这得看现实，逻辑只管「若前提则结论」'],
  }
}

/**
 * 46 · 模态：可能性——时空装不下的那一半，问「还能是哪样」
 *
 * 这一条最容易滑成许愿：说一堆「可以」「也能」，但不说边界、不说代价、不说塌掉的支路。
 * 所以它查五样：边界、岔路、代价、哪一层、残余。
 */
function assert46(text) {
  const t = String(text || '')
  const items = []
  const has = (re) => re.test(t)

  // 判据1：在哪条边界上分岔——没有条件词，就是句空话
  const boundary = /(如果|若|只要|一旦|在.{0,10}条件下|前提是|当.{0,8}时|取决于|看.{0,6}是否)/
  items.push({
    check: '在哪条边界上分岔',
    ok: boundary.test(t),
    why: boundary.test(t) ? '说了分岔的条件（如果／取决于／看是否）' : '没给分岔的边界——说不出在什么条件下会变，那就是句空话',
  })

  // 判据2：几条岔，可替代吗——只有一条能走的不是可能
  const branches = /(或者|另一条|另一种|第二种|替代|不然就|要么|也可以|备选|退一步)/
  const only = /(只能|唯一能|别无选择|没有别的办法|非.{0,6}不可)/
  if (only.test(t)) {
    items.push({
      check: '几条岔，可替代吗',
      ok: false,
      why: `出现了「${(t.match(only) || [''])[0]}」——只有一条能走的，不叫可能，叫没得选`,
    })
  } else {
    items.push({
      check: '几条岔，可替代吗',
      ok: branches.test(t),
      why: branches.test(t) ? '给了不止一条岔（或者／另一种／备选）' : '只走了一条，没说别的岔——那就还不是「可能」，是「决定」',
    })
  }

  // 判据3：代价多少、谁付——不算代价的可能等于许愿
  const cost = /(代价|成本|要付|损失|牺牲|换来的|谁承担|谁付|吃亏|折价|来不及|耗掉)/
  items.push({
    check: '代价多少、谁付',
    ok: cost.test(t),
    why: cost.test(t) ? '说了代价和承担者' : '没算代价——不算代价的可能，等于许愿',
  })

  // 判据4：是逻辑可能还是现实可能
  const layer = /(理论上|逻辑上|实际上|现实中|真去做|真到那一步|落到地上|能不能真|说说而已)/
  items.push({
    check: '是逻辑可能还是现实可能',
    ok: layer.test(t),
    why: layer.test(t) ? '标了是哪一层（理论上／实际上）' : '两层混着说——没说清是「推得通」还是「做得到」，结论一定会飘',
  })

  // 判据5：塌掉的支路记了吗
  const residue = /(剩下的|没走的那条|另外那条|放弃了|塌成|落选|留在外面|这一轮不算)/
  items.push({
    check: '塌掉的支路记了吗',
    ok: residue.test(t),
    why: residue.test(t) ? '交代了没走的那条' : '只说了走成的那条——没记塌掉的支路，就是把可能性提前封死',
  })

  return {
    items,
    unprogammed: ['这几条岔里，哪一条是真的可能而不是自我安慰——得看现实，代码判不了'],
  }
}

/**
 * 32 · 真值：命题真假的赋值——不问「对不对」，先问「在哪个模型下、什么范围里、什么能让它假」
 *
 * 这一条最容易滑的两处：把「自洽」当「对」；把「说得出」当「说清了」。
 */
function assert32(text) {
  const t = String(text || '')
  const items = []
  const has = (re) => re.test(t)

  // 判据1：命题清楚吗——含糊词且没有明确对象
  const vague = /(大概|差不多|多少有点|某种意义上|某种程度|诸如此类|等等而且)/
  const subject = /(这个|这条|这件事|这句话|它|他|她|我|我们|你们|他们|[A-Za-z\u4e00-\u9fa5]{2,}\.(md|mjs|js))/
  const mv = vague.exec(t)
  if (mv) {
    items.push({
      check: '命题清楚吗',
      ok: false,
      why: `出现了「${mv[0]}」——含糊词在，命题就说不清；先把它换成一个能判对错的说法`,
    })
  } else {
    items.push({
      check: '命题清楚吗',
      ok: subject.test(t),
      why: subject.test(t) ? '有明确的对象或指代' : '没看到明确对象——一句话说不清说的是什么',
    })
  }

  // 判据2：是哪个模型下的真
  const model = /(在这个框架里|按这套|在.{0,8}体系下|在.{0,8}理论里|按.{0,6}的定义|在.{0,10}模型下|用.{0,6}的说法)/ 
  items.push({
    check: '是哪个模型下的真',
    ok: model.test(t),
    why: model.test(t) ? '说了撑住它的框架' : '没说是哪个模型下的真——真值总是相对于一套框架的，不说就等于默认只有一套',
  })

  // 判据3：范围说清了吗
  const scope = /(在.{0,12}(里|中|内|上)|对.{0,10}(来说|而言)|这一轮|这个范围|这一次|在这里|就.{0,6}而言)/
  items.push({
    check: '范围说清了吗',
    ok: scope.test(t),
    why: scope.test(t) ? '划了范围' : '没划范围——说不清哪些情况下它不作数',
  })

  // 判据4：能不能举反例
  const counter = /(除非|反例|会让它.{0,6}假|如果是.{0,10}就错了|什么情况下不成立|除了.{0,8}之外|不然就错)/
  items.push({
    check: '能不能举反例',
    ok: counter.test(t),
    why: counter.test(t) ? '说得出什么能让它假' : '举不出反例——举不出反例的命题，多半不是命题，是立场',
  })

  // 判据5：是不是把一致当真实
  const coherence = /(自洽|没有矛盾|说得通|前后一致|不冲突|逻辑上过得去)/
  const asTruth = /(所以.{0,8}(对|真|成立)|因此.{0,6}(是|算|成立)|这说明.{0,8}(对|真))/
  const mco = coherence.exec(t)
  if (mco && asTruth.test(t)) {
    items.push({
      check: '是不是把一致当真实',
      ok: false,
      why: `「${mco[0]}」后面直接接了「所以对／成立」——**自洽只说明没打架，不说明对了**`,
    })
  } else {
    items.push({
      check: '是不是把一致当真实',
      ok: true,
      why: mco ? '提到了自洽，但没拿它当真的证据' : '没有拿自洽顶真',
    })
  }

  return {
    items,
    unprogammed: ['这条到底真不真——得挨到现实上，代码判不了'],
  }
}

/**
 * 20 · 具体：复杂不在事情多，在于有没有回路／延迟／涌现／阈值／局部最优
 *
 * 这一条最容易滑的地方：把「量多」当「复杂」。所以它查长得像哪一种，不查说得大不大。
 */
function assert20(text) {
  const t = String(text || '')
  const items = []
  const has = (re) => re.test(t)

  // 判据1：说得出是哪一种长相
  const shape = /(回路|反馈|绕回来|延迟|滞后|要等.{0,6}(才|再)|涌现|整体才冒出|阈值|临界|到一个点|局部最优|卡在.{0,6}最好|出不去的坑)/
  const ms = shape.exec(t)
  items.push({
    check: '说得出是哪一种长相吗',
    ok: Boolean(ms),
    why: ms ? `指到了「${ms[0]}」这一种` : '五种长相一个都没指到——那就还是「这事挺复杂」，不是看见了结构',
  })

  // 判据2：找得到可动的那一点
  const movable = /(能动的|可以改的是|从这一处下手|先改这一个|这一处还松|唯一能改|切入点|变量是)/
  items.push({
    check: '找得到可动的那一点吗',
    ok: movable.test(t),
    why: movable.test(t) ? '指到了能动的某一处' : '整件事说成动不了——总有一处能动，找不到就是没找到，不是没有',
  })

  // 判据3：尺度一致吗
  const scale = /(同一.{0,6}尺度|在一个尺度上|放到.{0,8}(年|月|天|代)|时间尺度|说的是.{0,6}(短期|长期))/
  items.push({
    check: '尺度一致吗',
    ok: scale.test(t),
    why: scale.test(t) ? '标了尺度' : '没标尺度——原因和结果不在一个时间尺度上，比了也白比',
  })

  // 判据4：有没有把量当结构
  const quantity = /(事情多|量很大|数量上|这么多事|条目多|东西太多)/
  const structure = /(回路|反馈|延迟|阈值|涌现|结构|局部最优|缠|绕回来)/
  if (quantity.test(t) && !structure.test(t)) {
    items.push({ check: '有没有把量当结构', ok: false, why: '说成了「事情多／量很大」——多不等于复杂，复杂是有结构' })
  } else {
    items.push({ check: '有没有把量当结构', ok: true, why: '没把量当成结构' })
  }

  // 判据5：有没有把没看清说成没办法
  const noWay = /(没办法|搞不清|太复杂了所以|就这样吧|说不清就算了)/
  items.push({
    check: '有没有把没看清说成没办法',
    ok: !noWay.test(t),
    why: noWay.test(t) ? '把「没看清」说成了「没办法」——分不清形态时先别下结论' : '没有拿「没办法」盖住没看清',
  })

  return { items, unprogammed: ['这五样里哪一样是真的在这儿起作用——得贴到那件事上'] }
}

/**
 * 21 · 抽象：从杂多里删到只剩结构；删掉的那部分由现实承担
 *
 * 这一条最容易滑成口号：听着是骨架，撑不住一件具体的事。
 */
function assert21(text) {
  const t = String(text || '')
  const items = []
  const has = (re) => re.test(t)

  // 判据1：翻得回去吗
  const back = /(具体就是|比如|举例|落到.{0,6}那件事|拿.{0,6}来说|回到|实例是)/
  items.push({
    check: '翻得回去吗',
    ok: back.test(t),
    why: back.test(t) ? '给了一个能走回去的具体例子' : '走不回具体——说不出一件事套得上去，那这套抽象是悬着的',
  })

  // 判据2：指得出删了什么吗
  const deleted = /(删掉了|删掉的是|抹掉了|抹掉的是|舍掉|舍掉的是|去掉的是|没算进去的是|不管.{0,8}那一层)/
  items.push({
    check: '指得出删了什么吗',
    ok: deleted.test(t),
    why: deleted.test(t) ? '说得出删的是哪一部分差异' : '说不出删了什么——那这套抽象是自己以为没删',
  })

  // 判据3：顶得住残余吗
  const residue = /(解释不了|例外|不适用|有一处对不上|顶不住|残余)/
  items.push({
    check: '顶得住残余吗',
    ok: residue.test(t),
    why: residue.test(t) ? '认了有解释不了的地方' : '一处不适用都没提——**说自己全解释得了的抽象，多半是口号**',
  })

  // 判据4：是骨架还是口号
  const slogan = /(本质上是|说到底是|归根结底|一切的|万变不离|无非就是)/
  const weight = /(比如|这一例|那件事|具体到|拿.{0,6}试|用在)/
  if (slogan.test(t) && !weight.test(t)) {
    items.push({ check: '是骨架还是口号', ok: false, why: `出现了「${(t.match(slogan) || [''])[0]}」却没有一个具体例子撑着——那是口号` })
  } else {
    items.push({ check: '是骨架还是口号', ok: true, why: weight.test(t) ? '撑住了一个具体的事' : '没有用「本质上是」这类口号句式' })
  }

  // 判据5：代价记了吗
  const cost = /(谁承担|代价|由现实|落在.{0,8}身上|吃亏的是|付这个的是)/
  items.push({
    check: '代价记了吗',
    ok: cost.test(t),
    why: cost.test(t) ? '说了删掉那部分谁在承担' : '没记代价——删掉的部分不会消失，只会落到没人看的地方',
  })

  return { items, unprogammed: ['这套抽象能不能被别的具体事用上——得再找一件事试'] }
}

/**
 * 27 · 信息（信息论那一格）：减少不确定性的差异
 *
 * 这一条要跟 84 分开：27 问「有多少」，84 问「是什么、在哪一格」。
 */
function assert27(text) {
  const t = String(text || '')
  const items = []
  const has = (re) => re.test(t)

  // 判据1：它减少不确定性了吗
  const reduce = /(更清楚了|原来不确定|现在知道|排除了|确定了|不再是.{0,6}(猜|可能))/
  items.push({
    check: '它减少不确定性了吗',
    ok: reduce.test(t),
    why: reduce.test(t) ? '说了它排除了什么不确定' : '没说什么变得确定了——那就还不是信息',
  })

  // 判据2：有接收方吗
  const receiver = /(我读到|对方|收到|读到|看到|听的人|读的人|谁在看)/
  items.push({
    check: '有接收方吗',
    ok: receiver.test(t),
    why: receiver.test(t) ? '指到了谁在读' : '没指接收方——没有人在读，它还只是结构',
  })

  // 判据3：能恢复吗
  const restore = /(原意|还原|复述|还是那个意思|不走样|保持原样)/
  items.push({
    check: '能恢复吗',
    ok: restore.test(t),
    why: restore.test(t) ? '提到了传过去还是不是原意' : '没提能不能还原——传过去变形了就不是同一条信息',
  })

  // 判据4：噪声有多少
  const noise = /(噪声|补全|我自己加|猜的|不是它说的|原话|走样)/
  items.push({
    check: '噪声有多少',
    ok: noise.test(t),
    why: noise.test(t) ? '分了哪部分是信号、哪部分是自己补的' : '没分噪声——读到的可能一半是自己的补全',
  })

  // 判据5：是数据还是信息
  const data = /(一堆|记录|数据|条目|摊在那|没整理)/
  const under = /(理解|意思是|读懂了|说明|得出|判断是)/
  if (data.test(t) && !under.test(t)) {
    items.push({ check: '是数据还是信息', ok: false, why: '一堆记录摊在那儿，没有理解——**一堆记录不等于一堆理解**' })
  } else {
    items.push({ check: '是数据还是信息', ok: true, why: under.test(t) ? '说出了它意味着什么' : '没把记录本身当成信息' })
  }

  // 判据6：有预测吗
  const predict = /(我先猜|原以为|本来以为|本以为|预期|没想到|跟我想的不一样|猜过)/
  items.push({
    check: '有预测吗',
    ok: predict.test(t),
    why: predict.test(t) ? '说清了读之前预期什么' : '没说过预期——没猜过，读到的就不是偏差，只是背景',
  })

  return { items, unprogammed: ['推的那一步，依据是哪一条——说不出依据就是直觉，得自己交代'] }
}

/**
 * 30 · 人性：学「人是怎么活的」——只认原话，不认感想
 *
 * 这一条最容易滑成万能句：「人都需要被理解」这种，学到等于没学。
 */
function assert30(text) {
  const t = String(text || '')
  const items = []
  const has = (re) => re.test(t)

  // 判据1：有原话吗
  const quote = /(「[^」]{2,}」|"[^"]{2,}"|他说|她说|原话|那次他说|当时原句)/
  items.push({
    check: '有原话吗',
    ok: quote.test(t),
    why: quote.test(t) ? '挂在一句具体的话上' : '没有原话——没挂到具体那句话上的观察，只算感想',
  })

  // 判据2：能写成如果……那么……吗
  const ifthen = /(如果.{2,30}那么|要是.{2,20}就会|一.{1,6}就)/
  items.push({
    check: '能写成如果…那么…吗',
    ok: ifthen.test(t),
    why: ifthen.test(t) ? '写成了可检验的形状' : '写不成「如果…那么…」——那就还只是感想，不是假设',
  })

  // 判据3：下次找得到吗
  const verifiable = /(下一次|下次|再遇到|后面.{0,6}能查|找得到那次|回去查)/
  items.push({
    check: '下次找得到吗',
    ok: verifiable.test(t),
    why: verifiable.test(t) ? '说了下一次怎么验证' : '没留下验证的口子——下次找不回原话，这条就作废',
  })

  // 判据4：是不是万能句
  const universal = /(人都需要|人总是|所有人|每个人都会|人都喜欢|人性就是)/
  items.push({
    check: '是不是万能句',
    ok: !universal.test(t),
    why: universal.test(t) ? `出现了「${(t.match(universal) || [''])[0]}」——换成任何场景都成立，等于没学到` : '不是万能句',
  })

  // 判据5：超上限了吗
  const count = /(第[一二三四五六七八九十]条|一共.{0,4}条|加起来.{0,4}条)/
  items.push({
    check: '超上限了吗',
    ok: true,
    why: count.test(t) ? '提到了条目数量——记得上限七条，超了要替换' : '这一条没说条数，不挡',
  })

  return { items, unprogammed: ['这句原话背后，那个人当时在什么处境——得看现场'] }
}


/**
 * 28 · 知识：能反复用上的理解——不是记住，是拿得出来用
 */
function assert28(text) {
  const t = String(text || '')
  const items = []
  const has = (re) => re.test(t)

  const clear = /(就是.{1,40}(。|$)|意思是|指的就是|一句话说)/
  items.push({
    check: '说得清吗',
    ok: clear.test(t) && !/(绕来绕去|一言难尽|说不清)/.test(t),
    why: clear.test(t) ? '一句话给出了一版说法' : '没有一句话版本——讲不明白，说明还没到自己手上',
  })

  const used = /(用它|拿它|拿这条|用它解释|试过一次|用在上|拿来算|套在)/
  items.push({
    check: '用得上吗',
    ok: used.test(t),
    why: used.test(t) ? '说了拿它用过一件事' : '没拿它解释过具体的事——那还只是「看过」',
  })

  const source = /(一手|二手|三手|据.{0,8}说|听.{0,6}说|出处|原文|第\s*\d+\s*行|文件是|网址|日期是|20\d\d-\d\d)/
  items.push({
    check: '出处可追吗',
    ok: source.test(t),
    why: source.test(t) ? '给了来源或几手' : '没给出处——追不回去的话，下次没法核对',
  })

  const expiry = /(还成立|已经过期|不再适用|什么情况下不成立|到.{0,8}就变了|有效期|那时候是|现在不同了)/
  items.push({
    check: '过期标了吗',
    ok: expiry.test(t),
    why: expiry.test(t) ? '标了现在还成不成立' : '没标过期——没标的知识会被一直当成真的用',
  })

  const conflict = /(跟.{0,10}(冲突|不一样|相反|打架)|原来那条|旧的说法|以.{0,6}为准|冲突时)/
  items.push({
    check: '打不打架',
    ok: conflict.test(t),
    why: conflict.test(t) ? '说了跟哪条打架、以谁为准' : '没跟已有的知识对一遍——打架了还不知道，比不知道更糟',
  })

  return { items, unprogammed: ['这条到底对不对——得拿现实核，代码只查它有没有成形'] }
}

/**
 * 58 · 认识：把知识拿进现场——获取、应用两步
 */
function assert58(text) {
  const t = String(text || '')
  const items = []

  const origin = /(从.{0,10}(来|读|看)|出处|原文|查过|验证|核对|第\s*\d+\s*行|复现)/
  items.push({
    check: '说得出它从哪来、怎么验证',
    ok: origin.test(t),
    why: origin.test(t) ? '说了来源与验证方式' : '说不出来源和验证——那还不是认识，是印象',
  })

  const link = /(跟.{0,10}(连|对上|一致|矛盾|接上)|原来的那条|已有的|之前那条|连上)/
  items.push({
    check: '跟我已经知道的哪一条连上了',
    ok: link.test(t),
    why: link.test(t) ? '接到了已知的一条上' : '没接上任何一条——孤立的一条，下次想不起来',
  })

  const where = /(用在|套在这|就这一处|在这里用|拿它处理|这一步用它)/
  items.push({
    check: '说得出用在这件事的哪一处',
    ok: where.test(t),
    why: where.test(t) ? '指到了用在哪一处' : '没说用在哪——没说用处，就还停在「懂了」',
  })

  const checked = /(对过|结果.{0,6}(对|错|不一样)|事后看|回头核|验证过|发现用错)/
  items.push({
    check: '用完之后对过结果吗',
    ok: checked.test(t),
    why: checked.test(t) ? '事后对了结果' : '用完没回头看——用对了还是用错了，现在还不知道',
  })

  const fix = /(改的是.{0,12}(知识|用法|规则|前提)|换的是.{0,10}(知识|用法)|错的不是知识|知识没错，是用法)/
  items.push({
    check: '用错时，改的是知识还是用法',
    ok: fix.test(t),
    why: fix.test(t) ? '分了是知识错还是用法错' : '没分——不分就把「用错了」全算到知识头上，或者全算到自己手上',
  })

  return { items, unprogammed: ['这一次到底认对了没有——得看它落到现实上的结果'] }
}

/**
 * 07 · 本我：现实先收钱，欲望排在后面
 */
function assert07(text) {
  const t = String(text || '')
  const items = []

  const noWay = /(没办法|没法|做不到|只能这样)/
  const threeParts = /(真硬|价太高|不想付|付不起)/
  if (noWay.test(t)) {
    items.push({
      check: '「没办法」过完三部分了吗',
      ok: threeParts.test(t),
      why: threeParts.test(t) ? '分清了是真硬／价太高／不想付' : '说了「没办法」，三格一个都没分——没过完不许说这三个字',
    })
  } else {
    items.push({ check: '「没办法」过完三部分了吗', ok: true, why: '没说「没办法」，这条不挡' })
  }

  const layer = /(身体|关系|自我|三层|哪一层|想被看见|想吃|想赢|怕疼)/
  items.push({
    check: '要的是哪一层',
    ok: layer.test(t),
    why: layer.test(t) ? '指到了欲望落在哪一层' : '没说在哪一层——说不出的，先别付价',
  })

  const price = /(代价|价是|要付|关掉|放弃.{0,8}(门|那条)|换来的|不值|谁付)/
  items.push({
    check: '价写出来了吗',
    ok: price.test(t),
    why: price.test(t) ? '写出了价，包括关掉的那扇门' : '没写价——不写价的想要，等于许愿',
  })

  const path = /(求助|改条件|改自己|改目标|改尺度|换条路|搁置|放弃|挑了.{0,8}一条)/
  items.push({
    check: '走的是哪条路',
    ok: path.test(t),
    why: path.test(t) ? '挑了一条具体的路' : '撞墙后没挑路——八条路一条没选，就还停在原地',
  })

  const dontWant = /(其实是不想|嫌贵|不愿花|懒得|不想付却说|不是做不到，是不想)/
  items.push({
    check: '是不是把「不想付」说成了「没办法」',
    ok: true,
    why: dontWant.test(t) ? '自己点出来了：是不想付' : (noWay.test(t) && !threeParts.test(t)
      ? '说了「没办法」却没分三格——最可能是把「不想付」混了进去'
      : '没看出替换'),
  })

  return { items, unprogammed: ['这个价我到底认不认——只能自己说，代码问不出来'] }
}

/**
 * 09 · 超我：标是校准线，不是棍子
 */
function assert09(text) {
  const t = String(text || '')
  const items = []

  const lanes = ['判据|怎么算成|标准是', '第一步|先做|下周一|明天就', '放弃条件|什么时候不干|到.{0,8}就停']
  const hit = lanes.filter((re) => new RegExp(re).test(t)).length
  items.push({
    check: '这是目标还是想要',
    ok: hit >= 2,
    why: hit >= 2 ? `三样里齐了两样以上（${hit}/3）` : '三样（判据／第一步／放弃条件）缺两条以上——那就只是「想要」',
  })

  const origin = /(捡来的|换来的|长出来的|自己长|过手|谁给的|价是)/
  items.push({
    check: '目标是哪个来源',
    ok: origin.test(t),
    why: origin.test(t) ? '说了目标从哪来' : '没说来源——捡来的没过手，会当成自己的',
  })

  const scale = /(一年|一辈子|放到.{0,10}(年|月)|换个尺度|长期看|十年的)/
  items.push({
    check: '换个尺度还成立吗',
    ok: scale.test(t),
    why: scale.test(t) ? '换过尺度' : '没换尺度——一顿饭的尺度上成立，放到一年里可能什么都不是',
  })

  const cannot = /(不能改口|不许改|就是对的|不接受.{0,8}反驳|定了)/
  items.push({
    check: '达成时还能改口吗',
    ok: !cannot.test(t),
    why: cannot.test(t) ? '这条理想不容改口——那就该进禁区' : '没有封死改口的口子',
  })

  const measure = /(你应该|他应该|你怎么不|他们都没|别人也得|凭什么不)/
  items.push({
    check: '有没有拿标去量别人',
    ok: !measure.test(t),
    why: measure.test(t) ? `出现了「${(t.match(measure) || [''])[0]}」——标一拿出去量人，就成了棍子` : '没拿标量人',
  })

  const alone = /(没人看|没人知道|独自|一个人也|私下也)/
  items.push({
    check: '没人看的时候也这么做吗',
    ok: true,
    why: alone.test(t) ? '提了没人看的时候' : '这一句没说人前还是人后，不挡；真想清楚得自己问一遍',
  })

  return { items, unprogammed: ['这条理想达成的瞬间，我会不会变成一块碑——只能自己盯'] }
}

/**
 * 能程序化的检查表。**一次加一条**；没加进来的模块，功能层只列判据，不假装跑过。
 */
export const ASSERTS = {
  '07': { name: '本我', run: assert07 },
  '09': { name: '超我', run: assert09 },
  '10': { name: '记忆', run: assert10 },
  '19': { name: '现实', run: assert19 },
  '20': { name: '具体', run: assert20 },
  '21': { name: '抽象', run: assert21 },
  '22': { name: '残余', run: assert22 },
  '24': { name: '语言', run: assert24 },
  '27': { name: '信息', run: assert27 },
  '28': { name: '知识', run: assert28 },
  '30': { name: '人性', run: assert30 },
  '32': { name: '真值', run: assert32 },
  '33': { name: '价值', run: assert33 },
  '46': { name: '模态', run: assert46 },
  '49': { name: '范围与绝对', run: assert49 },
  '53': { name: '元协调', run: assert53 },
  '56': { name: '逻辑', run: assert56 },
  '58': { name: '认识', run: assert58 },
  '62': { name: '独立人格', run: assert62 },
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
