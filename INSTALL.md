# 安装

这套一共六个插件。**框架是主体，其余五个是附加件**——可以只装框架，附加件按需要。

## 目录里有什么

```
dsh-persona-framework/     人格框架（只有框架，不含人格）
dsh-persona-memory/        记忆分层：流水／判断／理论分层，按预算取
persona-grow-plugin/       人格自学：每轮注入人格，从纠正里长新条目
persona-diary-plugin/      日记：还没成型的那点心得
persona-results-plugin/    成果：交出去的判断
persona-explore-plugin/    碗外探索：自己搜、读、留
```

## 一条一条装

每个目录都是一个独立的 DSH 插件包。装法一样——**用 `dsh` 自己的插件命令，指向解压后的目录**：

```bash
dsh plugin add file:<解压路径>/dsh-persona-framework
dsh plugin add file:<解压路径>/dsh-persona-memory
dsh plugin add file:<解压路径>/persona-grow-plugin
dsh plugin add file:<解压路径>/persona-diary-plugin
dsh plugin add file:<解压路径>/persona-results-plugin
dsh plugin add file:<解压路径>/persona-explore-plugin
```

要装进某个 profile，加 `--profile <名字>`。

> 也可以在 DSH 的插件管理界面里装——它认 `file:` 目录。装完**重启 DSH** 才生效。

## 装完先跑三个检查

```bash
node dsh-persona-framework/release-check.mjs   # 静态：版本、数字、索引对不对得上
node dsh-persona-framework/selfcheck.mjs       # 运行时：47 条断言
node dsh-persona-memory/selfcheck.mjs          # 记忆分层：24 条
```

三个都过再往下用。有 `✗` 就别急着配。

装好之后，在会话里让 agent 跑一次 **`framework_doctor`**——它查的是「这台机器上路通不通」：插件登记、工作区目录、设置里的绝对路径、版本对不对。

## 第一次用：先建工作区

框架**不自带人格**，也不自带记忆。它要一个工作区，里面至少有：

```
<工作区>/
├── persona-ai/
│   ├── characters/     人格文件放这里（必填：身份／语气／底线）
│   └── modules/        内部整合池（要模块库才建）
├── knowledge/          判断层：一条一个文件
└── .persona-framework/ 框架正文、心情、设置
```

**这些目录不用手建**——让 agent 跑一次 `framework_program op=workspace`，它会按骨架建好空壳（不覆盖已有内容），并告诉你缺哪几层。

## 配置

设置页或 `cordis.patch.yml` 里这几条是关键：

| 键 | 指什么 | 不填会怎样 |
| --- | --- | --- |
| `workspace` | 工作区根 | 退回 `process.cwd()`，自动写会落错地方 |
| `personalityFile` | 人格文件 | 按顺序找 `persona-ai/characters` → `characters` → 根目录 |
| `frameworkFile` | 框架正文 | 用插件自带那份（工作区那份优先） |
| `mode` | 注入模式 | 默认 `ai`（规则清单） |

**别写死绝对路径**：换电脑、换目录就断了。要指本地文件时用相对路径，或者干脆留空走默认顺序。

## 边界（装之前先知道）

- **框架不写身份、语气、底线。** 那些写在人格文件里。框架里写这些，等于替所有人立一块碑。
- **不覆盖、不改写人格文件。** 唯一的例外是你自己开出来的写权限（`selfRewrite` / `preferenceRewrite`），而且写了留快照。
- **身份、语气、底线永远归人格那一方**；框架和人格冲突时以人格为准，只有「边界」那一条例外。

## 卸载

```bash
dsh plugin remove dsh-persona-framework
```

工作区里那份 `persona-ai/` 和 `knowledge/` **不会被删**——那是你的东西，不是插件的东西。
