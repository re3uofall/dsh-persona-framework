/**
 * panel.mjs —— 左栏「教训」面板的数据口。
 *
 * 师父 m02961：「感悟和教训插件都要有左边侧边页」。
 * 这里只做一件事：把 `persona-ai/growth/教训/教训.jsonl` 读成 JSON。
 * 一行一条，坏行跳过、不猜——面板宁可少一条，也不替它编。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function wsOf(cfg) {
  const raw = String((cfg && cfg.workspace) || '').trim()
  if (raw) return raw
  const env = String(process.env.DSH_WORKSPACE || '').trim()
  return env || process.cwd()
}

export function collectLesson(cfg = {}) {
  const file = join(wsOf(cfg), String(cfg.dir || 'persona-ai/growth/教训'), String(cfg.file || '教训.jsonl'))
  if (!existsSync(file)) return []
  const out = []
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const s = line.trim()
    if (!s) continue
    try {
      const row = JSON.parse(s)
      if (row && row.id) out.push(row)
    } catch {}
    if (out.length >= 300) break
  }
  return out.reverse()
}

export function panelHandler(cfg = {}) {
  return function handler(_req, res) {
    try {
      const items = collectLesson(cfg)
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
