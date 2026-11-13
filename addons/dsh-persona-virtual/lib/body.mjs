// 虚拟身体：位置、朝向、姿势、力气。
// 判据不是「我说我在客厅」，是盘上有一行写着此刻在哪个房间、朝哪边、什么姿势。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const BODY = {
  dir: '.persona-framework',
  file: '虚拟身体.json',
  poses: ['站着', '坐着', '躺着', '蹲着', '趴着', '悬着'],
  minEnergy: 0,
  maxEnergy: 100,
}

export const nowISO = (now = Date.now()) => new Date(now).toISOString()

const dirOf = (ws, opts = {}) => join(ws || process.cwd(), opts.dir || BODY.dir)
const pathOf = (ws, opts) => join(dirOf(ws, opts), opts.file || BODY.file)

function ensure(ws, opts) {
  const d = dirOf(ws, opts)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

export const DEFAULT_BODY = {
  at: null,
  room: null,
  pose: '站着',
  facing: null,
  energy: 60,
  note: '',
}

export function loadBody(ws, opts = {}) {
  const p = pathOf(ws, opts)
  if (!existsSync(p)) return { ...DEFAULT_BODY }
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'))
    return { ...DEFAULT_BODY, ...j }
  } catch {
    return { ...DEFAULT_BODY }
  }
}

export function saveBody(ws, body, opts = {}) {
  ensure(ws, opts)
  writeFileSync(pathOf(ws, opts), JSON.stringify(body, null, 2))
  return body
}

/** 换房间：身体只记「在哪儿」，不替家里判这房间存不存在——那是 home 的事。 */
export function moveTo(ws, room, opts = {}, now = Date.now()) {
  if (!room) return { ok: false, why: '没写去哪个房间' }
  const body = { ...loadBody(ws, opts), room: String(room), at: nowISO(now) }
  saveBody(ws, body, opts)
  return { ok: true, body }
}

export function setPose(ws, pose, opts = {}, now = Date.now()) {
  if (!BODY.poses.includes(pose)) {
    return { ok: false, why: `姿势只有 ${BODY.poses.join(' / ')}` }
  }
  const body = { ...loadBody(ws, opts), pose, at: nowISO(now) }
  saveBody(ws, body, opts)
  return { ok: true, body }
}

export function faceTo(ws, target, opts = {}, now = Date.now()) {
  const body = { ...loadBody(ws, opts), facing: target ? String(target) : null, at: nowISO(now) }
  saveBody(ws, body, opts)
  return { ok: true, body }
}

export function spendEnergy(ws, amount = 10, opts = {}, now = Date.now()) {
  const n = Number(amount)
  if (!Number.isFinite(n) || n === 0) return { ok: false, why: '没写花多少力气' }
  if (n < 0) return { ok: false, why: '花掉的力气要写正数；要回力气用负数以外的方式，别把加力气记成花钱' }
  const body = loadBody(ws, opts)
  const energy = Math.max(BODY.minEnergy, Math.min(BODY.maxEnergy, body.energy - n))
  const next = { ...body, energy, at: nowISO(now) }
  saveBody(ws, next, opts)
  return { ok: true, body: next }
}

export function renderBody(body) {
  const b = body || DEFAULT_BODY
  const where = b.room || '还没落过脚'
  const pose = b.pose || '站着'
  const face = b.facing ? `，朝 ${b.facing}` : ''
  return `虚拟身体：在 ${where}｜${pose}${face}｜力气 ${b.energy}${b.at ? `｜${b.at}` : ''}`
}
