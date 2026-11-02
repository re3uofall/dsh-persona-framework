/**
 * 认：把一张图交给 OpenAI 兼容的视觉端点，拿回一句人话。
 *
 * 这一块是可选的。默认不配——没配就返回 null，上层必须在输出里明说「没认」，
 * 不许假装看过。**不冒充看见**是这个包最硬的一条边界。
 *
 * 失败分两档，故意不一样：
 *   · 没配端点（没 baseUrl）→ 返回 null。这不是错，是没开这个功能。
 *   · 配了但失败（网络、超时、非 2xx）→ throw，带状态码和响应前 200 字。
 *     让调用方决定怎么报，别在这里吞掉——吞掉的错误会变成「看起来没什么变化」。
 */

import { readFileSync } from 'node:fs'
import { extname } from 'node:path'

/** 60 秒。端点慢到这都不回话，就不是慢，是挂了。 */
const TIMEOUT_MS = 60_000

/** 把响应截到 200 字——够看出是哪个错，又不至于把整页 HTML 塞进日志。 */
const MAX_ERR_CHARS = 200

function mimeOf(file) {
  switch (extname(file).toLowerCase()) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    case '.bmp': return 'image/bmp'
    default: return 'image/png'
  }
}

/**
 * @param {string} imagePath 图片绝对路径
 * @param {string} prompt 要它看什么
 * @param {{baseUrl?:string, model?:string, apiKeyEnv?:string}} cfg
 * @returns {Promise<{text:string}|null>} 没配端点时 null
 */
export async function describeImage(imagePath, prompt, cfg = {}) {
  const baseUrl = String(cfg?.baseUrl || '').trim().replace(/\/+$/, '')
  if (!baseUrl) return null

  if (!imagePath) throw new Error('describeImage 要一张图的路径，拿到的是空的')
  let buf
  try {
    buf = readFileSync(imagePath)
  } catch (e) {
    throw new Error(`describeImage 读不到图片：${imagePath}（${e?.message || e}）`)
  }
  const model = String(cfg?.model || '').trim()
  if (!model) throw new Error('describeImage 没配 model，认不了这张图')

  const headers = { 'content-type': 'application/json' }
  const keyEnv = String(cfg?.apiKeyEnv || '').trim()
  if (keyEnv) {
    const key = process.env[keyEnv]
    if (!key) throw new Error(`describeImage 要的环境变量 ${keyEnv} 是空的，认不了这张图`)
    headers.authorization = `Bearer ${key}`
  }

  const body = JSON.stringify({
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: String(prompt || '这张图里有什么？') },
        {
          type: 'image_url',
          image_url: { url: `data:${mimeOf(imagePath)};base64,${buf.toString('base64')}` },
        },
      ],
    }],
  })

  const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(TIMEOUT_MS)
    : undefined

  let res
  try {
    res = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', headers, body, signal })
  } catch (e) {
    const name = e?.name || ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new Error(`describeImage 超过 ${TIMEOUT_MS / 1000} 秒没回话：${baseUrl}/chat/completions`)
    }
    throw new Error(`describeImage 连不上 ${baseUrl}/chat/completions：${e?.message || e}`)
  }

  // ★ 先读文本再判状态码：4xx/5xx 的响应体里常常写着真正的原因，
  //   只看状态码等于把「哪个字段不对」这一句扔了。
  const raw = await res.text().catch(() => '')
  if (!res.ok) {
    const snippet = String(raw || '').trim().slice(0, MAX_ERR_CHARS) || '(空响应)'
    throw new Error(`describeImage 端点回了 HTTP ${res.status}：${snippet}`)
  }

  let data
  try {
    data = JSON.parse(raw)
  } catch {
    const snippet = String(raw || '').trim().slice(0, MAX_ERR_CHARS) || '(空响应)'
    throw new Error(`describeImage 端点回的不是 JSON：${snippet}`)
  }

  const content = data?.choices?.[0]?.message?.content
  const text = Array.isArray(content)
    ? content.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('').trim()
    : String(content ?? '').trim()

  if (!text) throw new Error('describeImage 端点回了 200，但没给出文字')
  return { text }
}
