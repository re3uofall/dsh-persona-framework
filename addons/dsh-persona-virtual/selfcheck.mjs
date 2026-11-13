import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import {
  BODY, DEFAULT_BODY, loadBody, saveBody, moveTo, setPose, faceTo, spendEnergy, renderBody,
} from './lib/body.mjs'
import {
  HOME, DEFAULT_LAYOUT, loadHome, saveHome, addRoom, connect, addFurniture, neighborsOf, route, renderHome,
} from './lib/home.mjs'
import { VTIME, loadVTime, vnow, shiftClock, resetClock, anchor, renderVTime } from './lib/time.mjs'

let pass = 0
let fail = 0
const ok = (name, cond) => (cond ? (pass++, console.log(`  ok   ${name}`)) : (fail++, console.log(`  ✗    ${name}`)))
const ws = () => mkdtempSync(join(tmpdir(), 'virtual-'))

// 身体
const d = DEFAULT_BODY
ok('身体默认 pose 是站着', d.pose === '站着')
ok('身体默认 room 是空的（还没进屋）', d.room === null)
ok('身体默认力气 60', d.energy === 60)
ok('没存过读出来就是默认', loadBody(ws()).pose === '站着')
const w1 = ws()
const mv = moveTo(w1, '客厅')
ok('能挪进客厅', mv.ok === true && loadBody(w1).room === '客厅')
ok('姿势只收六种', setPose(w1, '倒立').ok === false && setPose(w1, '躺着').ok === true)
ok('力气花掉 10 剩 50', spendEnergy(w1, 10).ok !== false && loadBody(w1).energy === 50)
ok('负数力气拒收', spendEnergy(w1, -10).ok === false)
ok('朝向能记下来', faceTo(w1, '窗').ok !== false && loadBody(w1).facing === '窗')
ok('身体渲染带房间与力气', /客厅/.test(renderBody(loadBody(w1))) && /50/.test(renderBody(loadBody(w1))))

// 家
ok('家默认九间', Object.keys(DEFAULT_LAYOUT.rooms).length === 9)
ok('默认先有玄关', !!DEFAULT_LAYOUT.rooms['玄关'])
ok('默认家有名字', DEFAULT_LAYOUT.name === '大肥鱼的家')
const w2 = ws()
const home0 = loadHome(w2)
ok('没存过读出来是默认布局', Object.keys(home0.rooms).length === 9)
ok('客厅能看到走廊', neighborsOf(home0, '客厅').includes('走廊'))
ok('从玄关走到菜园有路', route(home0, '玄关', '菜园').ok && route(home0, '玄关', '菜园').path.length > 2)
ok('走到不存在的房间返回空', route(home0, '玄关', '月亮').ok === false)
ok('能加一间房', addRoom(w2, '书房').ok !== false && !!loadHome(w2).rooms['书房'])
ok('能接一扇门', connect(w2, '书房', '走廊').ok !== false && neighborsOf(loadHome(w2), '书房').includes('走廊'))
ok('能放家具', addFurniture(w2, '书房', '书架').ok !== false)
ok('家的渲染列房间', /书房/.test(renderHome(loadHome(w2))))

// 时空
const w3 = ws()
const t = vnow(w3)
ok('虚拟时刻有 display', typeof t.display === 'string' && t.display.includes('｜'))
ok('时段落在七档里', ['后半夜', '清早', '上午', '中午', '下午', '傍晚', '晚上', '深夜'].includes(t.phase))
ok('偏移默认零', loadVTime(w3).offsetMinutes === 0)
ok('拨快 120 分钟', shiftClock(w3, 120).ok !== false)
const t2 = vnow(w3)
ok('拨过之后显示变了', t2.display !== t.display || t2.offsetMinutes === 0)
ok('复位回零', resetClock(w3).ok !== false && loadVTime(w3).offsetMinutes === 0)
ok('钉一个锚', anchor(w3, '走进新家').ok !== false)
ok('锚是空的要被拒', anchor(w3, '  ').ok === false)
ok('时空渲染带锚', /走进新家/.test(renderVTime(w3)))

// 包与入口
const idx = readFileSync(new URL('./index.js', import.meta.url), 'utf8')
ok('包名对', idx.includes("name = 'dsh-persona-virtual'"))
ok('版本有导出', /export const version = '\d+\.\d+\.\d+'/.test(idx))
ok('三个工具齐', ['virtual_body', 'virtual_home', 'virtual_time'].every((n) => idx.includes(`name: '${n}'`)))
ok('段是实时环境:virtual', idx.includes("name: '实时环境:virtual'"))
ok('段 order 是 47', /name: '实时环境:virtual'[\s\S]{0,200}?order: 47/.test(idx))
ok('挪房间时校验家里有没有这间', idx.includes('家里没有'))
const meta = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
ok('package 与代码同版本', meta.version === (idx.match(/export const version = '([^']+)'/) || [])[1])
ok('有 cordis.patch.yml 声明', !!meta.dsh && meta.dsh.bundle && !!meta.dsh.bundle.patch)
ok('中英 locale 齐', !!meta.exports['./locale/*.json'])

console.log(`\n通过 ${pass}，失败 ${fail}`)
if (fail) process.exit(1)
