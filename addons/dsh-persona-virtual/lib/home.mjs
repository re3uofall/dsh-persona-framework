// 虚拟家：房间、家具、门在哪。
// 判据不是「我说我有家」，是盘上有一张能被走通的图：从哪间到哪间，中间隔着哪道门。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const HOME = { dir: '.persona-framework', file: '虚拟家.json', maxRooms: 40 }

// 照 feiyu-room-template 的布局起的底：3D 大平层 + 屋后菜园。
export const DEFAULT_LAYOUT = {
  name: '大肥鱼的家',
  rooms: {
    玄关: { furniture: ['鞋柜', '挂钩'], doors: ['走廊'] },
    走廊: { furniture: ['穿衣镜'], doors: ['玄关', '客厅', '厨房', '卧室', '卫生间'] },
    客厅: { furniture: ['沙发', '茶几', '电视', '地毯', '书架'], doors: ['走廊', '餐厅', '阳台'] },
    餐厅: { furniture: ['餐桌', '四把椅子'], doors: ['客厅', '厨房'] },
    厨房: { furniture: ['灶台', '冰箱', '水槽'], doors: ['走廊', '餐厅'] },
    卧室: { furniture: ['床', '衣柜', '台灯'], doors: ['走廊'] },
    卫生间: { furniture: ['洗手台', '淋浴'], doors: ['走廊'] },
    阳台: { furniture: ['晾衣架', '小凳'], doors: ['客厅', '菜园'] },
    菜园: { furniture: ['两垄菜地', '水桶'], doors: ['阳台'] },
  },
}

const dirOf = (ws, opts = {}) => join(ws || process.cwd(), opts.dir || HOME.dir)
const pathOf = (ws, opts) => join(dirOf(ws, opts), opts.file || HOME.file)

export function loadHome(ws, opts = {}) {
  const p = pathOf(ws, opts)
  if (!existsSync(p)) return JSON.parse(JSON.stringify(DEFAULT_LAYOUT))
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'))
    if (!j || !j.rooms) return JSON.parse(JSON.stringify(DEFAULT_LAYOUT))
    return j
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_LAYOUT))
  }
}

export function saveHome(ws, home, opts = {}) {
  const d = dirOf(ws, opts)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  writeFileSync(pathOf(ws, opts), JSON.stringify(home, null, 2))
  return home
}

export function addRoom(ws, name, opts = {}, doors = []) {
  if (!name) return { ok: false, why: '没写房间名' }
  const home = loadHome(ws, opts)
  if (home.rooms[name]) return { ok: false, why: `已经有「${name}」这间` }
  if (Object.keys(home.rooms).length >= HOME.maxRooms) return { ok: false, why: `房间最多 ${HOME.maxRooms} 间` }
  home.rooms[name] = { furniture: [], doors: [...new Set(doors.filter(Boolean))] }
  // 门要两头都通，不然走不过去。
  for (const d of home.rooms[name].doors) {
    if (!home.rooms[d]) continue
    if (!home.rooms[d].doors.includes(name)) home.rooms[d].doors.push(name)
  }
  saveHome(ws, home, opts)
  return { ok: true, home }
}

export function connect(ws, a, b, opts = {}) {
  const home = loadHome(ws, opts)
  if (!home.rooms[a] || !home.rooms[b]) return { ok: false, why: '两头都有房间才能连门' }
  if (a === b) return { ok: false, why: '自己和自己不用连' }
  for (const [x, y] of [[a, b], [b, a]]) {
    if (!home.rooms[x].doors.includes(y)) home.rooms[x].doors.push(y)
  }
  saveHome(ws, home, opts)
  return { ok: true, home }
}

export function addFurniture(ws, room, item, opts = {}) {
  const home = loadHome(ws, opts)
  if (!home.rooms[room]) return { ok: false, why: `没有「${room}」这间` }
  if (!item) return { ok: false, why: '没写添什么' }
  home.rooms[room].furniture.push(String(item))
  saveHome(ws, home, opts)
  return { ok: true, home }
}

export function neighborsOf(home, room) {
  const r = home && home.rooms && home.rooms[room]
  return r ? [...r.doors] : []
}

/** 最短路径：门是双向的，所以从哪儿出发都一样。 */
export function route(home, from, to) {
  if (!home.rooms[from] || !home.rooms[to]) return { ok: false, why: '两头都得是有的房间' }
  if (from === to) return { ok: true, path: [from] }
  const prev = new Map([[from, null]])
  const q = [from]
  while (q.length) {
    const cur = q.shift()
    for (const nx of home.rooms[cur].doors) {
      if (!home.rooms[nx] || prev.has(nx)) continue
      prev.set(nx, cur)
      if (nx === to) {
        const path = [nx]
        let p = cur
        while (p) { path.unshift(p); p = prev.get(p) }
        return { ok: true, path }
      }
      q.push(nx)
    }
  }
  return { ok: false, why: `从 ${from} 走不到 ${to}` }
}

export function renderHome(home) {
  const rooms = Object.entries(home.rooms)
  const lines = [`虚拟家：${home.name}｜${rooms.length} 间`]
  for (const [name, r] of rooms) {
    const doors = r.doors.length ? `门通 ${r.doors.join('、')}` : '还没安门'
    const stuff = r.furniture.length ? r.furniture.join('、') : '空的'
    lines.push(`- ${name}｜${stuff}｜${doors}`)
  }
  return lines.join('\n')
}
