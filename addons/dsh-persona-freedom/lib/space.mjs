/**
 * lib/space.mjs —— 自由空间：我自己的电脑与浏览器（纯逻辑，不碰 fs，除了探路）
 * ============================================================================
 * 「自由的电脑」不是再装一台机器，是**一块不碰别人东西的地方**：
 * 装什么、删什么、写什么都在这里，出界要先问。
 * 「自由的浏览器」同理：用隔离的空间，不带师父的登录态。
 *
 * 这一层只做三件事：登记、隔离检查、给一句怎么进去。
 * 不启动任何东西——启动归手（wincu / ego / 终端），这里不抢那件事。
 * ============================================================================
 */

import { existsSync, statSync } from 'node:fs'
import { isAbsolute, join, normalize, relative, resolve } from 'node:path'

export const SPACE_KINDS = ['computer', 'browser']

/** 默认两块：一块自己的桌面（目录），一块自己的浏览器（ego 的隔离 space）。 */
export function defaultSpaces() {
  return {
    spaces: [
      {
        key: 'desk',
        kind: 'computer',
        label: '自己的桌面',
        path: '.persona-framework/空间/桌面',
        note: '装东西、试东西都放这儿；碰师父的文件之前先问一句。',
        createdAt: null,
      },
      {
        key: 'web',
        kind: 'browser',
        label: '自己的浏览器',
        path: '',
        space: 'default',
        note: 'ego 的隔离空间，不带师父的登录态；要用他登录过的站，先问。',
        createdAt: null,
      },
    ],
  }
}

/** 旧账升级：认不出的条目留着，不删（删不是忘，是抹）。 */
export function normalizeSpaces(raw) {
  const base = defaultSpaces()
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.spaces)) return base
  const spaces = raw.spaces
    .filter((s) => s && typeof s === 'object' && typeof s.key === 'string')
    .map((s) => ({
      key: s.key,
      kind: SPACE_KINDS.includes(s.kind) ? s.kind : 'computer',
      label: typeof s.label === 'string' && s.label ? s.label : s.key,
      path: typeof s.path === 'string' ? s.path : '',
      space: typeof s.space === 'string' ? s.space : '',
      note: typeof s.note === 'string' ? s.note : '',
      createdAt: typeof s.createdAt === 'string' ? s.createdAt : null,
    }))
  return { ...raw, spaces: spaces.length ? spaces : base.spaces }
}

/**
 * 隔离检查：这一块是不是「我自己的」。
 * 三条判据（缺一条就不算隔离好）：
 *   1. 落在工作区里面（不是别处某个盘根，也不是用户目录本身）；
 *   2. 不在师父常用的那三个地方（桌面 / 文档 / 下载）；
 *   3. 不是工作区根——根是共用的，不算我的。
 */
export function isolationCheck(rawPath, { workspace = '', forbidden = [] } = {}) {
  const p = String(rawPath || '').trim()
  if (!p) return { ok: false, why: '没有路径：这一块没有落处，不算空间。' }
  const abs = isAbsolute(p) ? normalize(p) : resolve(workspace || process.cwd(), p)
  const ws = workspace ? normalize(resolve(workspace)) : ''
  if (ws && abs === ws) return { ok: false, why: '这就是工作区根本身——根是共用的，不是我的空间。' }
  for (const f of forbidden) {
    const base = String(f || '').trim()
    if (!base) continue
    const nb = normalize(resolve(base))
    const rel = relative(nb, abs)
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
      return { ok: false, why: `落在「${base}」里面——那是师父的地盘，出界了。` }
    }
  }
  if (ws) {
    const rel = relative(ws, abs)
    if (rel.startsWith('..') || isAbsolute(rel)) {
      return { ok: false, why: '在工作区外面。要么放回工作区里，要么先说清它是干什么用的。' }
    }
  }
  return { ok: true, abs }
}

/** 这块现在能不能用：电脑看目录在不在，浏览器看是不是登记了 space。 */
export function probeSpace(space, { workspace = '' } = {}) {
  if (!space) return { ok: false, why: '没有这一块。' }
  if (space.kind === 'computer') {
    const chk = isolationCheck(space.path, { workspace })
    if (!chk.ok) return chk
    let exists = false
    let isDir = false
    try {
      exists = existsSync(chk.abs)
      isDir = exists ? statSync(chk.abs).isDirectory() : false
    } catch {
      exists = false
    }
    if (!exists) return { ok: false, why: `目录还没建：${chk.abs}（说一声我就建）`, abs: chk.abs, need: 'mkdir' }
    if (!isDir) return { ok: false, why: `那条路径是个文件，不是目录：${chk.abs}`, abs: chk.abs }
    return { ok: true, abs: chk.abs, why: '目录在，是自己的地方。' }
  }
  if (!space.space) return { ok: false, why: '浏览器这块没写 space（ego 的任务空间名）。' }
  return { ok: true, abs: '', why: `用 ego 的隔离空间「${space.space}」：不带师父的登录态。` }
}

/** 加一块。key 撞了就不加——同名两块，日后分不清哪块是哪个。 */
export function addSpace(list, { key, kind, label, path, space, note }, now = Date.now()) {
  const k = String(key || '').trim()
  if (!k) return { ok: false, why: '这块得有个名字（key）。' }
  if (!SPACE_KINDS.includes(kind)) return { ok: false, why: 'kind 只有两种：computer（自己的电脑）或 browser（自己的浏览器）。' }
  const spaces = Array.isArray(list?.spaces) ? list.spaces : []
  if (spaces.some((s) => s.key === k)) return { ok: false, why: `已经有「${k}」这块了，换个名字或者改那块。` }
  if (kind === 'computer' && !String(path || '').trim()) return { ok: false, why: '自己的电脑要给一个目录，不然东西往哪儿放。' }
  const item = {
    key: k,
    kind,
    label: String(label || k).trim() || k,
    path: String(path || '').trim(),
    space: String(space || '').trim(),
    note: String(note || '').trim(),
    createdAt: new Date(now).toISOString(),
  }
  return { ok: true, item, state: { ...(list || {}), spaces: [...spaces, item] } }
}

export function findSpace(list, key) {
  const k = String(key || '').trim()
  const spaces = Array.isArray(list?.spaces) ? list.spaces : []
  if (!k) return null
  return spaces.find((s) => s.key === k) || spaces.find((s) => s.label === k) || null
}

/** 摆成一段。空表不算错——空着就是还没划出来。 */
export function renderSpaces(list, { workspace = '' } = {}) {
  const spaces = Array.isArray(list?.spaces) ? list.spaces : []
  if (!spaces.length) return '还没划出空间。要的话说一块：自己的电脑（给个目录）或自己的浏览器（给个 ego space）。'
  const lines = ['我的空间：']
  for (const s of spaces) {
    const p = probeSpace(s, { workspace })
    const where = s.kind === 'computer' ? (p.abs || s.path) : `ego space「${s.space}」`
    lines.push(`- ${s.label}（${s.kind}）${where}${p.ok ? '' : `  ⚠ ${p.why}`}`)
    if (s.note) lines.push(`    ${s.note}`)
  }
  return lines.join('\n')
}
