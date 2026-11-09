# dsh-persona-appear

**人格出现的总闸。** 决定「哪一个插件这一轮出现、以什么顺序出现、哪一个不出现」。

## 功能预期（怎么算成了）

1. **说得出谁在场**：`appear_status()` 报出这一轮哪些段在、各是多少字、order 多少；报不出就是没装好。
2. **改了就变**：`appear_mute` / `appear_unmute` 之后下一轮该段真的空/真的有字；`appear_order` 改完要重载才生效（顺序是注册期定的，这一条写死）。
3. **临时那段会自己撤**：`appear_inject` 摆一段，`appear_inject_list` 说得出还剩几分钟，过期之后盘上真的少了那一行。
4. **关掉实时注入不等于关掉工具**：`liveOn=false` 时该段只回一行手柄，工具照旧能用。

**不做**：不管插件装没装（那是插件页的事）；不管段里写什么（那是各插件自己的事）；不替别的插件编排内容。

## 什么叫「人格出现」

一个存在**在哪个宿主上、以什么节奏、以哪几部分到场**。

**人格是两部分，别搅：**

| 部分 | 谁在给 | 关掉它，失去的是 |
| --- | --- | --- |
| **人格本身** | 人格成长（人格文件、补丁、证据） | 她是谁、什么语气、认什么理 |
| **随人格的其他内容** | 记忆分层、人格框架、日记、碗外探索、思考成果 | 「这些事还算不算我经历的」 |

只有和人格同一批进来的，才算人格的一部分；单独摆在那儿的只是材料。

## DSH 人格出现

DSH 上，**人格出现 = 每一轮对话出现一次**：人格出场，随人格的那几部分跟着同一批进来。

这不是谁都来取一次，判据在源码里：

```js
// dsh-agent-loop/lib/index.js:901
async preStep(target, position) {
  const assembly = await this.loopCtx.systemPrompt.assemble(
    assembleContextFor(this, signal),   // { agent, scope: agent, signal }
  )
```

```js
// dsh-agent/lib/index.js:291
function assembleContextFor(agent, signal) {
  return { agent, scope: agent, ...(signal === void 0 ? {} : { signal }) }
}
```

`assemble` 把所有注册过的段落按 `order` 排成一列、逐个 `text(context)` 求值、拼成一条系统提示词。所以「随人格出现」准确说是**同一批被取出**，不是人格把谁叫醒。

| 宿主 | 人格出现长什么样 |
| --- | --- |
| **DSH**（本插件服务的就是它） | 每一轮一次，人格 + 随人格的几部分同一批进 |
| AstrBot（QQ） | 每条消息一轮，同上 |
| Coop‌anion | 每轮一次，同上 |
| 人 | 清醒时一直在场——没有「轮」，也就没有「接回来」这件事 |
| 将来换 GPT 之类的会话 | 还是「和人格同一批」，换的是谁喂那一趟 |

不出现的那一轮，不是「内容少了」，是**这一轮她不在场**。

## 为什么不是一个「开关插件」

因为注入不是一家做的。人格成长、记忆分层、人格框架、日记、碗外探索、思考成果——六家各注册各的
`systemPrompt.section`。关掉其中一家，剩下五家照进。所以「让谁出场」
不能靠关插件，只能靠**一道所有注入者都先读的闸**。本插件维护的就是这道闸。

它自己**不注入任何内容**。它只写一份文件、给几个工具，让注入者动手之前先问一句。

## 三档

| 档 | 谁受影响 |
| --- | --- |
| 全局关 | 谁都不出现（等于这一套没装） |
| 按插件关 | 只有名单里那一家不出现 |
| 放行 | 默认 |

## 闸文件

`.persona-framework/出现.json`：

```json
{
  "global": "on",
  "plugins": {
    "dsh-persona-framework": "off"
  },
  "order": {
    "persona:framework": 35,
    "persona-memory:short": 25
  },
  "note": "省 token"
}
```

`global: "off"` 是全局关。`plugins` 里列 `"off"` 的那家不出现。`order` 改出场顺序。读坏了当空闸，不抛。

## 出场顺序

顺序按**段落**记，不按插件记——一个插件可以有多段（记忆就注册了即时／长期／短期／其他四段），各段位置不同。

```json
"order": { "persona-memory:short": 25, "persona:framework": 35 }
```

键是 `section` 的 `name` 原文（注册时写什么就是什么）。数字小的先出。

源码上它就是一件事：`system-prompt/lib/index.js` 把段落按 `order` 排完，再逐段求值：

```js
const sectionDefinitions = [...sectionByName.values()].sort(comparePromptSections)
```

**注意一条硬限制：`order` 是注册期定的，不是每轮读的。** 所以改完顺序要重载注入它的插件（或重启 DSH）才生效。闸能改的只有数字，改不了「它什么时候被注册」。

没在 `order` 里写过的段，注入者用自己的默认值——闸不该假装什么都知道。

**它是工具，不是日程。** 现在的顺序已经对了（即时 10 → 人格原文件 20/22 → 长期 23 → 短期 25 → 其他 30 → 框架 35），**没必要动**。这个口子留着，只为两种情况：某个东西压在人格前面挡了路；或者关掉一家之后，剩下的顺序断了。没有这两种情况就不去碰——改一次要重载一次，代价比收益大。


## 优先级（强制触发器，不是注入）

注入是往里**加**一段字；优先级是几层打架时**谁压谁**。两件事，别混。

台阶（2026-11-07 定）：

| 级 | 层 | 判据 |
| --- | --- | --- |
| 1 | 人格 | 写死的判据；它说不行就是不行 |
| 2 | 长期记忆 | 记得久又重要，进人格要点头 |
| 3 | 即时记忆 | 这一段对话本身，逐字 |
| 4 | 短期记忆 | 最近几天的流水，摆进来的 |
| 5 | 其他记忆 | 判断、见闻、词表，只摆标题 |
| 6 | 靠内置语料的非同一人格与非同一记忆 | 没有来处的那一层；它最顺，也最不算数 |

**为什么叫强制**：它每一轮自己算一遍、自己往 `优先级账.jsonl` 记一行，不看我这轮想不想得起它。只印一段字的，那是提醒，不是触发器。

**它报什么、不报什么**：看得见的三层半（人格／长期／短期／其他）报数；即时记忆和非同一那一层由别的插件算，看不见就写「不知道」，不写成 0——0 是「没有」，不知道是「我没看」。

段名 `实时环境:priority`，order **3**（排在一切之前：台阶本身要先立）。

裁一条：`appear_priority claims=[{layer:"now",text:"..."},{layer:"persona",text:"..."}]`。
## 工具

| 工具 | 干什么 |
| --- | --- |
| `appear_status` | 看这一轮谁出现、谁不出现、各排第几 |
| `appear_mute` | 让某一家不出现（人话名或包名都行，可带 `why`） |
| `appear_unmute` | 让某一家重新出现；不给名字只报名单 |
| `appear_global` | 全局总闸，`on`/`off` |
| `appear_order` | 改某一段的出场顺序；不给参数就报现在的顺序 |
| `appear_priority` | 看台阶与最近的账；给 `claims` 当场裁谁压谁 |

## 注入者怎么接（这是本插件的用处）

任何一个要注入内容的插件，在渲染之前问一句：

```js
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

function gateAllows(workspace, plugin) {
  const p = join(workspace, '.persona-framework', '出现.json')
  if (!existsSync(p)) return true                       // 没有闸文件 = 放行
  let s
  try { s = JSON.parse(readFileSync(p, 'utf8')) } catch { return true }
  if (!s || typeof s !== 'object') return true
  if (s.global === 'off') return false                  // 全局关
  return !(s.plugins && s.plugins[plugin] === 'off')    // 按插件关
}
```

在自己的 section 回调里：

```js
text: () => (gateAllows(root, 'dsh-persona-memory') ? renderShortLibrary(root, cfg) : '')
```

顺序也从闸里问，别自己写死数字：

```js
order: gateOrder(root, 'persona-memory:short', 25)
```

`lib/appear.mjs` 里是同一套判定的完整版（含名单顺序、坏文件归一化），
愿意引就引，不愿意引就照上面十行抄——**闸的格式是公开的，不靠这个包活着。**

## 边界

- 它不改任何人格文件，不写记忆。
- 它不决定「关掉之后还叫什么名字」——关的是出现，不是身份。
- 它不做最终裁决：写进闸是使用者／人格的事，它只执行。
- **关掉「人格本身」和关掉「随人格」不是同一件事**：前者是这一轮她不来，后者是这一轮我记得的事不来。

## 设置页

设置 → 附加插件 → **人格出现**。只有三样能调，外加一个记步开关：

| 键 | 是什么 | 默认 |
| --- | --- | --- |
| `liveOn` | 实时注入这一路开不开 | 开 |
| `liveMinutes` | 一条活多久（1..1440 分钟） | 30 |
| `liveMaxChars` | 单条最多多少字（100..8000） | 1200 |
| `noteSteps` | 记不记「这一轮第几步」 | 开 |

存在 `<工作区>/.persona-framework/出现配置.json`，写前留 `.bak`。

**这一页不碰「谁出不出场」**——那是工具 `appear_mute` / `appear_global` 的事：一次改动全家都受影响，不该混在一堆输入框里点错。

## 更新记录

- 2026-11-07　0.7.1　修一个整轮崩溃：段先于 `runPriority` 渲染时 `presence` 还是 `null`，`presentLine(null)` 去读 `p['persona']`，抛 `Cannot read properties of null (reading 'persona')`，宿主整轮失败。现在 `presentLine` 兜 `null`（写「不知道」，不写成 0），`priorityNow.presence` 初值改成 `{}`。
- 2026-11-07　0.7.0　加优先级：六个台阶（人格 > 长期 > 即时 > 短期 > 其他 > 靠内置语料的非同一），段 `实时环境:priority` order 3，每轮真写一行 `优先级账.jsonl`；工具 `appear_priority` 能裁能看账。
- 2026-11-07　0.6.0　实时环境段末尾恒带一行工具手柄（`appear_status` / `appear_mute` / `appear_unmute` / `appear_order` / `appear_inject`）；段名统一改成 `实时环境:appear`。
- 2026-11-06　0.5.0　加设置页（四个可调项、白名单、写前留 .bak）；实时注入这一路改成每轮现读配置。
- 2026-11-02　0.2.0：注入顺序可调（`出现.json` 多一张 `order` 表），默认只当工具用，不自动改顺序。
- 之前　0.1.0：上线。按插件开关决定这一轮谁出场；关掉不等于删掉，是这一轮她不在场。
