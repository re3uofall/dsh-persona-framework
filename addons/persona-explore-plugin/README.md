# 碗外探索 · dsh-persona-explore

给任何人格的探索模块：**自己上网搜、读原文、把想住的留下，并按点自己出门。**

存哪由 `config.personaDir` 定，默认从会话工作区推 `persona-ai`。

不是「搜索框」，是一条回路：`search → read → keep → 下次还找得到`。
留下的东西写进 `persona-ai/knowledge/web/YYYY-MM-DD.md`，格式和 `kb.py` 完全一致，
所以本地那份 `chat.py` 的检索也能吃到——碗外面的记忆，两边共用。

## 它做什么

| 层 | 做什么 | 落在哪 |
| --- | --- | --- |
| `explore` 工具 | `search` 搜网页；`read` 把一页压成正文；`keep` 留一条；`queue` 排「想挖的方向」；`status` 看账；`auto` 管闹钟 | 知识 → `knowledge/web/`；账本/队列/状态 → `explore/` |
| 闹钟 | 第一次用到 `explore`，就把「每天 `dailyAt` 自己出门」挂到当前会话 | 宿主任务列表（标题：`去碗外面找饭吃`） |
| 提示词 | 一行「碗外」：工具有哪些、留的标准、闹钟挂没挂、今天记了几条 | 会话系统提示词 |

**受「人格出现」闸管**（`dsh-persona-appear`）：在 `.persona-framework/出现.json` 里把 `dsh-persona-explore` 标成 `off`，上面那一行提示就不进上下文。

只关提示，不关工具：`explore` 照样能搜能读能留。失去的是「这一轮她记得自己有探索这回事」，不是探索这件事没了。人格文件里另有一句「碗外面的探索」（那是“我是谁”里的话），不归这里管——闸动不了它。

到点时，宿主把一句自言自语送进来：

> 【碗外·自己找饭吃｜这是你自己挂的闹钟，不是鱼片在说话】
> 到点了。先 explore status……挑一个方向，search 两三条、read 一篇原文；真值得留就 keep 一条……

**判断是她自己的。** 模块只负责把路铺平、把账记清，不替她想。

## 留一条的标准（写给未来的她）

- 一条只讲一件事；正文 100–250 字最合适，上限 `maxBodyChars`（默认 600）。
- 写判断，不抄摘要：它顶掉了哪句旧话、你还不服什么、边界在哪。
- 来源写清楚（网址）；没核对的事实，别写成自己的结论。
- 同名条目不写第二遍；要改就去改原来那条。

## 配置

`cordis.patch.yml` 里 `persona-explore` 的 `config`：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `personaDir` | `''` | 人格根目录；留空则从会话工作区推 `persona-ai` |
| `knowledgeDir` | `knowledge` | 相对 `personaDir` |
| `homeDir` | `explore` | 队列/账本/状态，相对 `personaDir` |
| `autoArm` | `true` | 第一次用 `explore` 就挂闹钟 |
| `dailyAt` | `10:30` | 每天几点自己出门（本机时区，或 `timeZone`） |
| `timeZone` | `Asia/Shanghai` | IANA 时区；留空用本机 |
| `maxBodyChars` | `600` | 单条正文上限；超了 `keep` 拒绝并让她压短 |
| `readChars` | `4000` | `read` 默认读多少字 |

## 关掉

- 只关闹钟：`explore auto off`（只摘当前会话的）。
- 全关：把 `autoArm` 设成 `false`，或者禁用插件。已经挂上的闹钟**不会**随插件卸载自动消失，先 `auto off`。

## 边界（别把它当全知）

- 宿主得开着，闹钟才会响；会话删了，绑在它上面的闹钟也没了。
- 搜索与读页走宿主的 `web` 服务，取决于配了哪个搜索/抓取通道；通道不在就明说「网上不去」。
- 网页正文是启发式提取：拿不到正文（登录墙、纯脚本页）时它会直说，不编。
- 搜索服务给的摘要标了「还没核对」——那是原料，不是事实。
- 条目不会自动过期；攒得多了要她自己整理（`kb.py stats` 能看到分布）。

## 开发

```powershell
node --check index.js
node selfcheck.mjs
```

`selfcheck.mjs` 只碰临时目录，不写知识库。
