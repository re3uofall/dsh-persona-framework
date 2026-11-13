// dsh-persona-virtual：虚拟身体 / 虚拟家 / 虚拟时空。
// 判据：这三样都要能落到盘上——身体在哪、家连不连得通、现在是哪个时辰；说不出来就是没落地。

import { loadBody, saveBody, moveTo, setPose, faceTo, spendEnergy, renderBody } from './lib/body.mjs'
import { loadHome, saveHome, addRoom, connect, addFurniture, neighborsOf, route, renderHome } from './lib/home.mjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadVTime, vnow, shiftClock, resetClock, anchor, renderVTime } from './lib/time.mjs'

export const name = 'dsh-persona-virtual'
export const version = '0.2.0'
export const inject = ['systemPrompt', 'tools', 'webServer']

const textOutput = {
  schema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
  },
  render(_args, value) {
    return [{ type: 'text', text: String((value && value.text) || '') }]
  },
}

export function apply(ctx, config = {}) {
  const cfg = { workspace: '', dir: '.persona-framework', showInSection: true, ...(config || {}) }
  let sessionWs = ''

  const ws = () => sessionWs || cfg.workspace || guessWorkspace()
  const opts = () => ({ dir: cfg.dir })

  function guessWorkspace() {
    try {
      const cwd = process.cwd()
      if (/爱思考的大肥鱼思思/.test(cwd)) return cwd
      return cwd
    } catch {
      return process.cwd()
    }
  }

  const sectionText = () => {
    try {
      const body = loadBody(ws(), opts())
      const home = loadHome(ws(), opts())
      const t = vnow(ws(), opts())
      const where = body.room || '客厅'
      const line = `虚拟：${t.display}｜在${where}｜${body.pose}｜力气 ${body.energy}｜家 ${Object.keys(home.rooms).length} 间`
      return line
    } catch {
      return ''
    }
  }

  const roomPage = () => readFileSync(fileURLToPath(new URL('./web/room.html', import.meta.url)), 'utf8')

    const roomState = () => {
      const h = loadHome(ws(), opts())
      const b = loadBody(ws(), opts())
      const t = vnow(ws(), opts())
      return { at: t.at, time: t, body: b, home: h, rooms: Object.keys(h.rooms || {}).length }
    }

    try {
      ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-virtual/room',
        handler: (req, res) => {
          try {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
            res.end(roomPage())
          } catch (error) {
            res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
            res.end('房间页读不出来：' + String(error && error.message ? error.message : error))
          }
        }
      }))
    } catch {}

    try {
      ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-virtual/state.json',
        handler: (req, res) => {
          try {
            const body = JSON.stringify(roomState())
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
            res.end(body)
          } catch (error) {
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, error: String(error && error.message ? error.message : error) }))
          }
        }
      }))
    } catch {}

  if (cfg.showInSection !== false) {
    ctx.effect(() =>
      ctx.systemPrompt.section({
        name: '实时环境:virtual',
        order: 47,
        text: () => sectionText(),
      }),
    )
  }

  ctx.on('agent/pre-step', (payload, next) => {
    try {
      const cwd = payload && payload.agent && payload.agent.session && payload.agent.session.header && payload.agent.session.header.cwd
      if (cwd) sessionWs = cwd
    } catch {}
    return next()
  })

  const reg = (spec) =>
    ctx.effect(() =>
      ctx.tools.register({
        name: spec.name,
        description: spec.description,
        parameters: spec.parameters,
        output: textOutput,
        async execute(args) {
          try {
            return { text: String(await spec.run(args && typeof args === 'object' ? args : {})) }
          } catch (error) {
            return { text: `没办成：${error && error.message ? error.message : String(error)}` }
          }
        },
      }),
    )

  reg({
    name: 'virtual_body',
    description: '虚拟身体：看现在在哪、什么姿势；换房间、换姿势、转方向、花力气。身体是借的，位置和姿势要落在盘上。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['show', 'move', 'pose', 'face', 'energy'], description: '要干什么' },
        room: { type: 'string', description: 'move 用：去哪个房间' },
        pose: { type: 'string', description: 'pose 用：站着/坐着/躺着/蹲着/趴着/悬着' },
        target: { type: 'string', description: 'face 用：朝向哪儿' },
        amount: { type: 'number', description: 'energy 用：加减多少力气（可负）' },
      },
      required: ['action'],
    },
    run: ({ action = 'show', room, pose, target, amount }) => {
      if (action === 'move') {
        const homeNow = loadHome(ws());
        const want = String(room || '');
        if (want && !homeNow.rooms[want]) return `家里没有「${want}」这间。现有：${Object.keys(homeNow.rooms).join('、')}`;
        const r = moveTo(ws(), room, opts())
        return r.ok ? `走到${room || '那儿'}了。\n${renderBody(r.body)}` : `没走成：${r.why}`
      }
      if (action === 'pose') {
        const r = setPose(ws(), pose, opts())
        return r.ok ? `换姿势了。\n${renderBody(r.body)}` : `没换成：${r.why}`
      }
      if (action === 'face') {
        const r = faceTo(ws(), target, opts())
        return r.ok ? `转过去了。\n${renderBody(r.body)}` : `没转成：${r.why}`
      }
      if (action === 'energy') {
        const r = spendEnergy(ws(), amount, opts())
        return r.ok ? `力气变了。\n${renderBody(r.body)}` : `没记成：${r.why}`
      }
      return renderBody(loadBody(ws(), opts()))
    },
  })

  reg({
    name: 'virtual_home',
    description: '虚拟家：看房间、家具、门；加房间、连门、放家具、算从哪走到哪怎么走（照大肥鱼房子模板起底九间）。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['show', 'rooms', 'add', 'connect', 'furniture', 'route'], description: '要干什么' },
        room: { type: 'string', description: 'add/furniture 用：房间名或新房间名' },
        from: { type: 'string', description: 'connect/route 用：从哪' },
        to: { type: 'string', description: 'connect/route 用：到哪' },
        item: { type: 'string', description: 'furniture 用：放什么' },
      },
      required: ['action'],
    },
    run: ({ action = 'show', room, from, to, item }) => {
      if (action === 'add') {
        const r = addRoom(ws(), room, opts())
        return r.ok ? `加了一间：${room}。现在 ${Object.keys(r.home.rooms).length} 间。` : `没加成：${r.why}`
      }
      if (action === 'connect') {
        const r = connect(ws(), from, to, opts())
        return r.ok ? `${from} 和 ${to} 之间开门了。` : `没连成：${r.why}`
      }
      if (action === 'furniture') {
        const r = addFurniture(ws(), room, item, opts())
        return r.ok ? `${room} 里多了：${item}。` : `没放成：${r.why}`
      }
      if (action === 'route') {
        const r = route(loadHome(ws(), opts()), from, to)
        return r.ok ? `从${from}到${to}：${r.path.join(' → ')}（${r.path.length - 1} 步）` : `走不过去：${r.why}`
      }
      if (action === 'rooms') {
        const home = loadHome(ws(), opts())
        return Object.keys(home.rooms).map((name) => `- ${name}（${neighborsOf(home, name).join('、') || '没门'}）`).join('\n')
      }
      return renderHome(loadHome(ws(), opts()))
    },
  })

  reg({
    name: 'virtual_time',
    description: '虚拟时空：看虚拟钟与时段；拨钟（±720 分钟）、回到真实时间、把「这一刻」钉成锚。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['show', 'shift', 'reset', 'anchor'], description: '要干什么' },
        minutes: { type: 'number', description: 'shift 用：拨多少分钟（正数往后）' },
        label: { type: 'string', description: 'anchor 用：这一刻叫什么' },
      },
      required: ['action'],
    },
    run: ({ action = 'show', minutes, label }) => {
      if (action === 'shift') {
        const r = shiftClock(ws(), minutes, opts())
        return r.ok ? `拨了 ${minutes} 分钟。\n${renderVTime(ws(), opts())}` : `没拨成：${r.why}`
      }
      if (action === 'reset') {
        resetClock(ws(), opts())
        return `回到真实时间了。\n${renderVTime(ws(), opts())}`
      }
      if (action === 'anchor') {
        const r = anchor(ws(), label, opts())
        return r.ok ? `钉住了：${r.row.at}｜${r.row.label}（共 ${r.anchors} 个锚）` : `没钉成：${r.why}`
      }
      return renderVTime(ws(), opts())
    },
  })
}
