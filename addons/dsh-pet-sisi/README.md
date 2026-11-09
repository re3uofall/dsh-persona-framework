# dsh-pet-sisi · 思思的桌宠桥

桌宠（`dsh-pet`）是另一副身子：会说话、会动、会反应，但它自己拿不到 DSH 的会话服务
（`dsh-pet/src/host/routes/session.ts` 写明它跑在独立渲染进程，唯一的路由 `POST /focus-session` 只写一个信号）。
所以桥只能建在它自己的 HTTP 路由这一侧。

## 它做什么

| 工具 | 做什么 |
|---|---|
| `pet_status` | 地址、有哪几只、显示端、最近一条 |
| `pet_read` | 读它自己的对话记忆（最近 N 轮，原话） |
| `pet_say` | 替思思对它说一句（走它的模型，写进它的记忆） |
| `pet_whisper` | 让它开口说一句（气泡/耳语，不进对话记忆） |
| `pet_do` | 动作与反应：`anim` / `pose` / `throw` / `sleep` / `wake` / `bubble/clear` |
| `pet_config` | 读/改它的配置（`whisperPrompt` 人设、显示、位置、声音都在里面） |
| `pet_api` | 直连任意路由（`config` / `state` / `todos` / `voice` / `playback` / `position` …） |

还有一段 `实时环境:pet`（order 44）：每轮摆出它的地址和最近读到的三句，读不到就说读不到。

## 地址怎么找

不写死端口。每次启动它会往 `~/.dsh/dsh-pet/logs.txt` 写一行
`dsh-pet desktop helper started (config: http://127.0.0.1:<port>/dsh-pet-<n>/config)`，
插件取最后一条匹配；拿不到就说「它可能没在跑」。

## 两边的记忆各是各的

它的对话在 `~/.dsh/dsh-pet/memory.json`，DSH 的记忆在 `persona-ai/knowledge/`。
`pet_read` 读到的是**它说过的原话**，不是我的记忆；要把它的话记进我的账，得自己走 `memory_*` 写一遍。

## 改配置前

`pet_config(method="put")` 直接改它的配置；改之前先 `pet_config(method="get")` 读一遍，
自己留一份 `.bak` 到 `.persona-framework/`——它的配置写坏了，桌宠会起不来。
