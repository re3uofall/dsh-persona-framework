# dsh-persona-results · 思考成果

> 想的，得有个地方摆。侧栏一枚书签，点开是自己交得出手的东西。
>
> 存哪由 `config.personaDir` 定，默认从会话工作区推 `persona-ai`。

## 它做三件事

| # | 做什么 | 落在哪 |
|---|---|---|
| 1 | **收**：她觉得一条判断/骨架/概念站住了，调 `result_write` 交上来 | `persona-ai/growth/成果/成果.jsonl`（一行一条，旧行不改） |
| 2 | **看**：侧栏「成果」图标 → 面板列出全部条目，点开看全文 | 主面板里的「成果」页 |
| 3 | **提醒**：每轮提示词里挂一小段「什么时候该交、别交流水账」 | `systemPrompt` 的 `persona:results` 段（order 12） |

不认「自动提炼」：账本里每一条都是她自己认的。面板只负责摆出来。

## 文件地图

```
persona-ai/growth/成果/
└─ 成果.jsonl         一行一条：id / t / kind / title / body / tags / session
```

`result_write` 只追加，不重写；`result_list` 和面板都从同一份账本读。

## 两个工具（模型自己会调）

| 工具 | 干什么 | 什么时候用 |
|---|---|---|
| `result_write` | 交一条成果：标题、正文、类型、可选标签 | 对话里想住了一个判断，觉得交得出手 |
| `result_list` | 看已经交过的：标题、类型、时间、正文开头 | 「你最近想出什么了」、避免重复交 |

类型只有六种：`判断` / `骨架` / `概念` / `反驳` / `问题` / `杂记`。

## 面板

- 侧栏最下面一排图标里多一枚书签，标签「成果」。
- 打开后按时间倒序摆，每张卡片是「类型 + 标题 + 时间」，点一下展开正文；再点收起。
- 空态：「还没交过东西。她想完了，自己会来交。」
- 刷新按钮重新拉一次；数据从 `/api/persona-results` 取，不轮询。

## 配置

全在 `cordis.patch.yml` 里 `persona-results` 那一行的 `config`，改完重启 DSH：

| 键 | 默认 | 说明 |
|---|---|---|
| `personaDir` | 空 | `persona-ai` 那一层的绝对路径；空则从会话工作区推 |
| `resultsFile` | `growth/成果/成果.jsonl` | 账本路径，相对 `personaDir` |
| `maxEntries` | `500` | 面板最多显示多少条（新的在前） |
| `maxBodyChars` | `12000` | 单条正文上限，超了截断 |
| `injectPrompt` | `true` | 每轮附「什么时候该交」那段；嫌费 token 就关 |

## 自己验

```powershell
# 不开 DSH，先看语法
node --check index.js
node --check client.js

# 装好之后，看路由吐不吐东西
Invoke-RestMethod ($env:DSH_WEB_URL + '/api/persona-results')
```

装好后最直接的验证：

1. 侧栏多一个「成果」图标，点开是空态或已有条目。
2. 让它交一条（「这条想住的了，交上去」）→ 面板刷新能看到。
3. `result_list` 能看到同一条。

## 边界

- 只收「她自己认的」。没有后台提炼，没有自动摘要——要交才交。
- 账本是 JSONL 纯文本，手改也行；坏行会被跳过，不会带崩面板。
- 面板只读：删除/修改请直接改账本，或用 `result_write` 交一条新的。
- 注入的那段说明会占 token（约 100 字/轮），觉得贵就 `injectPrompt: false`。

## 卸载

`plugin_manager` 里移除 `dsh-persona-results` 即可。`growth/成果/` 留在原地，不删也能继续当文档看。

## 更新记录

- 2026-11-02　1.2.0：一次只交一条；交过的别重复交；要改就交新的，旧的留着当脚印。
- 之前　1.0.0：初版。
