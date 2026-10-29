/**
 * 自读写模块 —— 框架之外的一层。
 *
 * 它不参与「怎么想」，只管一件物理的事：**在别人的电脑上，东西该放哪、去哪找、找到什么**。
 * 框架（.persona-framework/FRAMEWORK.md）讲判断；这一层讲路径。两者互不写入。
 *
 * 三条边界：
 * - 只读不猜：找不到就说找不到，返回空串；不扫全盘、不按相似度挑。
 * - 只建空壳：目录和说明可以建，人格内容一个字不替人填。
 * - 不覆盖：已有的东西一律不碰，除非调用方明确要求写。
 */

import { existsSync, readFileSync, readdirSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

/** 工作区的骨架：建出来，人一打开就看到该往哪放。 */
export const SKELETON = [
  ['.persona-framework', '', '框架正文、心情、设置存在这里'],
  ['.persona-framework/lexicon', '字典池', '一个 .md 文件 = 一个含义；文件里列的才是各种表面说法'],
  ['.persona-framework/net', '联网池', '外面读到的：原文 + 网址 + 日期。带不出网址的只算想象'],
  ['persona-ai/characters', '人格池', '人格文件放这里：身份 / 语气 / 底线'],
  ['persona-ai/modules', '内部整合池', '怎么判断：判据、边界、反对什么样的说法'],
  ['persona-ai/knowledge/session', '经验池', '发生过的事：谁、什么情况、说了什么、做了什么'],
  ['persona-ai/knowledge/web', '外部整合池', '外面读到的，带网址和日期'],
  ['persona-ai/knowledge/world', '理论池', '世界是怎样：信什么、怎么解释因果'],
  ['knowledge', '记忆池', '跨会话要留下的东西'],
]

/** 各池的读取路径（input / bind / 池报告用同一份，别处不许另写一套）。 */
export const POOL_PATHS = {
  memory: ['knowledge', 'memory', 'persona-ai/knowledge', 'persona-ai/memory'],
  internal: 'persona-ai/modules',
  session: 'persona-ai/knowledge/session',
  web: 'persona-ai/knowledge/web',
  world: 'persona-ai/knowledge/world',
  net: '.persona-framework/net',
  lexicon: '.persona-framework/lexicon',
  framework: '.persona-framework/FRAMEWORK.md',
  modulesIndex: 'persona-ai/modules/00-目录.md',
}

const isMd = (n) => /\.md$/i.test(n) && !n.startsWith('_') && !/\.bak/i.test(n)

const safeList = (dir) => {
  try { return readdirSync(dir).filter(isMd) } catch { return [] }
}

const isFile = (p) => {
  try { return existsSync(p) && statSync(p).isFile() } catch { return false }
}

/** 人格文件里有没有写「我是谁」——有身份段的优先。 */
const hasIdentity = (p) => {
  try { return /^#{1,3}\s*(身份|你是谁|我是谁)/m.test(readFileSync(p, 'utf8')) } catch { return false }
}

/**
 * 建骨架。只在目录空着时往里放说明；已有内容一律不碰。
 * @returns {{root:string, made:string[], skipped:string[], personaShell:boolean}}
 */
export function ensureWorkspace(root, { personalityFile = '', warn = () => {} } = {}) {
  const made = []
  const skipped = []
  const mk = (dir) => {
    try {
      if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); made.push(dir) }
    } catch (error) { warn(error) }
  }

  for (const [rel, title, why] of SKELETON) {
    const dir = join(root, rel)
    let wasEmpty = false
    try { wasEmpty = !existsSync(dir) || readdirSync(dir).length === 0 } catch { wasEmpty = false }
    mk(dir)
    if (!title || !wasEmpty) { skipped.push(rel); continue }
    const note = join(dir, '_说明.md')
    try {
      if (!existsSync(note)) {
        writeFileSync(note, `# ${title}（这个文件是占位说明）\n\n${why}\n\n这行以上删掉都行；放什么进来，按自己的来。\n`, 'utf8')
      }
    } catch (error) { warn(error) }
  }

  // 人格文件：一份都没有才放空壳。只给三个标题，一个字不替人填。
  const pdir = join(root, 'persona-ai', 'characters')
  let personaShell = false
  try {
    const configured = String(personalityFile || '').trim()
    const hasConfigured = configured && existsSync(configured)
    const inDir = safeList(pdir)
    const inRoot = safeList(root)
    if (!inDir.length && !hasConfigured && !inRoot.length) {
      writeFileSync(join(pdir, '人格.md'), [
        '# 人格文件（自动生成：把下面三段填上，插件就认）',
        '',
        '> 只认小标题。三段是必填：身份 / 语气 / 底线。',
        '',
        '## 身份',
        '',
        '（叫什么、是谁、住在哪。一句话就够，别抄模板。）',
        '',
        '## 语气',
        '',
        '（句子多长、怎么称呼人、有什么口头禅。说不出就不写。）',
        '',
        '## 底线',
        '',
        '（哪些事绝对不做。这一条得是自己的，不是抄来的。）',
        '',
      ].join('\n'), 'utf8')
      personaShell = true
    }
  } catch (error) { warn(error) }

  return { root, made, skipped, personaShell }
}

/**
 * 找人：配置里填了就按它；没填、或填的路径不在，就在工作区里按顺序找。
 * 顺序：persona-ai/characters → characters → 工作区根目录。
 * 同一目录里：空壳「人格.md」排最后，带身份段的优先，再按体积从大到小。
 * @returns {string} 路径；一个都没有就返回空串（池子会明说「空着」）。
 */
export function pickPersonaFile(root, configured = '') {
  const want = String(configured || '').trim()
  if (want && isFile(want)) return want
  if (!root) return ''

  for (const rel of ['persona-ai/characters', 'characters', '']) {
    const dir = rel ? join(root, rel) : root
    const names = safeList(dir)
    if (!names.length) continue
    const cands = names.map((n) => join(dir, n)).filter(isFile)
    if (!cands.length) continue
    const rank = (p) => (basename(p) === '人格.md' ? 1 : 0)
    cands.sort((a, b) => rank(a) - rank(b))
    const withId = cands.filter(hasIdentity)
    if (withId.length) return withId[0]
    try { cands.sort((a, b) => statSync(b).size - statSync(a).size) } catch { /* 保持原序 */ }
    return cands[0]
  }
  return ''
}

/** 看一眼现状：给设置页和 input 用，不写任何东西。 */
export function inspectWorkspace(root, { personalityFile = '' } = {}) {
  const dirs = SKELETON.map(([rel, title]) => {
    const dir = join(root, rel)
    const names = title ? safeList(dir) : []
    return { rel, title, exists: existsSync(dir), files: names.length }
  })
  return {
    root,
    dirs,
    persona: pickPersonaFile(root, personalityFile),
    lexicon: safeList(join(root, POOL_PATHS.lexicon)).length,
    net: existsSync(join(root, POOL_PATHS.net)),
  }
}
