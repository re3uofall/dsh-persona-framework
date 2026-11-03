/**
 * 反思：一次能跑的元认知检查。
 *
 * 抄灵枢 `mdcg_reflect` 的用途，不抄它的实现。它做的是「回看这一轮长了什么」；
 * 我这边拿不到当前对话全文，只能看**盘上留下的痕迹**——而这恰好够用：
 * 说过的话最后都要落成字，没落字的，盘上就是空的。
 *
 * 它回答三个问题：
 *   1. 最近还有没有在写？（流水、判断分别多久没更新）
 *   2. 边、审计、负记忆有没有在长？（结构层是不是摆设）
 *   3. 有没有「只说不记」的迹象？（今天有流水，但没有新判断）
 *
 * 只报事实，不打分。打分就会变成跑分。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { readJsonl } from './ledger.mjs'
import { anchorsOf } from './anchors.mjs'

function newestMtime(root, dir) {
  const d = join(root, dir)
  if (!existsSync(d)) return null
  let best = null
  try {
    for (const f of readdirSync(d)) {
      if (!f.endsWith('.md')) continue
      const t = statSync(join(d, f)).mtimeMs
      if (!best || t > best) best = t
    }
  } catch {
    return null
  }
  return best
}

function daysAgo(ms) {
  if (!ms) return null
  return Math.round((Date.now() - ms) / 86400000 * 10) / 10
}

export function reflect(root) {
  const sess = newestMtime(root, 'persona-ai/knowledge/session')
  const chat = newestMtime(root, 'persona-ai/knowledge/chat')
  const edges = readJsonl(root, 'edges.jsonl').length
  const audit = readJsonl(root, 'audit.jsonl').length
  const anchors = anchorsOf(root).length

  const facts = []
  facts.push(`流水：${sess ? `${daysAgo(sess)} 天前` : '没有'}`)
  facts.push(`判断：${chat ? `${daysAgo(chat)} 天前` : '没有'}`)
  facts.push(`边 ${edges} 条 · 审计 ${audit} 条 · 锚点 ${anchors} 条`)

  const warns = []
  if (sess !== null && chat !== null && sess > chat + 3600_000) {
    warns.push('流水比判断新：今天说过话，但还没落判断。')
  }
  if (edges === 0) warns.push('一条边都没有——结构层还是空的。')
  if (audit === 0) warns.push('审计是空的——要么没挡过，要么门禁没装上。')
  if (sess === null) warns.push('流水目录是空的。')

  return { facts, warns }
}

export function renderReflect(root) {
  const { facts, warns } = reflect(root)
  const lines = ['回看一遍：', ''].concat(facts.map((f) => `- ${f}`))
  if (warns.length) {
    lines.push('', '值得留意的：', '').concat(warns.map((w) => `- ${w}`))
  } else {
    lines.push('', '没看出漏。')
  }
  return lines.join('\n')
}
