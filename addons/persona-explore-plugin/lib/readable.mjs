/**
 * 把 HTML 压成能读的正文。没有第三方依赖：够用，不追求完美。
 *
 * 优先取 <article> / <main>；没有就取 <body>；再没有就整篇。
 * 去脚本、样式、导航；块级标签变换行；合并空白；实体解码。
 * @param {string} html
 * @returns {string}
 */
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', middot: '·', bull: '•',
  laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  copy: '©', reg: '®', trade: '™', times: '×', divide: '÷', deg: '°',
}

export function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (m, hex) => {
      try { return String.fromCodePoint(parseInt(hex, 16)) } catch { return m }
    })
    .replace(/&#(\d+);/g, (m, num) => {
      try { return String.fromCodePoint(Number(num)) } catch { return m }
    })
    .replace(/&([a-z]+);/gi, (m, name) => {
      const hit = NAMED[name.toLowerCase()]
      return hit === undefined ? m : hit
    })
}

/** 拿网页标题（没有就空串）。 */
export function titleOf(html) {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(String(html))
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim().slice(0, 160) : ''
}

/** HTML → 纯文本。 */
export function htmlToText(html) {
  if (typeof html !== 'string' || !html) return ''
  let s = html
  s = s.replace(/<!--[\s\S]*?-->/g, ' ')
  s = s.replace(/<(script|style|noscript|svg|iframe|template|object|form|canvas)\b[\s\S]*?<\/\1\s*>/gi, ' ')
  s = s.replace(/<(nav|footer|aside|header)\b[\s\S]*?<\/\1\s*>/gi, ' ')
  s = s.replace(/<!--[\s\S]*?-->/g, ' ')

  const biggest = (re) => {
    const m = re.exec(s)
    return m ? m[0] : ''
  }
  const article = biggest(/<article\b[\s\S]*?<\/article\s*>/i)
  const main = biggest(/<main\b[\s\S]*?<\/main\s*>/i)
  const body = biggest(/<body\b[\s\S]*?<\/body\s*>/i)
  const chosen = [article, main].sort((a, b) => b.length - a.length)[0]
  if (chosen && chosen.length > 400) s = chosen
  else if (body) s = body
  else {
    // 没有 body：去掉 head 就够
    s = s.replace(/<head\b[\s\S]*?<\/head\s*>/i, ' ')
  }

  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<hr\b[^>]*>/gi, '\n')
  s = s.replace(/<\/(p|div|section|article|main|h[1-6]|li|tr|blockquote|pre|dd|dt|header|footer|nav|aside|figure|figcaption)\s*>/gi, '\n')
  s = s.replace(/<(p|div|section|article|main|h[1-6]|li|tr|blockquote|pre)\b[^>]*>/gi, '\n')
  s = s.replace(/<[^>]*>/g, ' ')
  s = decodeEntities(s)
  s = s.replace(/[ \t\u00a0\u3000]+/g, ' ')
  s = s.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join('\n')
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim()
}
