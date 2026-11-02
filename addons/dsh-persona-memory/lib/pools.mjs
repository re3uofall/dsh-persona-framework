/**
 * 记忆池：分类、统计、分层、归档。
 *
 * 这一层的判断只有一条：**流水不是记忆**。
 * 一轮对话的全文是流水（journal）；从中提炼的一句才是记忆（judgment）。
 * 两者放同一个池里，检索时流水会淹掉判断——池子越大，淹得越狠，
 * 而人只看到「想不起来的变多了」，以为是记忆不行了。
 *
 * 所以这个文件做三件事：
 *   1. 按「层」给池分权重（判断层高、流水层低）
 *   2. 按字节统计划出谁在吃预算
 *   3. 把超期的流水挪进 _archive/，不再参与检索
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, renameSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

/**
 * 默认分层。名字是通用的，谁都能改。
 *
 * - **judgment**：提炼过的判断，检索主来源
 * - **theory**：理论、词汇、世界理解
 * - **external**：外部整合（网上读的、别人给的）
 * - **journal**：流水，原文，每轮一条
 * - **raw**：更早的流水，归档区，默认不检索
 */
export const DEFAULT_LAYERS = {
  judgment: { weight: 1, label: '判断层', dirs: ['knowledge'] },
  theory: { weight: 0.8, label: '理论层', dirs: ['persona-ai/knowledge/world', 'persona-ai/knowledge/lexicon'] },
  external: { weight: 0.6, label: '外部层', dirs: ['persona-ai/knowledge/web', 'persona-ai/knowledge/human', '.persona-framework/net'] },
  journal: { weight: 0.25, label: '流水层', dirs: ['persona-ai/knowledge/session'] },
  raw: { weight: 0, label: '归档层', dirs: ['persona-ai/knowledge/_archive'] },
}

const MD = /\.md$/i

function listMd(dir) {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir).filter((f) => MD.test(f)).map((f) => join(dir, f))
  } catch {
    return []
  }
}

/**
 * 数一个文件：字节、字数、行数、mtime。
 *
 * ★ 一条来自 ECHO 坑 3 的纪律（`cyanwell/dsh-agent-soul`）：
 *   **凡是「整个文件读进来再处理」的地方，先问一句「它可能有多大」。**
 *   原来这里无条件 readFileSync —— 统计 55 个文件就把 57 万字全塞进内存，
 *   池子再长下去就是那个 512 MB 字符串上限的雷。
 *
 * 现在分两档：
 *   · 小文件（<= 64 KB）：读内容，字数精确。
 *   · 大文件：只 stat，字数按 UTF-8 估（中文 3 字节约 1 字）。
 *     估得不准，但统计只要「谁在吃预算」这个量级，不需要精确到个位。
 *     要精确字数的场合（提炼、取片段）自己读——那本来就只读一两个文件。
 */
const SMALL = 64 * 1024

/**
 * 「实质内容」有多少字——去掉标题行、引用行、front matter、空行、分隔线之后剩下的。
 *
 * ★ 为什么要有这个数：`同一论.md` 全文只有一个 `#`，`自因与差异.md` 10 个字。
 *   它们字数字符数不为零，所以原来的 recall 照样抓、照样占预算，然后**什么都不给**。
 *   **一个文件在，不等于它有内容。** 索引里有、正文是壳——这是最坏的一种「有」：
 *   它让「池子里有 29 个理论文件」听起来像有钱，其实一半是空的。
 */
export function substantiveChars(text) {
  const lines = String(text || '').split('\n')
  let inFm = false
  let body = 0
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i].trim()
    if (!l) continue
    if (i === 0 && l === '---') { inFm = true; continue }
    if (inFm) { if (l === '---') inFm = false; continue }
    if (l.startsWith('#')) continue        // 标题不是内容
    if (l.startsWith('>')) continue        // 引用块是元信息
    if (/^[-*_]{3,}$/.test(l)) continue    // 分隔线
    body += l.length
  }
  return body
}

export function measure(file) {
  try {
    const st = statSync(file)
    if (st.size <= SMALL) {
      const text = readFileSync(file, 'utf8')
      return {
        path: file,
        bytes: st.size,
        chars: Math.round(text.length),
        substantive: substantiveChars(text),
        lines: text.split('\n').length,
        mtime: st.mtime.toISOString().slice(0, 10),
        exact: true,
      }
    }
    // 大文件：读头部 8 KB 采样，算「字节 / 字」的真实比例，再乘总字节。
    // 硬按 3 字节/字估会低估 25%（中文混着标点、英文、代码），实测过。
    const SAMPLE = 8192
    let ratio = 3
    let fd = -1
    try {
      fd = openSync(file, 'r')
      const buf = Buffer.allocUnsafe(SAMPLE)
      const n = readSync(fd, buf, 0, SAMPLE, 0)
      if (n > 0) {
        const head = buf.subarray(0, n).toString('utf8')
        // 尾部可能切在多字节字符中间，去掉最后一个不完整的字符再算
        const safe = head.slice(0, Math.max(1, head.length - 1))
        if (safe.length > 100) ratio = n / safe.length
      }
    } catch { /* 读不到就用默认比例 */ }
    finally { if (fd >= 0) { try { closeSync(fd) } catch { /* ignore */ } } }
    return {
      path: file,
      bytes: st.size,
      chars: Math.round(st.size / ratio),
      // 大文件不读全文，实质字数按总字数估（流水以正文为主，标题占比很小）
      substantive: Math.round(st.size / ratio),
      lines: 0,
      mtime: st.mtime.toISOString().slice(0, 10),
      exact: false,
    }
  } catch {
    return { path: file, bytes: 0, chars: 0, substantive: 0, lines: 0, mtime: '', exact: false }
  }
}

/**
 * 扫整个记忆根，按层归类。
 * @param {string} root  工作区根
 * @param {object} layers  可覆盖 DEFAULT_LAYERS
 */
export function scanPools(root, layers = DEFAULT_LAYERS) {
  const out = []
  for (const [key, cfg] of Object.entries(layers)) {
    const files = []
    for (const rel of cfg.dirs) {
      for (const f of listMd(join(root, rel))) files.push(measure(f))
    }
    const total = files.reduce((a, b) => a + b.chars, 0)
    out.push({
      key,
      label: cfg.label,
      weight: cfg.weight,
      dirs: cfg.dirs,
      count: files.length,
      chars: total,
      files: files.sort((a, b) => b.chars - a.chars),
    })
  }
  const all = out.reduce((a, b) => a + b.chars, 0)
  for (const p of out) p.share = all ? p.chars / all : 0
  return { pools: out, totalChars: all, totalFiles: out.reduce((a, b) => a + b.count, 0) }
}

/** 渲染成一张能一眼看出「谁在吃预算」的表。 */
export function renderPools(scan) {
  // ★ 全新的工作区：一个文件都没有。这时候别只给空表格——告诉人从哪开始。
  if (!scan?.pools?.some((p) => p.count > 0)) {
    return [
      '记忆池：还是空的。',
      '',
      '这不是坏了——刚装上都这样。它是从你自己的对话里长出来的：',
      '  · 判断层（knowledge/）：想住的判断，一条一个文件',
      '  · 流水层（persona-ai/knowledge/session/）：每天一档，先聊几轮就有了',
      '  · 理论层 / 外部层 / 联网池：想建再建，不建也能跑',
      '',
      '先聊几轮，再回来看这里。目录可以空着，结构不用一次建齐。',
    ].join('\n')
  }
  const approx = scan.pools.some((p) => p.files.some((f) => f.exact === false))
  const lines = [
    `记忆池：${scan.totalFiles} 个文件，合计 ${scan.totalChars.toLocaleString()} 字`
      + (approx ? '（大文件为估算，误差约 ±10%）' : ''),
    '',
    '| 层 | 文件 | 字数 | 占比 | 检索权重 |',
    '| --- | --- | --- | --- | --- |',
  ]
  for (const p of scan.pools) {
    if (!p.count) continue
    lines.push(`| ${p.label}（${p.key}） | ${p.count} | ${p.chars.toLocaleString()} | ${Math.round(p.share * 100)}% | ${p.weight} |`)
  }
  const journal = scan.pools.find((p) => p.key === 'journal')
  if (journal && journal.share > 0.5) {
    lines.push(
      '',
      `⚠ **流水层占 ${Math.round(journal.share * 100)}%**——它一份不参与检索都该丢掉大半。`,
      `  检索时它按 ${journal.weight} 权重，也就是说 ${journal.chars.toLocaleString()} 字里只有约 ${Math.round(journal.chars * journal.weight).toLocaleString()} 字算数。`,
      '  要压它就调 `archiveAfterDays`，或改用 `memory_archive`。',
      '',
      '  （大文件不读内容，只读头部 8 KB 采比例再乘字节数——统计只要「谁在吃预算」这个量级，',
      '   不需要精确到个位。要精确字数的场合自己读那一两个文件。）',
    )
  }
  return lines.join('\n')
}

/**
 * 归档：把流水层里 mtime 早于 N 天的文件挪进 `_archive/`。
 * 不动内容，只挪位置；挪完流水层不再检索它，归档层权重 0。
 *
 * @param {string} root
 * @param {{days?: number, dryRun?: boolean, layers?: object}} opts
 */
export function archiveOld(root, opts = {}) {
  const days = Number(opts.days ?? 7)
  const dryRun = opts.dryRun !== false
  const layers = opts.layers || DEFAULT_LAYERS
  const cutoff = Date.now() - days * 86400_000
  const journal = layers.journal
  const moved = []
  const archiveDir = join(root, 'persona-ai/knowledge/_archive')

  for (const rel of journal.dirs) {
    const dir = join(root, rel)
    if (!existsSync(dir)) continue
    for (const f of listMd(dir)) {
      let st
      try { st = statSync(f) } catch { continue }
      if (st.mtimeMs >= cutoff) continue
      const target = join(archiveDir, basename(dir), basename(f))
      moved.push({ from: f, to: target, chars: Math.round(readFileSync(f, 'utf8').length) })
      if (!dryRun) {
        mkdirSync(join(archiveDir, basename(dir)), { recursive: true })
        try { renameSync(f, target) } catch { /* 跨盘或权限问题就留着 */ }
      }
    }
  }
  moved.sort((a, b) => b.chars - a.chars)
  return {
    days,
    dryRun,
    moved,
    chars: moved.reduce((a, b) => a + b.chars, 0),
    archiveDir,
  }
}

export function renderArchive(r) {
  const head = r.dryRun
    ? `归档（干跑）：早于 ${r.days} 天的流水共 ${r.moved.length} 个文件，${r.chars.toLocaleString()} 字`
    : `归档：已挪走 ${r.moved.length} 个文件，${r.chars.toLocaleString()} 字 → ${r.archiveDir}`
  const lines = [head, '']
  for (const m of r.moved.slice(0, 15)) {
    lines.push(`  ${basename(m.from)}（${m.chars.toLocaleString()} 字）`)
  }
  if (r.moved.length > 15) lines.push(`  ……还有 ${r.moved.length - 15} 个`)
  if (r.dryRun && r.moved.length) {
    lines.push('', '干跑不动文件。真要挪，加 dryRun=false。')
  }
  if (!r.moved.length) lines.push('没有需要归档的——都还在时间窗里。')
  return lines.join('\n')
}

/**
 * 按预算取记忆：从各层按权重轮流取，直到预算用完。
 *
 * 这是「检索」不是「全量读」：流水层权重低，所以同样预算下它分到的字少，
 * 判断层先被拿满。预算用完就停，不因为池子大而变慢。
 *
 * @param {string} root
 * @param {{budget?: number, query?: string, layers?: object}} opts
 */
export function recall(root, opts = {}) {
  const budget = Math.max(200, Number(opts.budget ?? 2000))
  const q = String(opts.query || '').trim()
  const layers = opts.layers || DEFAULT_LAYERS
  const scan = scanPools(root, layers)

  /**
   * 加固：同一层里谁先浮。
   *
   * ★ 这一行是「加固」整套东西唯一的落点。
   *   加固不碰字节、不改权重、不改预算——**它只改同层内的先后**。
   *   所以它对层与层之间的次序一格都不动：层是有理由排的，加固没资格重排它。
   *
   * `opts.reinforce` 是一个函数：给一个文件（含 path / mtime / chars），返回分数。
   * 传不进来就按老样子（字数大的先）。
   */
  if (typeof opts.reinforce === 'function') {
    for (const p of scan.pools) {
      p.files = p.files.slice().sort((a, b) => {
        const sa = Number(opts.reinforce(a)) || 0
        const sb = Number(opts.reinforce(b)) || 0
        if (sb !== sa) return sb - sa
        return b.chars - a.chars
      })
    }
  }

  // 每层的预算 = 总预算 × 权重（再按该层实际字数封顶）；流水层最后一个拿
  const order = Object.keys(layers).sort((a, b) => layers[b].weight - layers[a].weight)
  const picked = []
  const skipped = []   // 空壳：在池子里但没内容
  let left = budget

  for (const key of order) {
    const p = scan.pools.find((x) => x.key === key)
    if (!p || !p.count || p.weight <= 0) continue
    let share = Math.round(budget * p.weight)
    if (key === 'journal') share = Math.min(share, Math.round(budget * 0.15))
    for (const f of p.files) {
      if (left <= 0 || share <= 0) break
      // ★ 空壳跳过：实质内容少于阈值的不取——它在池子里，但它没话可说。
      //   不跳过的话，它会占掉预算、返回一片空白，看起来像「记忆里没东西」。
      const real = f.substantive ?? f.chars ?? 0
      if (real < (opts.minSubstantive ?? 20)) {
        skipped.push({ layer: key, label: p.label, path: f.path, chars: f.chars, substantive: real })
        continue
      }
      let text = ''
      try { text = readFileSync(f.path, 'utf8') } catch { continue }
      if (q && !text.includes(q)) continue
      // 一个文件只取前 share 字（截断处按行退一格，免得半句话）
      const cut = Math.min(share, left, text.length)
      const body = cut >= text.length ? text : text.slice(0, cut).replace(/\n[^\n]*$/, '\n…')
      picked.push({ layer: key, label: p.label, path: f.path, chars: body.length, text: body })
      left -= body.length
      share -= body.length
    }
  }
  return { budget, used: budget - left, picked, skipped, scan }
}

export function renderRecall(r) {
  const lines = [`按预算取记忆：给 ${r.budget} 字，用了 ${r.used} 字，${r.picked.length} 段`, '']
  if (!r.picked.length) {
    lines.push('没取到。两种可能：池子是空的，或者 query 一个文件都没命中。')
    return lines.join('\n')
  }
  for (const seg of r.picked) {
    lines.push(`--- [${seg.label}] ${basename(seg.path)}（${seg.chars} 字）---`)
    lines.push(seg.text.trim())
    lines.push('')
  }
  // ★ 空壳要说出来：不然「只取到 2 段」看着像池子穷，其实是三个文件在装死
  if (r.skipped && r.skipped.length) {
    lines.push(`跳过 ${r.skipped.length} 个空壳（实质内容不到 20 字，取出来也是白的）：`)
    for (const x of r.skipped.slice(0, 8)) {
      lines.push(`  ${basename(x.path)}——字符 ${x.chars}，实质 ${x.substantive}`)
    }
    if (r.skipped.length > 8) lines.push(`  ……还有 ${r.skipped.length - 8} 个`)
  }
  return lines.join('\n')
}
