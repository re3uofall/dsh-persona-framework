/**
 * 记忆账的共用底座：边、审计、负记忆、锚点，都存在同一个目录下。
 *
 * 为什么单开一个目录：这些东西不是「记忆内容」，是记忆的**结构**——
 * 谁跟谁有关、谁改过、什么被证伪了、什么不能忘。内容还在 `persona-ai/knowledge/`，
 * 结构放这里，两边不打架。
 *
 * 抄灵枢的只有一件事：**结构要和内容分开存**。它放在 md_cg/ 里，我们放这儿。
 */
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const LEDGER_DIR = '.persona-framework/记忆账'

export function ledgerDir(root) {
  return join(root, LEDGER_DIR)
}

export function ensureDir(root) {
  const d = ledgerDir(root)
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

/** 读 JSONL，一行一条；坏行跳过，不因为一行坏了整份读不出来。 */
export function readJsonl(root, name) {
  const f = join(ledgerDir(root), name)
  if (!existsSync(f)) return []
  const out = []
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      out.push(JSON.parse(t))
    } catch {
      /* 坏行跳过 */
    }
  }
  return out
}

/** 追加一行 JSONL。 */
export function appendJsonl(root, name, row) {
  ensureDir(root)
  appendFileSync(join(ledgerDir(root), name), JSON.stringify(row) + '\n', 'utf8')
}

/** 读 JSON；没有就返回 fallback。 */
export function readJson(root, name, fallback) {
  const f = join(ledgerDir(root), name)
  if (!existsSync(f)) return fallback
  try {
    return JSON.parse(readFileSync(f, 'utf8'))
  } catch {
    return fallback
  }
}

/** 写 JSON（整份覆盖）。 */
export function writeJson(root, name, value) {
  ensureDir(root)
  writeFileSync(join(ledgerDir(root), name), JSON.stringify(value, null, 2), 'utf8')
}

/** 读一份 md（不存在就是空串）。 */
export function readMd(root, rel) {
  const f = join(root, rel)
  return existsSync(f) ? readFileSync(f, 'utf8') : ''
}

export function nowIso() {
  return new Date().toISOString()
}
