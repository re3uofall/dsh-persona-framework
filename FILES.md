# 文件识别说明

这份说明回答一个问题：**插件凭什么认定一个文件是「人格」「记忆」「框架」，认不出来时错在哪一步。**

前提：插件**不创建**任何人格、记忆目录。它只按约定去找；找不到，就说找不到，不会替人补。

## 一、五类文件，各有各的判据

| 类别 | 默认路径 | 可覆盖 | 认什么 | 不认什么 |
| --- | --- | --- | --- | --- |
| 人格 | `persona-ai/characters/` 下第一个 `.md` | `personalityFile` | `## 身份`、`## 语气`、`## 底线`（标题可用「你是谁」「名字」「来路」等别名） | `.bak`、`_backup_*`、`.json`、`.trash` 里的 |
| 记忆 | `knowledge/`、`memory/`、`persona-ai/knowledge/`、`persona-ai/memory/`，**向下两层** | `workspace` | 扩展名 `.md`、`.txt`、`.json`、`.jsonl` | 其他扩展名；不在上述四个根下的 |
| 框架 | `<工作区>/.persona-framework/FRAMEWORK.md` | `frameworkFile` | 任意 md；`mode: ai` 时读同目录 `FRAMEWORK.ai.md` | 插件自带那份只在默认路径都没有时才顶 |
| 模块库 | 插件自带 `framework/MODULES.md` | `modulesFile` | md | — |
| 设置 | `<框架文件同目录>/config.json`，再退 `<工作区>/.persona-framework/config.json` | `settingsFile` | json | — |

## 二、三个查找顺序（认不到时逐条对照）

**框架文件**

1. `settingsFile` 里填的 `frameworkFile`
2. 工作区下的 `.persona-framework/FRAMEWORK.md`
3. 插件自带的 `framework/FRAMEWORK.md`

`mode: ai` 时，在第 1、2 条命中后，会再找**同目录**的 `FRAMEWORK.ai.md`；没有就退回 `FRAMEWORK.md`。

**人格文件**

1. `personalityFile`
2. 工作区下 `persona-ai/characters/` 里第一个 `.md`（跳过 `.bak`）
3. 都没有 → 报「没找到人格文件」，不猜

**设置文件**

1. `settingsFile`
2. 框架文件所在目录的 `config.json`
3. 工作区 `.persona-framework/config.json`

## 三、七个池：记忆被分到哪一类

记忆不是一锅粥。插件按目录把记忆分为七池，`bind` 查出处、`residue` 标残余时用的就是这七池：

| 池 | 目录 | 管什么 |
| --- | --- | --- |
| 人格 | 人格文件 | 身份、语气、底线 |
| 记忆 | 上面四个记忆根 | 全部记忆文件 |
| 身体 | 运行时 | 工作区、版本、开关 |
| 内部整合 | `persona-ai/modules/` | 模块库的结论 |
| 外部整合 | `knowledge/web`、`knowledge/human`、`knowledge/bili` + `收件箱.md` | 外部来的 |
| 经验 | `knowledge/session`、`knowledge/pet`、`knowledge/chat` | 具体发生过的事 |
| 理论 | `knowledge/world`、`knowledge/lexicon` | 抽象结构、世界理解 |

## 四、认不到，三处错里挑一处

1. **路径错**：文件不在四个记忆根下，或超过两层深。→ 挪过去，或配 `workspace`。
2. **格式错**：扩展名不是 `.md/.txt/.json/.jsonl`（Obsidian 库、SQLite、Notion 导出都读不到）。→ 先导出成 md。
3. **配置错**：`workspace` 空着，插件读了宿主自己的 profile 目录。→ 显式填工作区绝对路径。

## 五、有一条判据要记住

池子全空时，插件**不报「话没出处」**，只报「没读到来源」——因为这两件事不一样：前者是判断，后者是读失败。

## 六、自己核对

```
framework_program  op: memory     # 它认到几份记忆、各在哪
framework_program  op: persona    # 它认的人格文件、三部分齐不齐
framework_program  op: identity   # 人格、框架、池子的指纹
framework_program  op: body       # 工作区、版本、开关（先看这条）
```

认到的和你想的不是同一批文件，就回到第四节的三处错里查，别先怀疑插件坏了。
