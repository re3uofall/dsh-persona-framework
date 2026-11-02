# dsh-persona-vision · 接口契约（先钉这个，再动代码）

一句话：**给只会读字的 agent 装一双会省钱的眼——看一屏、只留变了的、把看过的落成一条能翻回去的记录。**

## 为什么是它，不是又一个 vision-router

盘上已经有的，不重造：

| 已有的 | 管什么 | 谁 |
| --- | --- | --- |
| `dsh-vision-router` 3.1.0 | 把一张图给模型看（describe/ground/crop/ocr/pixel_diff…） | 已装，14 个工具 |
| `dsh-computer-use-win`（wincu） | 截屏 + UIA 读屏 + 点 | 已装，MCP |
| [`dsh-see-now`](https://github.com/SAOS-3624/dsh-see-now) | **按变化挑帧、多帧拼一张、静止不花 token** | 还没装 |
| `dsh-persona-memory` | 一条带时间来源、能 `memory_source` 翻回去的记录 | 已写 |

**这个包补的是最后两格的接缝**：看多久、看哪几帧、看完留什么。它不实现视觉模型，也不实现 UIA。

## 一条硬约束：图像只在 PowerShell/.NET 里碰

Node 侧**不引入任何图像库**（不 sharp、不 pngjs、不 jimp）。理由不是洁癖，是安装面：

- 截屏和拼图交给 PowerShell + `System.Drawing`（Windows 自带，`dsh-vision-router` 的 `lib/windows-desktop-capture.js` 也是这么干的）。
- Node 只负责：调度、传路径、算数组、写文件。

**结果**：整个包零运行时依赖。别人 `npx dsh plugin add` 不会再拖一堆 native 模块。

## 模块与签名（写区不重叠，签名不许改）

### `lib/capture.mjs` —— 眼睛（PowerShell 截屏）

```js
export async function captureFrame(opts = {}) 
// → { path, width, height, fp: number[], bytes }
//   path   PNG 绝对路径（临时目录）
//   fp     ！指纹：32×18 均值灰度，长度必须是 576，值域 0..255（整数）
// 失败必须 throw，不许返回空对象
```

- 参数：`{ outDir, monitor }`（`monitor` 暂只支持 0 = 主屏）。
- 指纹**必须**由同一趟 PowerShell 输出（截完就降采样），不许 Node 事后解码 PNG。
- 必须处理 DPI 缩放：不处理的话拿到的图是缩放的，坐标全歪。抄 vision-router 的 `SetThreadDpiAwarenessContext` 做法。

### `lib/sheet.mjs` —— 拼图（多帧一张）

```js
export async function buildSheet(frames, opts = {})
// frames: [{ path, label }]        label 会画在每格里（如 "14:03:12 +12%"）
// → { path, cols, rows, width, height }
```

- 网格排布：`cols = Math.ceil(Math.sqrt(n))`，每格等比缩到同一宽度。
- 每格左上角画 label（白字黑底，字号跟随格宽）。
- `frames` 为空要 throw；只有 1 帧也要能出图（1×1）。

### `lib/sample.mjs` —— 挑帧（纯函数，好测）

```js
export function diffScore(a, b)      // → 0..1，两边长度不一致直接 throw
export function pickFrames(fps, opts = {})
// fps: [{ fp, at, path }]
// → { kept: [...], dropped: number, changedRatio: number }
//   opts: { threshold = 0.003, maxFrames = 6 }
```

**判据写死在这里，别散到别处**：

- `diffScore` = 两张指纹里**逐格差的绝对值均值 / 255**。
- 相邻两帧 `diffScore > threshold` 才算「变了」，进 kept。
- **第一帧永远进 kept**（基准）。`kept` 最多 `maxFrames` 张；超了就按「差异大的优先」保留，不是按时间。
- 一帧都没变：`kept` 只剩第一帧，`changedRatio = 0`。
- `dropped` 是**数量**（`fps.length - kept.length`），不是丢掉的帧数组。要那些帧，自己按 `fp` 对回去——别指望这里给你一份清单。

### `lib/describe.mjs` —— 认（可选，不配就不认）

```js
export async function describeImage(path, prompt, cfg)
// → { text } | null（没配端点时返回 null，不 throw）
```

- 走 OpenAI 兼容的 `POST {baseUrl}/chat/completions`，图片 base64 内联。
- `cfg`：`{ baseUrl, model, apiKeyEnv }`。`apiKeyEnv` 为空时不带 Authorization。
- **默认不配**。没配时工具输出里要明说「这张图我没认，路径给你，你叫 `vision_describe` 认」——不许假装看过。

### `lib/ledger.mjs` —— 记（落一条进池）

```js
export function appendVisionRecord(root, record)
// record: { at, source, title, tags, body, dir }
//   at      ISO 时间串
//   source  出处（如 capture/2026-11-02/140312 或 note）
//   title   节标题（不含时间，函数自己加 HH:MM 前缀）
//   tags    string[]，写进 `- tags:`（逗号分隔）
//   body    正文，多行用 \n
//   dir     落到哪个子目录，默认为 'persona-ai/knowledge/vision'
// → { file, pointer }     pointer 形如 "vision/2026-11-02.md#3"
```

**正文由调用方给，不由 ledger 拼**：怎么描述「变了什么」是 index.js 的事，
ledger 只管格式对不对、指针数得准不准。别两头各拼一份，拼出来两套话。

- 写 `persona-ai/knowledge/vision/YYYY-MM-DD.md`（相对 `root`）。
- 格式**必须**和记忆池同构，不然 `memory_recall` / `memory_source` / `memory_trace` 都吃不到：

```md
## 14:03 看主屏：12 帧里挑了 3 帧
- tags: 视觉, 主屏
- kind: vision
- source: capture/2026-11-02/140312
- updated: 2026-11-02T14:03:12+08:00

（正文：变了什么、拼图落在哪、认没认）
```

- `#N` 是第 N 个 `##` 节（从 1 数）。同一天追加，不覆盖。

### `index.js` —— 壳

工具两个：

| 工具 | 参数 | 干什么 |
| --- | --- | --- |
| `vision_look` | `duration`(秒, 默认 3)、`interval`(秒, 默认 1)、`threshold`、`monitor`、`describe`(bool) | 截一串帧 → 挑帧 → 拼图 →（可选认）→ 落记录 |
| `vision_note` | `text` | 把「看到一句什么」直接落一条，不截图 |

输出要求（写死在 `renderLook()` 里，别各写各的）：

- 变了：`12 帧里 3 帧变了（最大差 18.4%）` + 每帧的时间与百分比 + 拼图路径
- 没变：`12 帧，一帧没变` + **不许**生成拼图（省 token 就在这一步）
- 认了：`认出来的：…`
- 没认：`这张图我没认。路径给你，要认就调 vision_describe。`
- 落盘：`记在 vision/2026-11-02.md#3`

## 三条边界（和记忆包对齐）

1. **不写内容进人格**。它只往 `knowledge/vision/` 落条目，人格文件一个字不碰。
2. **不冒充看见**。没配视觉端点就一定说没认；截图失败就说失败，不许返回「看起来没什么变化」。
3. **默认省钱**。一帧没变就不产图、不认图、只落一行「没变」——这是它存在的理由。
