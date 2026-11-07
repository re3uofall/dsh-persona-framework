# dsh-persona-mouth

> 一句话：**说「真说出去了」，不是「打算说」。**

手记「我动了什么」，嘴记「我说出去了什么」。两边同构：一套工具、一个触发器、同一条判据——**盘上多了一行，才准说出口。**

## 功能预期（怎么算成了）

1. **真送**：`mouth_say` 走一条通道（默认 `file` 发件箱），拿到通道自己的回执（字节数 / 退出码 / HTTP 码）；送完先写嘴账，再回话。
2. **真说**：送出去还没说出口的那几句，下一步在实时环境里注一行（`实时环境:mouth`，order 42）；注之前先把「说过了」写进盘。
3. **只报话与回执**：嘴账一行一条（`✓ → 师父：「在」（file:file）` / `✗(401) → …`），不记「我打算说什么」。
4. **失败原样交**：不重试、不吞错；退出码是什么就报什么。

**不做**：不替人改写信的内容；不猜通道；不把「准备说」写成「说过」。话得有人给，我只负责真送和记账。

## 和手对照

| | 手 `dsh-persona-hand` | 嘴 `dsh-persona-mouth` |
| --- | --- | --- |
| 一句话 | 说「做了什么」，不是「打算做什么」 | 说「说出去什么」，不是「打算说」 |
| 真做 | `hand_run({command})` 起进程 | `mouth_say({to, text, channel})` 走通道 |
| 账 | `.persona-framework/手账.jsonl` | `.persona-framework/嘴账.jsonl` |
| 一行长这样 | `✓ Write-Output hi → hi` | `✓ → 师父：「在」（file:file）` |
| 看账 | `hand_receipt` | `mouth_receipt` |
| 欠着的 | `hand_pending` | `mouth_pending` |
| 注入段 | `实时环境:hand`（order 41） | `实时环境:mouth`（order 42） |
| 判据 | 盘上多一行手账 | 盘上多一行嘴账 |

## 四个工具

| 工具 | 管什么 |
| --- | --- |
| `mouth_say` | 真送一句话；`to` 与通道回执一起进嘴账 |
| `mouth_receipt` | 看嘴账最近几条（默认 10，最多 200） |
| `mouth_pending` | 有没有送完还没说出口的 |
| `mouth_channel` | 有哪几条通道、各自通不通 |

## 通道

| kind | 怎么算送到 | 配置 |
| --- | --- | --- |
| `file` | 追加写进发件箱成功，回报字节数 | `{ kind: 'file', path: '.persona-framework/嘴/发件箱.md' }` |
| `command` | 退出码 0；`{to}` `{text}` 会被替换（单引号转义） | `{ kind: 'command', command: "..." }` |
| `http` | 2xx | `{ kind: 'http', url: 'http://...' }` |

默认只有 `file`。要加别的在 `cordis.patch.yml` 的 `channels` 里写；**没配的通道不会凭空出现**，`mouth_say` 会直接把有的通道列出来。

## 落盘

| 文件 | 内容 |
| --- | --- |
| `<ws>/.persona-framework/嘴账.jsonl` | 一行一条：`at / to / text / channel / ok / code / detail / ms` |
| `<ws>/.persona-framework/嘴账状态.json` | `pending`（没说出口的那几句）、`spokenAt`、`last` |
| `<ws>/.persona-framework/嘴/发件箱.md` | 默认通道；一条一段，带时间和收件人 |

## 触发器

`agent/pre-step`（瀑布式，必 `return next()`）→ `check()`：

1. 读 `嘴账状态.json` 的 `pending`；空就什么都不注。
2. 有就组一行 `嘴：这一步之前真送出去 N 句……`，**先把 `pending` 清空、`spokenAt` 写盘**，再让这一行出现在 `实时环境:mouth`。

所以同一句不会注第二次；下一轮只剩空段。**注一次 = 说过一次**，不是提醒。

## 自检

```
node selfcheck.mjs
```

不装 DSH 也能跑：凭据格式、账读写、pending 往返、通道解析、`file` 真写、`command` 真跑（PowerShell）、失败路径。
