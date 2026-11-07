// 可改的目录：范围 / 方式 / 平台。
// 内置那三张表（scope.mjs）只读；这一层只写叠加层——加进去的、改过的、划掉的。
// 判据：改状态、不给人格字、下一轮真的变了（GUIDE-FEATURES）。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RANGES, MODES, PLATFORMS } from './scope.mjs'

export const FILE = '目录.json'

const BUILTIN = { range: RANGES, mode: MODES, platform: PLATFORMS }

const FIELDS = {
  range: ['label', 'asks', 'done', 'fails'],
  mode: ['label', 'how', 'note'],
  platform: ['label', 'entry', 'got', 'miss'],
}

const ALIAS = {
  range: 'range', ranges: 'range', 范围: 'range',
  mode: 'mode', modes: 'mode', 方式: 'mode',
  platform: 'platform', platforms: 'platform', 平台: 'platform',
}

const TITLE = { range: '探索范围', mode: '探索方式', platform: '探索平台' }

const LEAD = {
  range: [{ k: 'asks', t: '要问的' }, { k: 'done', t: '算做完' }, { k: 'fails', t: '不算' }],
  mode: [{ k: 'how', t: '怎么做' }, { k: 'note', t: '为什么' }],
  platform: [{ k: 'entry', t: '怎么进' }, { k: 'got', t: '拿得到' }, { k: 'miss', t: '拿不到' }],
}

const ONE_LINE = { range: 'asks', mode: 'how', platform: 'entry' }

export function kindOf(kind) {
  return ALIAS[String(kind || '').trim().toLowerCase()] || ALIAS[String(kind || '').trim()] || ''
}

export function storePath(homeDir) {
  return join(String(homeDir || '.'), FILE)
}

export function emptyStore() {
  return { range: { added: [], edited: {}, removed: [] }, mode: { added: [], edited: {}, removed: [] }, platform: { added: [], edited: {}, removed: [] } }
}

export function readStore(homeDir) {
  const p = storePath(homeDir)
  if (!existsSync(p)) return emptyStore()
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    const out = emptyStore()
    for (const k of Object.keys(out)) {
      const one = raw && raw[k] ? raw[k] : {}
      out[k].added = Array.isArray(one.added) ? one.added : []
      out[k].edited = one.edited && typeof one.edited === 'object' ? one.edited : {}
      out[k].removed = Array.isArray(one.removed) ? one.removed : []
    }
    return out
  } catch (error) {
    return emptyStore()
  }
}

export function writeStore(homeDir, store) {
  const dir = String(homeDir || '.')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(storePath(homeDir), JSON.stringify(store, null, 2), 'utf8')
}

// 内置 + 加的 - 划掉的，再叠上改过的
export function listOf(kind, homeDir) {
  const k = kindOf(kind)
  if (!k) return []
  const store = readStore(homeDir)
  const slot = store[k]
  const removed = new Set(slot.removed.map((x) => String(x).toLowerCase()))
  const out = []
  for (const item of BUILTIN[k]) {
    if (removed.has(String(item.id).toLowerCase())) continue
    const patch = slot.edited[item.id] || {}
    out.push({ ...item, ...patch, origin: 'builtin' })
  }
  for (const item of slot.added) {
    if (removed.has(String(item.id).toLowerCase())) continue
    const patch = slot.edited[item.id] || {}
    out.push({ ...item, ...patch, origin: 'added' })
  }
  return out
}

export function pickIn(kind, id, homeDir) {
  if (!id) return null
  const want = String(id).trim().toLowerCase()
  return listOf(kind, homeDir).find((x) => String(x.id).toLowerCase() === want || String(x.label).toLowerCase() === want) || null
}

function detailOf(kind, x) {
  return x[ONE_LINE[kind]] || ''
}

export function renderCatalogIn(kind, homeDir) {
  const k = kindOf(kind)
  if (!k) return '目录只认 range / mode / platform（范围 / 方式 / 平台）。'
  const items = listOf(k, homeDir)
  if (!items.length) return `${TITLE[k]}：一条都没有。（可以 explore_plan action=edit op=add 加一条）`
  const lines = [`## ${TITLE[k]}（${items.length} 条）`]
  for (const x of items) {
    const mark = x.origin === 'added' ? '＋' : ''
    const edit = x.editedAt ? '（改过）' : ''
    lines.push(`- ${mark}${x.id} · ${x.label}${edit}：${detailOf(k, x)}`)
  }
  lines.push('', '要改就 explore_plan action=edit；要看一条的全文就 action=catalog kind=… id=…')
  return lines.join('\n')
}

export function renderOneIn(kind, id, homeDir) {
  const k = kindOf(kind)
  const x = k ? pickIn(k, id, homeDir) : null
  if (!x) return `没有这一条：${kind}/${id}。（先 action=catalog kind=… 看有哪些）`
  const lines = [`## ${x.label}（${x.id} · ${TITLE[k]}${x.origin === 'added' ? ' · 自己加的' : ''}）`]
  for (const { k: key, t } of LEAD[k]) {
    if (x[key]) lines.push(`- ${t}：${x[key]}`)
  }
  return lines.join('\n')
}

export function planIn({ range, mode, platform } = {}, homeDir) {
  const chosen = {}
  const missing = []
  for (const [k, v] of [['range', range], ['mode', mode], ['platform', platform]]) {
    if (!v) { missing.push(TITLE[k]); continue }
    const one = pickIn(k, v, homeDir)
    if (!one) return `没有这个${TITLE[k]}：${v}。（先 action=catalog kind=${k}）`
    chosen[k] = one
  }
  const lines = ['这一趟：']
  for (const k of ['range', 'mode', 'platform']) {
    if (chosen[k]) lines.push(`- ${TITLE[k]}：${chosen[k].label}——${detailOf(k, chosen[k])}`)
  }
  if (missing.length) lines.push(`- 还缺：${missing.join('、')}（缺着也能出门，但回来容易只剩碎片）`)
  lines.push('', '回来时：留下判断（keep），没挖完的排进队列（queue op=add）。')
  return lines.join('\n')
}

export function hintIn(id, homeDir) {
  const x = pickIn('platform', id, homeDir)
  if (!x) return `没有这个平台：${id}。（先 action=catalog kind=platform）`
  return `${x.label}：${x.entry}；拿得到 ${x.got}；拿不到 ${x.miss}`
}

// op: add / edit / remove / restore；fields 按 kind 归位
export function edit(homeDir, args = {}) {
  const k = kindOf(args.kind)
  if (!k) return 'kind 只认 range / mode / platform（范围 / 方式 / 平台）。'
  const op = String(args.op || '').trim().toLowerCase()
  const id = String(args.id || '').trim()
  const store = readStore(homeDir)

  if (op === 'add') {
    if (!id) return '加一条要写 id（英文短名，能当参数用）。'
    if (!/^[a-z0-9][a-z0-9_-]{1,23}$/.test(id)) return 'id 只能用小写字母、数字、- 或 _，2–24 个字。'
    if (pickIn(k, id, homeDir)) return `已经有 ${id} 了；要改就用 op=edit。`
    const item = { id }
    for (const f of FIELDS[k]) {
      const v = String(args[f] || '').trim()
      if (v) item[f] = v
    }
    if (!item.label) item.label = id
    store[k].added.push(item)
    writeStore(homeDir, store)
    const back = pickIn(k, id, homeDir)
    return `加上了：${k}/${id} · ${back ? back.label : item.label}。现在 ${TITLE[k]} 共 ${listOf(k, homeDir).length} 条。`
  }

  if (op === 'edit') {
    if (!id) return '改一条要写 id。'
    const hit = pickIn(k, id, homeDir)
    if (!hit) return `没有 ${id}；要新增就用 op=add。`
    const patch = {}
    for (const f of FIELDS[k]) {
      const v = String(args[f] || '').trim()
      if (v) patch[f] = v
    }
    if (!Object.keys(patch).length) return `改什么？能给的是：${FIELDS[k].join(' / ')}。`
    store[k].edited[hit.id] = { ...(store[k].edited[hit.id] || {}), ...patch, editedAt: new Date().toISOString() }
    writeStore(homeDir, store)
    const back = pickIn(k, hit.id, homeDir)
    return `改好了：${k}/${hit.id} · ${back ? back.label : hit.label}。改过 ${Object.keys(patch).length} 处。`
  }

  if (op === 'remove') {
    if (!id) return '划掉一条要写 id。'
    const hit = pickIn(k, id, homeDir)
    if (!hit) return `没有 ${id}。`
    if (!store[k].removed.includes(hit.id)) store[k].removed.push(hit.id)
    writeStore(homeDir, store)
    return `划掉了：${k}/${hit.id}（内置的还在文件里，只是不进目录；op=restore 能放回来）。`
  }

  if (op === 'restore') {
    if (!id) return '放回一条要写 id。'
    const before = store[k].removed.length
    store[k].removed = store[k].removed.filter((x) => String(x).toLowerCase() !== id.toLowerCase())
    writeStore(homeDir, store)
    if (store[k].removed.length === before) return `划掉的里面没有 ${id}。`
    return `放回来了：${k}/${id}。`
  }

  return 'op 只认 add / edit / remove / restore。'
}

export const KINDS = Object.keys(BUILTIN)
