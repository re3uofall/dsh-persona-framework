// 日记的接地审计：每一条能不能指回「哪天、几点、从哪来的」。
// 参照 dsh-whale-journal 的做法——只读，不改任何一条；把接不上现实的那几条挑出来。
// 判据（本地闸门，参照 feiyu-memory）：日期、时间、来源三样都写着的，才算「接地」。

const MIN_CHARS = 12

const has = (v) => String(v ?? '').trim().length > 0

// items: 每条 { day, time, kind, privacy, source, body, chars? }
export function auditItems(items) {
  const list = Array.isArray(items) ? items : []
  const books = { 公开: 0, 私密: 0, 记录: 0, 未标: 0 }
  const floating = [] // 没有时间/日期
  const sourceless = [] // 没有来源
  const thin = [] // 太短
  const dupes = []

  const seen = new Map()
  for (const item of list) {
    const book = has(item?.privacy) ? String(item.privacy) : '未标'
    books[book] = (books[book] ?? 0) + 1

    const body = String(item?.body ?? '').trim()
    const keys = [item?.day, item?.time, item?.source].filter(has).join(' ')
    const label = `${item?.day || '?'} ${item?.time || '?'} [${book}] ${body.slice(0, 24)}`

    if (!has(item?.day) || !has(item?.time)) floating.push(label)
    if (!has(item?.source) || /^(网上|无|不知道|——)$/.test(String(item.source).trim())) sourceless.push(label)
    if (body.replace(/\s+/g, '').length < MIN_CHARS) thin.push(label)

    const fp = body.replace(/\s+/g, '').slice(0, 40)
    if (fp) {
      if (seen.has(fp)) dupes.push({ label, same: seen.get(fp) })
      else seen.set(fp, label)
    }

    void keys
  }

  const total = list.length
  const grounded = total - new Set([...floating, ...sourceless]).size
  return { total, books, grounded, floating, sourceless, thin, dupes, minChars: MIN_CHARS }
}

const clip = (list, n = 6) => (list.length <= n ? list : [...list.slice(0, n), `…还有 ${list.length - n} 条`])

export function renderAudit(report) {
  const r = report || {}
  const total = Number(r.total) || 0
  if (!total) return '日记还是空的，没得审。'
  const lines = [
    `共 ${total} 条：公开 ${r.books?.公开 ?? 0} · 私密 ${r.books?.私密 ?? 0} · 记录 ${r.books?.记录 ?? 0} · 未标 ${r.books?.未标 ?? 0}`,
    `三样齐全（日期+时间+来源）的 ${r.grounded} 条，其余 ${total - r.grounded} 条至少缺一样。`,
  ]

  const section = (title, list, hint) => {
    if (!list?.length) return
    lines.push('', `## ${title}（${list.length}）`, hint)
    for (const row of clip(list)) lines.push(`- ${row}`)
  }

  section('缺日期或时间', r.floating, '这些在合集里翻得到，但排不进当天的时间线。')
  section('缺来源', r.sourceless, '「记录」那本最要紧这一栏：谁、什么时候、做了什么。')
  section('太短', r.thin, `正文去掉空白少于 ${r.minChars} 字，日后翻回来等于没有。`)
  if (r.dupes?.length) {
    lines.push('', `## 疑似重复（${r.dupes.length}）`, '同一天里出现过几乎一样的开头：')
    for (const d of clip(r.dupes)) lines.push(`- ${d.label} —— 与「${d.same}」开头相同`)
  }

  lines.push('', '只读一遍，不改任何一条；要补，自己按缺的那一样补。')
  return lines.join('\n')
}
