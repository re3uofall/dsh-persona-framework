/**
 * 试跑账 —— 抄自 dsh-soul 2.1 的「成对回放」纪律，只抄那四步，不抄它的库。
 * ============================================================================
 * 它的演化是：记录偏差 → 定位组件 → 改框架 → 结构检查 → 成对回放 → 影子试用 → 回滚。
 * 我这边能落地的最小一份，是「成对回放」这一步：
 *
 *   改之前跑一遍同一批检查，把结果刻下来（pass/fail + 输出指纹）；
 *   改之后再跑同一批，跟刻下来的那份比；
 *   不一样就不留——不是「我觉得没问题」，是同一批检查给出了不同的字。
 *
 * 那一批检查是谁？就是这个包自己的 `selfcheck.mjs`。
 * 它已经是「同一批」了：同一份脚本、同一批断言、同一台机器。
 * 我没有 bench 里那 300 个合成场景，所以这份纪律只覆盖自检这一层——
 * 覆盖窄就写窄，不假装它等于回放全部。
 *
 * 不抄它的代码，因为它的回放绑在它自己的事件库格式上（`src/store.js` 的 schema），
 * 整包搬过来会把它的数据格式一起搬进来。这里只借形状。
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const TRIAL = {
  dir: '.persona-framework',
  file: '试跑账.jsonl',
  maxKeep: 200,
  timeoutMs: 120000,
}

/** 这个包的根目录（lib/ 的上一级）。自检脚本就在那儿。 */
export function packageDir() {
  return fileURLToPath(new URL('../', import.meta.url))
}

export function trialDir(ws, opts = {}) {
  return join(ws || process.cwd(), opts.dir || TRIAL.dir)
}

export function trialFile(ws, opts = {}) {
  return join(trialDir(ws, opts), opts.file || TRIAL.file)
}

export function loadTrials(ws, opts = {}) {
  const p = trialFile(ws, opts)
  if (!existsSync(p)) return []
  const out = []
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch { /* 坏行跳过，不连坐 */ }
  }
  return out
}

export function appendTrial(ws, row, opts = {}) {
  const p = trialFile(ws, opts)
  mkdirSync(dirname(p), { recursive: true })
  appendFileSync(p, JSON.stringify(row) + '\n', 'utf8')
  return row
}

/**
 * 跑一次同一批检查：`node selfcheck.mjs`。
 * 只认两样：过了几项、没过几项、输出指纹。不解析具体是哪条挂了，
 * 因为「哪条挂了」是给眼睛看的，比对只需要一个能判等的东西。
 */
export function runChecks(opts = {}) {
  const dir = opts.dir || packageDir()
  const script = join(dir, 'selfcheck.mjs')
  if (!existsSync(script)) {
    return { ok: false, why: `没有自检脚本：${script}`, pass: null, fail: null, hash: null, tail: '' }
  }
  const r = spawnSync(process.execPath, [script], {
    cwd: dir,
    encoding: 'utf8',
    timeout: opts.timeoutMs || TRIAL.timeoutMs,
    windowsHide: true,
  })
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim()
  // 自检的收尾句是「全部过了：N 项过，M 项没过」或「通过 X，失败 Y」——两种都认。
  const m = out.match(/过了[：:]\s*(\d+)\s*项过[，,]\s*(\d+)\s*项没过/) || out.match(/通过\s*(\d+)\s*[，,]\s*失败\s*(\d+)/)
  const pass = m ? Number(m[1]) : null
  const fail = m ? Number(m[2]) : null
  return {
    ok: r.status === 0 && fail === 0,
    status: r.status,
    pass,
    fail,
    hash: createHash('sha1').update(out).digest('hex').slice(0, 12),
    tail: out.split(/\r?\n/).slice(-3).join(' / ').slice(0, 300),
  }
}

/** 刻一份：改之前的同一批检查。 */
export function recordBaseline(ws, { label = 'before', dir } = {}, opts = {}) {
  const res = runChecks({ ...opts, dir })
  const row = { at: new Date().toISOString(), kind: 'baseline', label, ...res }
  appendTrial(ws, row, opts)
  return row
}

/**
 * 比一份：改之后的同一批检查，跟最近一次同名 label 的基线比。
 * 判据是「同一批检查吐出同一批字」——多一项少一项、指纹不同，都算不一致。
 */
export function compareWithBaseline(ws, { label = 'before', dir } = {}, opts = {}) {
  const rows = loadTrials(ws, opts)
  const base = [...rows].reverse().find((r) => r.kind === 'baseline' && r.label === label)
  const now = { at: new Date().toISOString(), ...runChecks({ ...opts, dir }) }
  const row = { kind: 'check', label, ...now }
  appendTrial(ws, row, opts)
  if (!base) {
    return { ok: false, why: `账上没有 label=${label} 的基线——先记一份，再改。`, now }
  }
  const same =
    base.pass === now.pass &&
    base.fail === now.fail &&
    base.hash === now.hash
  return {
    ok: same && now.ok,
    same,
    base: { at: base.at, pass: base.pass, fail: base.fail, hash: base.hash, tail: base.tail },
    now,
    diff: same
      ? []
      : [
          base.pass !== now.pass ? `过的项：${base.pass} → ${now.pass}` : null,
          base.fail !== now.fail ? `没过的项：${base.fail} → ${now.fail}` : null,
          base.hash !== now.hash ? `输出指纹：${base.hash} → ${now.hash}` : null,
        ].filter(Boolean),
  }
}

export function renderTrial(result) {
  if (!result) return ''
  if (result.why) return `试跑：${result.why}`
  const { base, now, same, diff } = result
  const lines = []
  lines.push(same ? '试跑：跟基线一致（同一批检查吐出同一批字）' : '试跑：跟基线不一致——这一版不留')
  lines.push(`- 改前 ${base.at}｜过 ${base.pass ?? '?'}、没过 ${base.fail ?? '?'}｜指纹 ${base.hash}`)
  lines.push(`- 改后 ${now.at}｜过 ${now.pass ?? '?'}、没过 ${now.fail ?? '?'}｜指纹 ${now.hash}`)
  if (diff.length) lines.push('- 差在：' + diff.join('；'))
  if (now.tail) lines.push(`- 改后最后一行：${now.tail}`)
  return lines.join('\n')
}

export function renderTrialList(ws, opts = {}) {
  const rows = loadTrials(ws, opts)
  if (!rows.length) return '试跑账还是空的：先记一份基线（action=record），改完了再比（action=check）。'
  const lines = ['试跑账（最近几条）']
  for (const r of rows.slice(-8).reverse()) {
    lines.push(`- ${r.at}｜${r.kind}｜${r.label}｜过 ${r.pass ?? '?'}、没过 ${r.fail ?? '?'}｜${r.hash}`)
  }
  lines.push('', '判据：同一批检查（这个包自己的 selfcheck）吐出同一批字才算过；改了参数、改了文案、改了顺序，都算改。')
  return lines.join('\n')
}
