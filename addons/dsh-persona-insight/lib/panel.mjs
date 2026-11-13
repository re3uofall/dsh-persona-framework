/**
 * panel.mjs —— 左栏「感悟」面板的数据口。
 *
 * 师父 m02961：「感悟和教训插件都要有左边侧边页」。
 * 这里只做一件事：把 `persona-ai/growth/感悟/YYYY-MM-DD.md` 读成 JSON。
 * 不写、不改、不排序偏好——面板只负责把已有的字摆出来。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DAY_RE = /^\d{4}-\d{2}-\d{2}\.md$/

function wsOf(cfg) {
  const raw = String((cfg && cfg.workspace) || '').trim()
  if (raw) return raw
  const env = String(process.env.DSH_WORKSPACE || '').trim()
  return env || process.cwd()
}

export function collectInsight(cfg = {}) {
  const dir = join(wsOf(cfg), String(cfg.dir || 'persona-ai/growth/感悟'))
  const items = []
  if (!existsSync(dir)) return items
  const files = readdirSync(dir).filter((n) => DAY_RE.test(n)).sort().reverse()
  for (const f of files) {
    const body = readFileSync(join(dir, f), 'utf8')
    const chunks = body.split(/\r?\n(?=###\s)/)
    for (const chunk of chunks) {
      const m = chunk.match(/^###\s*(.+?)\s*$/m)
      if (!m) continue
      const text = chunk.replace(/^###.*$/m, '').trim()
      if (!text) continue
      const head = m[1]
      const kind = (head.split('·')[1] || '').replace(/（.*）$/, '').trim() || '体会'
      items.push({ day: f.slice(0, 10), head, kind, text })
      if (items.length >= 300) return items
    }
  }
  return items
}

export function panelHandler(cfg = {}) {
  return function handler(_req, res) {
    try {
      const items = collectInsight(cfg)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: true, count: items.length, items }))
    } catch (error) {
      try {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: (error && error.message) || String(error) }))
      } catch {}
    }
  }
}
