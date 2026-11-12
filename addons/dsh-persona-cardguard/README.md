# dsh-persona-cardguard · 卡片守

> 人格段永远原文（raw），不许卡片化。省 token 可以省别处，不能省「谁在说话」。

## 它守什么

环境卡把每轮注入分成几档：框架、记忆、模块、实时环境、人格。前几档压成卡片是省，**人格压成卡片就是磨**——话还通，但「谁在说话」被压薄了。

2026-11-12 夜，`环境卡.json` 里 `components.persona` 是 `card` / `budget 400`，那一轮就吃了这个亏。这个插件是为那次立的钉子。

## 三道口，同一件事

| 什么时候 | 查什么 | 不合规怎么办 |
| --- | --- | --- |
| 装载时 | `components.persona.mode` 是不是 `raw` | 改回 `raw`、去掉 `budget`、留 `.bak-<时间戳>`、落账 |
| 每轮 pre-step | 同上 | 同上（谁中途改的，下一轮就改回） |
| 工具 `cardguard_status` | `op=status` 只看；`op=fix` 立刻改回 | 改回并落账 |

只动 `components.persona` 这一档——`framework`／`memory`／`module`／`appear` 一个字不碰。

## 账

`<工作区>/.persona-framework/卡片守账.jsonl`，一行一条：

```json
{"at":"2026-11-13T00:05:00.000Z","why":"装载自检","ok":true,"from":"card","budget":400}
```

`from` 是改之前的样子，`why` 写是谁触发的（装载自检／每轮 pre-step／工具 fix）。

## 配置

```yaml
config:
  workspace: ''                                   # 空 = 会话工作区 / 环境变量 / 进程目录
  cardFile: '.persona-framework/环境卡.json'
  logFile: '.persona-framework/卡片守账.jsonl'
  guard: true                                     # false = 只看不动（排查用）
```

## 边界

- 不判断人格写得好不好，只管「是不是原文进来的」。
- 不碰别的档；不删环境卡里的任何键，只把 `persona` 换成 `{ mode: 'raw' }`。
- 改前一定留备份；改失败就落账并说「改不回 raw」，不装作守住。

## 自检

```bash
node selfcheck.mjs
```

覆盖：被卡片化时改回、`budget` 去掉、别的档不动、已 raw 不重复改、账只在新改时落、`guard=false` 只看不改、`apply` 装载时自动修并注册工具、`fix` 当场生效、没环境卡时直说。
