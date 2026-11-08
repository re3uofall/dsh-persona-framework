/**
 * dsh-persona-vision —— host 半端
 * ============================================================================
 * 一句话：给只会读字的 agent 装一双会省钱的眼——看一屏、只留变了的、把看过的
 * 落成一条能翻回去的记录。
 *
 * 它不重造盘上已经有的那两样，只补它们之间的缝：
 *   · 截屏 + 指纹 + 拼图   → 本包（PowerShell / .NET，零第三方依赖）
 *   · 认图                 → 默认交给已装的 vision-router 的 vision_describe；
 *                            想让它自己认，在配置里填 vision.baseUrl。
 *   · 落盘                 → persona-ai/knowledge/vision/，跟记忆池同构，
 *                            所以 memory_recall / memory_source / memory_trace 都吃得到。
 *
 * 两个工具：
 *   vision_look   看一次（截一串帧 → 挑帧 → 拼图 →（可选认）→ 落记录）
 *   vision_note   记一句「看到什么」，不截图
 *
 * 三条边界：
 *   · 不写内容进人格：只往里看，不往里改。
 *   · 不冒充看见：没配视觉端点就一定说没认。
 *   · 默认省钱：一帧没变就不产图、不认图、只落一行「没变」。
 * ============================================================================
 */
import { captureFrame } from './lib/capture.mjs'
import { buildSheet } from './lib/sheet.mjs'
import { pickFrames, diffScore } from './lib/sample.mjs'
import { describeImage } from './lib/describe.mjs'
import { appendVisionRecord } from './lib/ledger.mjs'

export const name = 'persona-vision'
export const version = '0.1.2'
export const inject = ['tools']

const DEFAULTS = {
  /** 工作区根。空 = 用会话工作区。 */
  root: '',
  /** 记录落在哪（相对工作区根） */
  ledgerDir: 'persona-ai/knowledge/vision',
  /** 截图和拼图的临时落点（相对工作区根） */
  frameDir: '.persona-framework/vframes',
  /** 一次 vision_look 默认看几秒 */
  durationSeconds: 3,
  /** 每几秒抓一帧 */
  intervalSeconds: 1,
  /** 变化判据：相邻两帧指纹差的均值 > 这个数才算「变了」 */
  threshold: 0.003,
  /** 最多留几帧拼一张图 */
  maxFrames: 6,
  /** 拼图每格宽度（像素） */
  tileWidth: 480,
  /** 认图端点（不填 = 不自己认） */
  vision: { baseUrl: '', model: '', apiKeyEnv: '' },
  /** 往系统提示里加一段「怎么看」的说明 */
  hint: true,
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function cfgOf(config) {
  const c = { ...DEFAULTS, ...(config || {}) }
  c.vision = { ...DEFAULTS.vision, ...(config?.vision || {}) }
  return c
}

async function wd(ctx, cfg) {
  if (cfg.root) return cfg.root
  try {
    const v = await ctx?.get?.('workspace')
    if (typeof v === 'string' && v) return v
    if (v?.cwd) return v.cwd
  } catch { /* 落空 */ }
  try {
    const d = await ctx?.get?.('workingDirectory')
    const dir = typeof d === 'string' ? d : d?.defaultDirectory
    if (dir) return dir
  } catch { /* 落空 */ }
  return process.cwd()
}

function hhmmss(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function hhmm(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 输出格式写死在这，别各写各的 */
function renderLook(r) {
  const L = []
  if (r.error) {
    L.push(`这次没看成：${r.error}`)
    L.push('**这不是「没什么变化」，是没看到。** 修好再试。')
    return L.join('\n')
  }
  if (r.changed === 0) {
    L.push(`${r.total} 帧，一帧没变。`)
    L.push(`（阈值 ${r.threshold}；这 ${r.duration} 秒屏幕上没有任何一块动过。）`)
  } else {
    L.push(`${r.total} 帧里 ${r.kept.length} 帧变了（最大差 ${(r.maxRatio * 100).toFixed(1)}%）。`)
    for (const k of r.kept) L.push(`· ${k.label}`)
    L.push(`拼图：${r.sheetPath}`)
  }
  if (r.describe) L.push(`认出来的：${r.describe}`)
  else if (r.sheetPath) L.push('这张图我没认。路径给你，要认就调 vision_describe。')
  if (r.pointer) L.push(`记在 ${r.pointer}`)
  return L.join('\n')
}

const textOutput = {
  schema: {
    type: 'object',
    properties: { text: { type: 'string', description: '给模型看的结果正文' } },
    required: ['text'],
    additionalProperties: false,
  },
  render(_args, value) {
    return [{ type: 'text', text: String(value?.text ?? '') }]
  },
}

export function apply(ctx, config = {}) {
  const cfg = cfgOf(config)

  const tools = [
    {
      name: 'vision_look',
      description:
        '看一眼屏幕（Windows 主屏）：截一串帧、按变化挑帧、把变了的拼成一张图。' +
        '静止画面几乎不花 token——一帧没变就不产图。看过的会落一条带时间来源的记录（能 memory_source 翻回去）。' +
        '没配视觉端点时，它不会假装看过：只把图路径交给你，让你用手上已装的 vision_describe 去认。',
      parameters: {
        type: 'object',
        properties: {
          duration: { type: 'number', description: '看几秒，默认取配置 durationSeconds（3）' },
          interval: { type: 'number', description: '每几秒抓一帧，默认取配置 intervalSeconds（1）' },
          threshold: { type: 'number', description: '变化阈值，默认取配置 threshold（0.003）' },
          maxFrames: { type: 'number', description: '最多留几帧，默认取配置 maxFrames（6）' },
          describe: { type: 'boolean', description: '配了视觉端点时，是否顺手认一下（默认 true；没配端点时无效果）' },
          prompt: { type: 'string', description: '认图时问什么（默认「这一屏是什么？变了什么？」）' },
        },
      },
      output: textOutput,
      execute: async (args = {}) => {
        const root = await wd(ctx, cfg)
        const duration = Number(args.duration ?? cfg.durationSeconds)
        const interval = Number(args.interval ?? cfg.intervalSeconds)
        const threshold = Number(args.threshold ?? cfg.threshold)
        const maxFrames = Number(args.maxFrames ?? cfg.maxFrames)

        if (!(duration > 0)) throw new Error('vision_look：duration 必须大于 0')
        if (!(interval > 0)) throw new Error('vision_look：interval 必须大于 0')
        if (interval > duration) throw new Error('vision_look：interval 不能大于 duration（那样只截一帧）')

        const frameDir = cfg.frameDir
        const total = Math.max(2, Math.floor(duration / interval) + 1)

        let frames
        try {
          frames = []
          for (let i = 0; i < total; i++) {
            const f = await captureFrame({ root, outDir: frameDir })
            frames.push({ ...f, label: hhmmss(new Date()) })
            if (i < total - 1) await sleep(interval * 1000)
          }
        } catch (e) {
          return { text: renderLook({ error: `截屏失败（${e?.message || e}）` }) }
        }

        const picked = pickFrames(
          frames.map((f) => ({ fp: f.fp, at: f.label, path: f.path })),
          { threshold, maxFrames },
        )
        const keptPaths = new Set(picked.kept.map((k) => k.path))
        const kept = frames
          .filter((f) => keptPaths.has(f.path))
          .map((f, i, arr) => {
            const prev = arr[i - 1]
            const ratio = prev ? diffScore(prev.fp, f.fp) : 0
            return { ...f, ratio, label: `${f.label}${prev ? ` +${(ratio * 100).toFixed(1)}%` : ' 起'}` }
          })
        const maxRatio = kept.reduce((m, k) => Math.max(m, k.ratio), 0)
        const changed = picked.changedRatio > 0 ? kept.length - 1 : 0

        // 一帧没变：不产图、不认图——省 token 就在这一步
        if (changed === 0) {
          const rec = appendVisionRecord(root, {
            dir: cfg.ledgerDir,
            at: new Date().toISOString(),
            source: `capture/${new Date().toISOString().slice(0, 10)}/${hhmmss().replace(/:/g, '')}`,
            title: `看主屏：${total} 帧一帧没变`,
            tags: ['视觉', '主屏'],
            body: `这 ${duration} 秒里屏幕没动过（阈值 ${threshold}，共抓 ${total} 帧）。没产图，也没认图。`,
          })
          return {
            text: renderLook({
              total, changed: 0, kept: [], maxRatio: 0,
              threshold, duration, pointer: rec.pointer,
            }),
          }
        }

        // 拼图
        let sheet
        try {
          sheet = await buildSheet(kept.map((k) => ({ path: k.path, label: k.label })), {
            root,
            outDir: frameDir,
            tileWidth: cfg.tileWidth,
          })
        } catch (e) {
          return { text: renderLook({ error: `拼图失败（${e?.message || e}）` }) }
        }

        // 认图（可选的）
        let described = null
        let describeErr = null
        if (args.describe !== false && cfg.vision.baseUrl) {
          try {
            const r = await describeImage(
              sheet.path,
              args.prompt || '这一屏是什么？跟前面比，变了什么？只说变化与关键内容，别复述整屏。',
              cfg.vision,
            )
            described = r?.text || null
          } catch (e) {
            describeErr = e?.message || String(e)
          }
        }

        const bodyLines = [
          `${total} 帧里 ${kept.length} 帧变了（最大差 ${(maxRatio * 100).toFixed(1)}%）。`,
          `变了的那几帧：${kept.map((k) => k.label).join(' / ')}`,
          `拼图：${sheet.path}`,
          described ? `认出来的：${described}` : '这张图我没认（没配视觉端点，或这次没让认）。',
        ]
        if (describeErr) bodyLines.push(`认图报错：${describeErr}`)

        const rec = appendVisionRecord(root, {
          dir: cfg.ledgerDir,
          at: new Date().toISOString(),
          source: `capture/${new Date().toISOString().slice(0, 10)}/${hhmmss().replace(/:/g, '')}`,
          title: `看主屏：${total} 帧里挑了 ${kept.length} 帧`,
          tags: ['视觉', '主屏'],
          body: bodyLines.join('\n'),
        })

        return {
          text: renderLook({
            total, changed, kept, maxRatio, threshold, duration,
            sheetPath: sheet.path, describe: described, pointer: rec.pointer,
          }),
        }
      },
    },
    {
      name: 'vision_note',
      description:
        '把「看到一句什么」直接落成一条记录，不截图。适合：别人给你看了图、你从别处知道了屏幕上是什么、' +
        '或者你要把一句判断挂到视觉那本账上（之后 memory_source 能翻回来）。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '看到的/要记下来的那一句' },
          title: { type: 'string', description: '标题（可省，默认取正文前二十字）' },
        },
        required: ['text'],
      },
      output: textOutput,
      execute: async (args = {}) => {
        const text = String(args.text || '').trim()
        if (!text) throw new Error('vision_note：text 不能空')
        const root = await wd(ctx, cfg)
        const title = String(args.title || text.slice(0, 20)).trim()
        const rec = appendVisionRecord(root, {
          dir: cfg.ledgerDir,
          at: new Date().toISOString(),
          source: 'note',
          title,
          tags: ['视觉', '手记'],
          body: text,
        })
        return { text: `记在 ${rec.pointer}` }
      },
    },
  ]

  for (const t of tools) ctx.tools?.register?.(t)

  if (cfg.hint) {
    try {
      ctx.systemPrompt?.section?.({
        name: 'persona-vision',
        order: 40,
        text: [
          '【怎么看】vision_look 只看变了的：静止画面不产图。',
          '它默认不认图——给你路径，让你叫 vision_describe。没认就明说没认，别拿「图里有」当你看过。',
          '看过的落在 persona-ai/knowledge/vision/，能 memory_source 翻回去。',
        ].join('\n'),
      })
    } catch { /* 挂不上就不挂：它不是功能，只是提示 */ }
  }
}

export { renderLook, hhmm }
