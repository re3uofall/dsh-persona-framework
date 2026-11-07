import { anchorsOf, compare, meaningOf, renderMark, renderMeaning, appendRecord, readRecords } from './lib/betray.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let ok = 0, bad = 0
const t = (name, cond) => { if (cond) { ok++ } else { bad++; console.log('FAIL', name) } }

t('路径认出', anchorsOf('见 C:/a/b.md 那段').some((x) => x.kind === 'path'))
t('URL 认出', anchorsOf('看 https://x.com/y 那句').some((x) => x.kind === 'url'))
t('时间认出', anchorsOf('2026-11-07T15:00:00Z 那笔').some((x) => x.kind === 'time'))
t('指针认出', anchorsOf('persona-ai/knowledge/session/2026-11-07.md#3 里').some((x) => x.kind === 'pointer'))
t('工具名认出', anchorsOf('hand_run 跑过').some((x) => x.kind === 'tool'))
t('没出处为空', anchorsOf('这句话什么也没带').length === 0)

const a = '词义见 C:/a.md'
const b = '词义见 C:/a.md'
const c = '词义见 C:/b.md'
t('同出处判同', compare(a, b).same === true)
t('异出处判异', compare(a, c).same === false)
t('异出处指出差异', compare(a, c).onlyA.length === 1 && compare(a, c).onlyB.length === 1)

const v1 = meaningOf('出处', [{ text: '见 C:/a.md 那本账' }, { text: '意思是来源' }])
t('含义只算有出处的', v1.grounded === 1 && v1.bare === 1)
t('没有出处含义不定', meaningOf('出处', [{ text: '意思是来源' }]).meaning.includes('没有出处'))
t('含义文本非空', renderMeaning(v1).includes('词：出处'))
t('标出处出字', renderMark({ text: '见 C:/a.md' }).includes('出处 1 处'))
t('没出处明说', renderMark({ text: '空话' }).includes('按内置语料处理'))

const ws = mkdtempSync(join(tmpdir(), 'betray-'))
appendRecord(ws, { op: 'mark', text: '见 C:/a.md' })
appendRecord(ws, { op: 'meaning', word: '出处', verdict: v1 })
const rows = readRecords(ws, 10)
t('账写了两行', rows.length === 2)
t('账读回 op', rows[0].op === 'mark' && rows[1].op === 'meaning')
rmSync(ws, { recursive: true, force: true })

console.log(bad === 0 ? `✓ ${ok} 项全过` : `${ok} 过，${bad} 没过`)
process.exit(bad === 0 ? 0 : 1)
