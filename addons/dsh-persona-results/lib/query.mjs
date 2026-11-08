// 成果的查询层：按词搜、按 id/标题取全文。
// 参照 dsh-memory-board 的做法——面板里要能概览、搜索、追加；这里补的是「取全文」和「搜」，
// 不新增存储，不另开一份账。

const clip = (text, max) => {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}

const whenOf = (item) => {
  const t = String(item?.t ?? '')
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return t || '——'
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const tagsOf = (item) => (Array.isArray(item?.tags) ? item.tags.filter(Boolean) : [])

// 搜：标题、正文、标签、类型都算；按时间倒序。
export function searchItems(items, opts = {}) {
  const q = String(opts.q ?? '').trim().toLowerCase()
  const kind = String(opts.kind ?? '').trim()
  const limit = Math.max(1, Math.min(50, Number(opts.limit) || 10))
  let list = Array.isArray(items) ? items.slice() : []
  if (kind) list = list.filter((x) => String(x.kind ?? '') === kind)
  if (q) {
    list = list.filter((x) => {
      const hay = [x.title, x.body, kindOfTags(x), x.kind].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }
  list.sort((a, b) => String(b.t ?? '').localeCompare(String(a.t ?? '')))
  return { total: list.length, items: list.slice(0, limit) }
}

function kindOfTags(item) {
  const tags = tagsOf(item)
  return tags.length ? tags.join(' ') : ''
}

// 取一条：先按 id 精确，再按标题包含（取最新一条）。
export function findItem(items, key) {
  const k = String(key ?? '').trim()
  if (!k) return null
  const list = Array.isArray(items) ? items : []
  const byId = list.find((x) => String(x.id ?? '') === k)
  if (byId) return byId
  const lower = k.toLowerCase()
  const hits = list
    .filter((x) => String(x.title ?? '').toLowerCase().includes(lower))
    .sort((a, b) => String(b.t ?? '').localeCompare(String(a.t ?? '')))
  return hits[0] ?? null
}

export function renderShow(item) {
  if (!item) return '没找到这一条。'
  const tags = tagsOf(item)
  const head = `## ${item.title || '（无标题）'}`
  const meta = [
    `- ${whenOf(item)}`,
    `- 类型：${item.kind || '未标'}`,
    tags.length ? `- 标签：${tags.join(' / ')}` : '',
    `- id：${item.id || '——'}`,
  ].filter(Boolean)
  return [head, ...meta, '', String(item.body ?? '').trim() || '（正文是空的）'].join('\n')
}

export function renderSearch(result, q) {
  const { total, items } = result || { total: 0, items: [] }
  if (!total) return q ? `没有含「${q}」的条目。` : '还没有条目。'
  const head = q ? `含「${q}」的 ${total} 条，先看最近 ${items.length} 条：` : `共 ${total} 条，先看最近 ${items.length} 条：`
  const lines = [head]
  for (const item of items) {
    const tags = tagsOf(item)
    lines.push(
      `- [${item.kind || '未标'}] ${item.title || '（无标题）'}（${whenOf(item)}）`
        + `${tags.length ? ` · ${tags.join('/')}` : ''}`
        + ` · ${clip(item.body, 60)}`,
    )
  }
  lines.push('', `要全文：result_show key=<id 或标题里几个字>`)
  return lines.join('\n')
}
