/**
 * 自检：耳是不是真做了四件事——
 *   ① 五个工具都注册了（status / hear / take / receipt）；
 *   ② 引擎状态说得清（缺什么写什么，不假装 ready）；
 *   ③ ear_take 真落账（srt 认时间码，账上多一行，pending 有它）；
 *   ④ 下一步注一行、再下一步空（说过就清）。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, name, version } from './index.js'
import { parseTranscript, briefOf } from './lib/ear.mjs'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass += 1; console.log('  ✓ ' + m) } else { fail += 1; console.log('  ✗ ' + m) } }

const ws = mkdtempSync(join(tmpdir(), 'ear-probe-'))
const tools = new Map()
let sectionSpec = null
let preStep = null
const disposers = []

const ctx = {
  on(ev, fn) { if (ev === 'agent/pre-step') preStep = fn },
  effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d); return d },
  tools: { register(spec) { tools.set(spec.name, spec); return () => tools.delete(spec.name) } },
  systemPrompt: { section(spec) { sectionSpec = spec; return () => { sectionSpec = null } } },
}

apply(ctx, { workspace: ws })
ok(name === 'persona-hearing', `插件名：${name}`)
ok(!!version, `版本：${version}`)
const have = [...tools.keys()].sort().join(',')
ok(have === 'ear_hear,ear_receipt,ear_status,ear_take', `四个工具都在：${have}`)
ok(tools.get('ear_take').output && typeof tools.get('ear_take').output.render === 'function', '工具输出声明是 { schema, render }（不是函数）')

const st = await tools.get('ear_status').execute({})
ok(/耳：/.test(st.text), 'status 报了引擎状态')
ok(/faster-whisper/.test(st.text), 'status 说清 faster-whisper 有没有')

const miss = await tools.get('ear_hear').execute({ file: 'nope.wav' })
ok(/没这个文件/.test(miss.text), 'hear 对不存在的文件直说')

const srt = join(ws, 'demo.srt')
writeFileSync(srt, '1\n00:00:01,000 --> 00:00:03,500\n第一句听见的话\n\n2\n00:00:04,000 --> 00:00:06,000\n第二句\n', 'utf8')
const segs = parseTranscript('1\n00:00:01,000 --> 00:00:03,500\n你好\n', 'srt')
ok(segs.length === 1 && segs[0].start === 1 && Math.abs(segs[0].end - 3.5) < 1e-6, 'srt 时间码认对了')

const took = await tools.get('ear_take').execute({ file: srt, source: '自检样例' })
ok(/收进来了/.test(took.text), 'ear_take 收进来了')
const rec = await tools.get('ear_receipt').execute({ limit: 5 })
ok(/✓.*demo\.srt/.test(rec.text), '耳朵账里有一行 demo.srt')
ok(/2 句|2 段/.test(rec.text), '账上句数是 2')

if (sectionSpec) {
  const t0 = sectionSpec.text()
  ok(t0 === '', '还没走 pre-step 时段是空的')
  preStep({ agent: { session: { header: { cwd: ws } } } }, () => 'next')
  const t1 = sectionSpec.text()
  ok(/耳：这一步之前真听过 1 段/.test(t1), 'pre-step 之后注了一行')
  preStep({ agent: { session: { header: { cwd: ws } } } }, () => 'next')
  ok(sectionSpec.text() === '', '第二轮不重复注（说过就清）')
} else {
  ok(false, 'section 没注册上')
}

ok(!!briefOf({ at: '2026-11-07T10:00:00Z', ok: true, source: 'a.srt', segments: [{ text: 'hi' }], chars: 2 }), 'briefOf 出字')

for (const d of disposers) d()
rmSync(ws, { recursive: true, force: true })
console.log(`\n${fail === 0 ? '✓ 全过' : '✗ 有没过'}：${pass} 项过，${fail} 项没过`)
process.exit(fail === 0 ? 0 : 1)
