/**
 * 负记忆：被证伪的假设，单独一层。
 *
 * 抄灵枢的 `rejected` 层（它把负记忆和未解问题各算一层）。
 * 我这边原来把这些混在「改口」里——改口说完就过去了，下一次同一个错还会再犯一遍。
 *
 * 为什么要单开：**否定的知识比肯定的知识难记**。
 * 「这样做会坏」这种话，不写下来，下一轮就一定重来一次。
 *
 * 存一个 md，人也能读；每条带：当时怎么想的、为什么不对、证据是什么。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { nowIso } from './ledger.mjs'

const REL = 'persona-ai/knowledge/rejected.md'

function fileOf(root) {
  return join(root, REL)
}

function read(root) {
  const f = fileOf(root)
  return existsSync(f) ? readFileSync(f, 'utf8') : '# 负记忆：被证伪的假设\n\n> 写下来的不是「我错过」，是「这条路走不通」。\n'
}

/** 记一条被证伪的假设。 */
export function reject(root, { claim, why, evidence = '' } = {}) {
  if (!claim) throw new Error('要说清哪一条被证伪了（claim）')
  const f = fileOf(root)
  const dir = dirname(f)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const entry = [
    '',
    `## ${String(claim).slice(0, 120)}`,
    '',
    `- 什么时候：${nowIso()}`,
    `- 以为：${String(claim).slice(0, 400)}`,
    `- 为什么不对：${String(why || '（没写）').slice(0, 400)}`,
    `- 证据：${String(evidence || '（没写）').slice(0, 400)}`,
    '',
  ].join('\n')

  writeFileSync(f, read(root) + entry, 'utf8')
  return { file: REL, claim: String(claim).slice(0, 120) }
}

/** 这条是不是已经被证伪过？只做字面粗匹配，不做语义——宁可漏，不可乱认。 */
export function looksRejected(root, text) {
  // 两步清洗再比：
  //   1. 剥掉行首列表标记（记忆里是「- 某某」，负记忆标题没有这个横杠）
  //   2. 去掉标点空白（标题不带句号，正文带句号，直接 includes 永远对不上）
  const clean = (s) => String(s || '').replace(/[。！？，、；：""''（）()\[\]【】\s]/g, '')
  const t = clean(String(text || '').replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, ''))
  if (t.length < 4) return null
  const body = read(root)
  const needle = t.slice(0, 40)
  const hit = body
    .split(/\n## /)
    .slice(1)
    .find((sec) => {
      const head = clean(sec.split('\n')[0])
      return head.includes(needle) || (head.length >= 6 && needle.includes(head))
    })
  return hit ? hit.split('\n')[0] : null
}

export function renderRejected(root) {
  const body = read(root).trim()
  if (body.split(/\n## /).length <= 1) return '负记忆还是空的。'
  return body
}
