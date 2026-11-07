/**
 * 嘴的通道：一句话真送出去，拿回可核对的东西。
 * 三种通道，最小的那个是 file——写进发件箱，回执是「写进了哪个文件、多少字节」。
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { runCommand } from './run.mjs'

export const CHANNEL_KINDS = ['file', 'command', 'http']

export const DEFAULT_CHANNELS = {
  file: { kind: 'file', path: '.persona-framework/嘴/发件箱.md' },
}

export function channelOf(name, channels) {
  const all = { ...DEFAULT_CHANNELS, ...(channels || {}) }
  return all[String(name || 'file')] || null
}

export function channelNames(channels) {
  return Object.keys({ ...DEFAULT_CHANNELS, ...(channels || {}) })
}

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * 真送。回 { ok, code, detail, ms, channel }。
 * ok 只看「通道自己认不认收到」：文件写进去了 / 命令退出码 0 / HTTP 2xx。
 */
export async function sendVia(channel, { to, text }, { workspace } = {}) {
  const started = Date.now()
  const body = String(text || '')
  if (!body.trim()) return { ok: false, code: -1, detail: '话是空的，没送。', ms: 0, channel: 'none' }

  if (!channel) return { ok: false, code: -1, detail: '没有这个通道。', ms: 0, channel: 'none' }

  if (channel.kind === 'file') {
    const raw = String(channel.path || DEFAULT_CHANNELS.file.path)
    const abs = isAbsolute(raw) ? raw : join(String(workspace || process.cwd()), raw)
    const block = `\n## ${stamp()}${to ? ` → ${to}` : ''}\n\n${body.trim()}\n`
    try {
      mkdirSync(dirname(abs), { recursive: true })
      appendFileSync(abs, block, 'utf8')
      return { ok: true, code: 0, detail: `写进 ${abs}（${Buffer.byteLength(block, 'utf8')} 字节）`, ms: Date.now() - started, channel: channel.kind }
    } catch (e) {
      return { ok: false, code: -1, detail: `写不进去：${e && e.message ? e.message : String(e)}`, ms: Date.now() - started, channel: channel.kind }
    }
  }

  if (channel.kind === 'command') {
    const tpl = String(channel.command || '')
    if (!tpl) return { ok: false, code: -1, detail: 'command 通道没写命令。', ms: 0, channel: channel.kind }
    const escaped = body.replace(/'/g, "''")
    const toEsc = String(to || '').replace(/'/g, "''")
    const cmd = tpl.replaceAll('{text}', escaped).replaceAll('{to}', toEsc)
    const r = await runCommand(cmd, { timeoutMs: Number(channel.timeoutMs) || 60_000, cwd: workspace })
    const first = String(r.out || r.err || '').split('\n').map((s) => s.trim()).find(Boolean) || ''
    return {
      ok: r.ok && r.code === 0,
      code: r.code == null ? -1 : r.code,
      detail: r.timedOut ? `通道超时（${Math.round((r.ms || 0) / 1000)} 秒）` : first || `退出码 ${r.code}`,
      ms: Date.now() - started,
      channel: channel.kind,
    }
  }

  if (channel.kind === 'http') {
    const url = String(channel.url || '')
    if (!url) return { ok: false, code: -1, detail: 'http 通道没写 url。', ms: 0, channel: channel.kind }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(channel.headers || {}) },
        body: JSON.stringify({ to: to || '', text: body, at: new Date().toISOString() }),
        signal: AbortSignal.timeout(Number(channel.timeoutMs) || 15_000),
      })
      const ok = res.status >= 200 && res.status < 300
      let snippet = ''
      try { snippet = (await res.text()).slice(0, 200) } catch { /* 没正文也行 */ }
      return { ok, code: res.status, detail: `HTTP ${res.status}${snippet ? `：${snippet.replace(/\s+/g, ' ')}` : ''}`, ms: Date.now() - started, channel: channel.kind }
    } catch (e) {
      return { ok: false, code: -1, detail: `没送到：${e && e.message ? e.message : String(e)}`, ms: Date.now() - started, channel: channel.kind }
    }
  }

  return { ok: false, code: -1, detail: `不认识的通道类型：${channel.kind}（只认 ${CHANNEL_KINDS.join(' / ')}）`, ms: 0, channel: String(channel.kind) }
}

/** 通道是否真的能落东西（file 看目录写不写得进，其余看配置齐不齐）。 */
export function channelReady(channel, { workspace } = {}) {
  if (!channel) return { ready: false, why: '没有这个通道' }
  if (channel.kind === 'file') {
    const raw = String(channel.path || DEFAULT_CHANNELS.file.path)
    const abs = isAbsolute(raw) ? raw : join(String(workspace || process.cwd()), raw)
    return { ready: true, why: `发件箱：${abs}${existsSync(abs) ? '' : '（还没建，第一次说会建）'}` }
  }
  if (channel.kind === 'command') return { ready: !!channel.command, why: channel.command ? '命令通道已配' : '命令通道没写命令' }
  if (channel.kind === 'http') return { ready: !!channel.url, why: channel.url ? 'HTTP 通道已配' : 'HTTP 通道没写 url' }
  return { ready: false, why: `不认识的通道类型：${channel.kind}` }
}
