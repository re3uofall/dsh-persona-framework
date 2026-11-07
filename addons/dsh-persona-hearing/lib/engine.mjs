/**
 * engine.mjs —— 耳朵的引擎探测与调用
 * ============================================================================
 * 学 `dsh-cixisound` 的做法：**不在装载时装依赖**，装载只报状态；
 * 真正要听的时候才用引擎，缺什么就说什么，不假装。
 *
 * 探测三样：
 *   1. python（解释器，`py -3` 或 `python`）；
 *   2. ffmpeg（解码音频；mp3/m4a/wav 多数要它）；
 *   3. faster-whisper（模型库，`python -c "import faster_whisper"`）。
 *
 * 判据：三样齐才 `ready: true`；缺哪样进 `missing`，`hint` 说补哪一条。
 * ============================================================================
 */
import { execFileSync } from 'node:child_process'

const TIMEOUT = 12000

function run(bin, args, opts = {}) {
  try {
    const out = execFileSync(bin, args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: opts.timeout || TIMEOUT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, out: String(out || '') }
  } catch (e) {
    return { ok: false, err: String((e && (e.stderr || e.message)) || e) }
  }
}

/** 找一个能用的 python：先 `py -3 -V`，再 `python -V`。 */
export function pythonPath() {
  const a = run('py', ['-3', '-V'])
  if (a.ok) return { bin: 'py', prefix: ['-3'], version: a.out.trim() }
  const b = run('python', ['-V'])
  if (b.ok) return { bin: 'python', prefix: [], version: b.out.trim() }
  return null
}

export function hasFfmpeg() {
  return run('ffmpeg', ['-version']).ok
}

export function hasFasterWhisper(py) {
  if (!py) return false
  return run(py.bin, [...py.prefix, '-c', 'import faster_whisper,sys;print(faster_whisper.__version__)']).ok
}

/** 一次问清三样。 */
export function probe(opts = {}) {
  const py = opts.python === null ? null : pythonPath()
  const ffmpeg = opts.ffmpeg === false ? false : hasFfmpeg()
  const fw = opts.fasterWhisper === true ? true : hasFasterWhisper(py)
  const missing = []
  if (!py) missing.push('python')
  if (!ffmpeg) missing.push('ffmpeg')
  if (!fw) missing.push('faster-whisper')
  return {
    ready: missing.length === 0,
    python: py ? py.version : '',
    ffmpeg,
    fasterWhisper: fw,
    model: opts.model || 'small',
    missing,
    hint: missing.length
      ? `缺 ${missing.join('、')}：装 python 3.10+，再 \`pip install faster-whisper\`；ffmpeg 放 PATH。没引擎也能用 ear_take 收已经转好的文本。`
      : '引擎齐了：ear_hear 可以直接听。',
  }
}

/** 把秒数写成 00:01:23.4 */
export function stamp(sec) {
  const s = Math.max(0, Number(sec) || 0)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = (s % 60).toFixed(1)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${r.padStart(4, '0')}`
}

/**
 * 真转写。引擎不齐就直接回 `ok:false` + `reason`，绝不给假时间码。
 * 引擎齐时才起 python（内联脚本，不落临时文件），把 JSON 从 stdout 收回来。
 */
export function transcribe(file, opts = {}) {
  const p = probe(opts)
  if (!p.ready) return { ok: false, reason: `引擎不齐：缺 ${p.missing.join('、')}`, hint: p.hint, segments: [] }
  const py = pythonPath()
  const script = [
    'import json,sys',
    'from faster_whisper import WhisperModel',
    'path=sys.argv[1]; model=sys.argv[2]; lang=sys.argv[3] or None',
    'm=WhisperModel(model, device="cpu", compute_type="int8")',
    'segs,_=m.transcribe(path, language=lang, vad_filter=True)',
    'out=[{"start":s.start,"end":s.end,"text":s.text.strip()} for s in segs]',
    'print(json.dumps({"ok":True,"segments":out}, ensure_ascii=False))',
  ].join('\n')
  const r = run(py.bin, [...py.prefix, '-c', script, file, String(opts.model || p.model), String(opts.lang || '')], { timeout: 30 * 60 * 1000 })
  if (!r.ok) return { ok: false, reason: `引擎跑挂了：${String(r.err).split('\n')[0]}`, segments: [] }
  try {
    const j = JSON.parse(r.out.trim() || '{}')
    return { ok: true, segments: Array.isArray(j.segments) ? j.segments : [] }
  } catch {
    return { ok: false, reason: '引擎回来了，但不是 JSON——不猜内容', segments: [] }
  }
}
