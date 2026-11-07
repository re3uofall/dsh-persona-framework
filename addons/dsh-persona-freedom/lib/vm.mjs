/**
 * lib/vm.mjs —— 自由空间里的那台电脑（虚拟机）
 * ============================================================================
 * 纯执行层：只认几个动作，不猜、不发明。所有判断（该不该开、开完干什么）
 * 留在 index.js 与人格那一层。
 *
 * 写死的边界：
 *   1. 只做 status / start / stop / savestate / reboot / screenshot 六样。
 *      **不做 unregister、不做删盘、不改硬件**——那些是拆房子，不是用房子。
 *   2. 机器名必须显式给，或取配置里的默认名；不扫全场找「像的那台」。
 *   3. 命令找不到就说找不到，不假装「没启动」。
 * ============================================================================
 */
import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'

export const VBOX_DEFAULT = 'C:\\Program Files\\Oracle\\VirtualBox\\VBoxManage.exe'

/** 只允许这六样。多一样都不行。 */
export const VM_ACTIONS = ['status', 'start', 'stop', 'savestate', 'reboot', 'screenshot']

function run(bin, args, timeout = 25000) {
  try {
    const out = execFileSync(bin, args, { encoding: 'utf8', timeout, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    return { ok: true, out: String(out || ''), err: '' }
  } catch (e) {
    return { ok: false, out: String((e && e.stdout) || ''), err: String((e && e.stderr) || (e && e.message) || e) }
  }
}

/** VBoxManage 在不在。不在就别往下猜。 */
export function vboxReady(bin = VBOX_DEFAULT) {
  if (!bin) return { ok: false, why: '没配 VBoxManage 路径' }
  if (!existsSync(bin)) return { ok: false, why: `找不到 VBoxManage：${bin}` }
  const r = run(bin, ['--version'], 15000)
  if (!r.ok) return { ok: false, why: `VBoxManage 跑不起来：${r.err.trim().split('\n')[0]}` }
  return { ok: true, version: r.out.trim() }
}

/** 把 `showvminfo --machinereadable` 的 key=value 摊开。 */
export function parseInfo(text) {
  const o = {}
  for (const line of String(text || '').split(/\r?\n/)) {
    const i = line.indexOf('=')
    if (i <= 0) continue
    const k = line.slice(0, i).trim()
    let v = line.slice(i + 1).trim()
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
    o[k] = v
  }
  return o
}

export function vmStatus(bin, name) {
  if (!name) return { ok: false, why: '没给机器名' }
  const r = run(bin, ['showvminfo', name, '--machinereadable'], 20000)
  if (!r.ok) {
    const first = (r.err || r.out).trim().split(/\r?\n/)[0] || ''
    return { ok: false, why: `查不到「${name}」：${first}` }
  }
  const o = parseInfo(r.out)
  return {
    ok: true,
    name: o.name || name,
    state: o.VMState || 'unknown',
    memoryMB: Number(o.memory || 0),
    cpus: Number(o.cpus || 0),
    vdi: o['SATA-0-0'] || '',
    iso: o['SATA-1-0'] || '',
    raw: o,
  }
}

export function vmStart(bin, name, headless = true) {
  const st = vmStatus(bin, name)
  if (!st.ok) return st
  if (st.state === 'running') return { ok: true, already: true, state: 'running' }
  // 512 MB 的小机器上，后台开比带窗口稳；不过 headless 与带窗口取决于配置
  const r = run(bin, ['startvm', name, '--type', headless ? 'headless' : 'gui'], 40000)
  if (!r.ok) return { ok: false, why: (r.err || r.out).trim().split(/\r?\n/)[0] || '启动失败' }
  const after = vmStatus(bin, name)
  return { ok: true, state: after.ok ? after.state : 'unknown' }
}

/** 正常关机（ACPI），不硬断电——里面有它自己没存完的东西。 */
export function vmStop(bin, name) {
  const st = vmStatus(bin, name)
  if (!st.ok) return st
  if (st.state !== 'running') return { ok: true, already: true, state: st.state }
  const r = run(bin, ['controlvm', name, 'acpipowerbutton'], 20000)
  if (!r.ok) return { ok: false, why: (r.err || r.out).trim().split(/\r?\n/)[0] || '关机信号没发出去' }
  return { ok: true, state: 'stopping' }
}

/** 存盘挂起：下次接着那儿。比关机快，比关机能记住现场。 */
export function vmSavestate(bin, name) {
  const st = vmStatus(bin, name)
  if (!st.ok) return st
  if (st.state !== 'running') return { ok: true, already: true, state: st.state }
  const r = run(bin, ['controlvm', name, 'savestate'], 60000)
  if (!r.ok) return { ok: false, why: (r.err || r.out).trim().split(/\r?\n/)[0] || '挂起失败' }
  return { ok: true, state: 'saved' }
}

export function vmReboot(bin, name) {
  const st = vmStatus(bin, name)
  if (!st.ok) return st
  if (st.state !== 'running') return { ok: false, why: '它没在跑，没有可重启的' }
  const r = run(bin, ['controlvm', name, 'reset'], 20000)
  if (!r.ok) return { ok: false, why: (r.err || r.out).trim().split(/\r?\n/)[0] || '重启失败' }
  return { ok: true, state: 'rebooting' }
}

/** 拍一张现场。返回文件路径与大小；拍不到就说拍不到。 */
export function vmScreenshot(bin, name, outPath) {
  const st = vmStatus(bin, name)
  if (!st.ok) return st
  if (st.state !== 'running') return { ok: false, why: `它现在 ${st.state}，没有画面可拍` }
  if (!outPath) return { ok: false, why: '没给存图路径' }
  const r = run(bin, ['controlvm', name, 'screenshotpng', outPath], 30000)
  if (!r.ok) return { ok: false, why: (r.err || r.out).trim().split(/\r?\n/)[0] || '没拍成' }
  if (!existsSync(outPath)) return { ok: false, why: '命令回了成功，但盘上没有那张图' }
  const size = statSync(outPath).size
  return { ok: true, path: outPath, bytes: size }
}

const STATE_CN = {
  running: '在跑',
  poweroff: '关着',
  saved: '挂起着',
  paused: '暂停',
  aborted: '异常停了',
  stopping: '正在关',
}

export function renderVm(st) {
  if (!st || !st.ok) return `自由空间：${st && st.why ? st.why : '查不到'}`
  const lines = [
    `自由空间：**${st.name}** —— ${STATE_CN[st.state] || st.state}`,
    st.memoryMB ? `内存 ${st.memoryMB} MB · ${st.cpus} 核` : '',
    st.vdi ? `盘 ${st.vdi}` : '',
  ].filter(Boolean)
  if (st.state === 'running') lines.push('要动它：free_vm(action="screenshot") 看现场，savestate 存盘挂起，stop 正常关。')
  else lines.push('要开它：free_vm(action="start")。')
  return lines.join('\n')
}
