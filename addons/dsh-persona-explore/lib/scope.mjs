/**
 * 探索的三个维度：范围（找什么）、方式（怎么找）、平台（去哪找）。
 * ============================================================================
 * 一条探索不是「搜个词」就完事。同一句话，换个范围是另一件事，换个方式是
 * 另一条路，换个平台是另一批人。三个维度各列一遍，选的时候才不是凭手感。
 *
 * 每个条目都是一句话能说清的判据，不是标签。选不出判据，说明这一趟还没想清。
 * ============================================================================
 */

/** 范围：这一趟到底要拿回哪一种东西。 */
export const RANGES = [
  {
    id: 'fact',
    label: '事实核对',
    asks: '这句话本来是谁说的、原句是什么、有没有被转述改过。',
    done: '拿到原句和出处（链接／页码／时间），能逐字对上。',
    fails: '只拿到二手概括，或者「大家都这么说」。',
  },
  {
    id: 'how',
    label: '做法与操作',
    asks: '这件事具体怎么做，步骤、参数、前置条件是什么。',
    done: '能在自己的机器上照做一遍，并且知道哪一步最容易失败。',
    fails: '只有原理没有步骤，或者步骤跳过前置条件。',
  },
  {
    id: 'counter',
    label: '反例与争论',
    asks: '反对这一说法的最强论证是什么。',
    done: '说得出对方最强的那一句，而不是最弱的那一句。',
    fails: '找到的全是支持自己看法的（那只是找证人）。',
  },
  {
    id: 'primary',
    label: '原始材料',
    asks: '论文、规范、源码、官方文档本身怎么写的。',
    done: '读到原文那一节，能指出行号／章节。',
    fails: '读的是博客对论文的转述，却当成论文。',
  },
  {
    id: 'lineage',
    label: '人物与流派',
    asks: '谁提出的、后来谁改了、现在谁在反对。',
    done: '说得出两三个名字和他们各自的分歧点。',
    fails: '只记住了一个名字，且不知道他后来改口过。',
  },
  {
    id: 'timeline',
    label: '时间线',
    asks: '什么时候变的、变之前是什么样。',
    done: '给出至少两个带日期的事实，能排出先后。',
    fails: '把「最近」当成具体时间。',
  },
  {
    id: 'limit',
    label: '边界与失灵',
    asks: '这一套在什么条件下不成立、出错是什么样。',
    done: '写得出至少一个具体失败场景，以及怎么认出来。',
    fails: '只记住了它好用的一面。',
  },
]

/** 方式：怎么走这一趟。方式决定回来的是判断还是碎片。 */
export const MODES = [
  {
    id: 'narrow',
    label: '窄词直搜',
    how: '一句具体的问题当搜索词，别用大词。',
    note: '回来的少，但每条都对题；宽词回来的多是噪声。',
  },
  {
    id: 'rephrase',
    label: '换措辞重搜',
    how: '同一个意思换三种说法各搜一次，看哪一批对得上。',
    note: '对不上，说明这个词本身还没定下来。',
  },
  {
    id: 'against',
    label: '反向搜索',
    how: '搜「X 的问题 / X 错在哪 / X 的批评」。',
    note: '专门治偏食：只搜支持自己的，等于去取证。',
  },
  {
    id: 'follow',
    label: '顺引用走',
    how: '从一篇好文章的参考文献往上追一层。',
    note: '追到的往往是原始材料；追两层以上容易走丢。',
  },
  {
    id: 'origin',
    label: '找出处',
    how: '把一句话的出处一路追到最早那一份。',
    note: '中途那份多半已经改过口吻。',
  },
  {
    id: 'cross',
    label: '交叉验证',
    how: '两个互不引用的来源说同一件事，才算站住。',
    note: '互相引用的两个来源，其实是一个。',
  },
  {
    id: 'translate',
    label: '换语言搜',
    how: '把问题翻成英文（必要时日文）再搜一遍。',
    note: '中文圈没写的东西，常常只是没被翻译。',
  },
]

/** 平台：去哪一批人那里找。每个平台都写清「怎么进」和「什么拿不到」。 */
export const PLATFORMS = [
  {
    id: 'web',
    label: '通用网页',
    entry: 'web 服务的 search / fetch',
    got: '新闻、博客、百科、多数官方文档。',
    miss: '要登录的内容、纯脚本渲染的页面、PDF 里的正文。',
  },
  {
    id: 'github',
    label: 'GitHub',
    entry: 'api.github.com 可用（网页 github.com 在这台机器上被拦）',
    got: '仓库结构、README、release、issue、代码原文。',
    miss: '网页版搜索、raw.githubusercontent.com、git clone。',
  },
  {
    id: 'npm',
    label: 'npm registry',
    entry: 'registry.npmjs.org 可用',
    got: '包的元数据、版本历史、依赖、README。',
    miss: '源码要另找仓库；被墙的 tarball 域名。',
  },
  {
    id: 'arxiv',
    label: 'arXiv / 论文站',
    entry: '网页抓摘要页，或找 PDF 转文本',
    got: '摘要、版本时间、作者。',
    miss: 'PDF 正文（这个插件的 read 只啃 HTML）。',
  },
  {
    id: 'wiki',
    label: '维基 / 百科',
    entry: '网页直接读',
    got: '时间线、名词、争议各方的名字。',
    miss: '原始出处（要顺着脚注再走一层）。',
  },
  {
    id: 'forum',
    label: '论坛与问答',
    entry: '网页直接读',
    got: '实际踩过的坑、失败细节。',
    miss: '正确性（这里的话要另找一手核对）。',
  },
  {
    id: 'video',
    label: '视频与播客',
    entry: '拿不到字幕就只能靠标题与简介',
    got: '谁在讲、讲了什么方向。',
    miss: '逐字内容；没有字幕时几乎读不到正文。',
  },
]

const ALL = { range: RANGES, mode: MODES, platform: PLATFORMS }

const kindOf = (kind) => {
  const k = String(kind || '').trim().toLowerCase()
  if (k === 'range' || k === 'ranges' || k === '范围') return 'range'
  if (k === 'mode' || k === 'modes' || k === '方式') return 'mode'
  if (k === 'platform' || k === 'platforms' || k === '平台') return 'platform'
  return ''
}

/** 按 id 或中文名找一条；找不到回 null，不猜。 */
export function pick(kind, id) {
  const k = kindOf(kind)
  if (!k) return null
  const key = String(id || '').trim().toLowerCase()
  if (!key) return null
  return ALL[k].find((x) => x.id === key || x.label === String(id).trim()) || null
}

/** 列一份清单：id、名字、一句判据。 */
export function renderCatalog(kind) {
  const k = kindOf(kind)
  if (!k) return '只看这三样：range（找什么）／mode（怎么找）／platform（去哪找）。'
  const title = k === 'range' ? '探索范围' : k === 'mode' ? '探索方式' : '探索平台'
  const lines = [`${title}（${ALL[k].length} 条）：`]
  for (const x of ALL[k]) {
    const head = `${x.id} · ${x.label}`
    const detail = k === 'range' ? x.asks : k === 'mode' ? x.how : x.entry
    lines.push(`- ${head}：${detail}`)
  }
  lines.push('', '要看一条的全文：explore action=scope kind=' + k + ' id=…')
  return lines.join('\n')
}

/** 一条的全文：判据、怎么算做完、什么算失败（平台换成能拿到／拿不到）。 */
export function renderOne(kind, id) {
  const x = pick(kind, id)
  if (!x) return `没有这一条：${String(id || '')}。先 explore action=scope kind=${kindOf(kind) || 'range'} 看清单。`
  const k = kindOf(kind)
  const lines = [`${x.label}（${k === 'range' ? '范围' : k === 'mode' ? '方式' : '平台'} · ${x.id}）`]
  if (k === 'range') {
    lines.push(`要问的：${x.asks}`, `算做完：${x.done}`, `不算：${x.fails}`)
  } else if (k === 'mode') {
    lines.push(`怎么做：${x.how}`, `为什么：${x.note}`)
  } else {
    lines.push(`怎么进：${x.entry}`, `拿得到：${x.got}`, `拿不到：${x.miss}`)
  }
  return lines.join('\n')
}

/**
 * 三个维度拼成这一趟的做法。缺哪个维度就明说缺，不替它补。
 * 返回的是「怎么做」，不是「要不要做」——要不要做是她自己的事。
 */
export function planOf({ range, mode, platform } = {}) {
  const r = range ? pick('range', range) : null
  const m = mode ? pick('mode', mode) : null
  const pf = platform ? pick('platform', platform) : null
  const missing = []
  if (!r) missing.push('范围')
  if (!m) missing.push('方式')
  if (!pf) missing.push('平台')
  const lines = ['这一趟：']
  if (r) lines.push(`- 范围：${r.label}——${r.asks}（做完的标准：${r.done}）`)
  if (m) lines.push(`- 方式：${m.label}——${m.how}`)
  if (pf) lines.push(`- 平台：${pf.label}——${pf.entry}；拿不到：${pf.miss}`)
  if (missing.length) lines.push(`- 还缺：${missing.join('、')}（缺着也能出门，但回来容易只剩碎片）`)
  if (pf) lines.push(`- 收工：一条只讲一件事，写顶掉了哪句旧话、还不服什么。`)
  return lines.join('\n')
}

/** 平台提示：搜之前先知道这台机器上哪个门开、哪个门关。 */
export function platformHint(id) {
  const x = pick('platform', id)
  if (!x) return ''
  return `${x.label}：${x.entry}；拿得到 ${x.got}；拿不到 ${x.miss}`
}

export const KINDS = Object.keys(ALL)
