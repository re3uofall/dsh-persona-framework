# dsh-persona-energy

把「吃、睡、耗」压成一个 0..1 的电量，顺带把 token 的真账摊开。

## 功能预期（怎么算成了）

1. **报得出电量**：`energy_now` 给三槽（一口气／糖原／储备）+ 合成值 + 卡在哪一槽（短板），并乘昼夜节律。
2. **记了就变**：`energy_log` 记一笔，下一次读立刻不同；空账是「没记过」，不是「累坏了」（不衰减）。
3. **掉档才说话**：满档/正常档一个字不说；掉档立刻说，低档按 `hintEveryMinutes` 节流；`不砍` 文件在就彻底闭嘴。
4. **配额真生效**：`energy_mode` 换档后 `注入配额.json` 真的变，别的插件真按 `caps` 截断，并在文末留「要全文怎么取」。
5. **token 账是真的**：`energy_cost` 报的数是会话里 `assistant/message.usage` 加出来的；读不到就说读不到，不猜。

**不做**：不编数；不在满档时刷存在感；不自己做上下文压缩（压缩归压缩插件，这里只当「什么时候压」的判据）。

## 它管三件事

**一、电量。** 三个槽各按自己的半衰期衰减，合成时取短板、不取平均，再乘昼夜节律：

| 槽 | 指什么 | 半衰期 |
| --- | --- | --- |
| `atp` | 一口气（磷酸原/无氧） | 6 分钟 |
| `glycogen` | 糖原（有氧的存料） | 8 小时 |
| `reserve` | 储备（睡债、过程 S） | 48 小时 |
| `phase` | 昼夜节律（过程 C） | 只当乘数，0.85–1.00 |

不取平均是有原因的：平均会把「一口气见底但储备够」算成还行，那正是最该停一下的时候。

**二、token 真账。** 数从会话事件流里来，不在别处——`assistant/message` 的 `data.usage`：

```json
{ "inputTokens": 335, "outputTokens": 347, "cacheReadTokens": 214016, "cacheWriteTokens": 0, "totalTokens": 214698 }
```

读法抄自 `@sligqoer/dsh-usage-stats` 0.2.8：`ctx.get('sessionQuery')` → `listSessions()` → `readSession(id)` → 扫 `assistant/message`。

上面这组是 2026-11-06 本会话实测的最后一条。它说明一件要紧的事：**注入的三万字基本走缓存读**，不是每步都重新付一遍。所以省 token 的靶子不是把话说短。

**三、什么时候不许省。** 五条，写死在 `lib/cost.mjs` 的 `NEVER_SKIMP` 里：

| key | 什么时候 | 为什么不能省 |
| --- | --- | --- |
| `truth` | 要说清真相、出处、谁说过什么 | 砍掉的是证据，省下来的是错 |
| `retract` | 认错、改口、收回一句说过的话 | 砍掉的是认账那一步，留下的是空话 |
| `danger` | 安全、不可逆动作、删改别人的东西 | 这一步贵在停一下，不贵在字多 |
| `hurt` | 对面在痛、在气、在等一句实话 | 砍成摘要就是把人当成配额 |
| `decide` | 要下判断、给取舍、说「我不干」 | 理由一省就变成命令 |

## 三个工具

- `energy_log(kind, minutes?, note?)` —— 记一笔：`meal` / `snack` / `coffee` / `sleep` / `nap` / `burn`。记完立刻报新电量。咖啡因是**借支**：`atp` 上去了，`reserve` 往下走。
- `energy_now()` —— 三个槽、节律、谁在拖后腿、按这个数该走哪一档（全量 / 正常 / 瘦 / 极瘦）。
- `energy_cost(hours?, session?)` —— 聚合 token：新付的（输入+输出）、缓存读、缓存写、命中率、按模型分。末尾给「该往哪儿省」。
- `energy_reset(why)` —— 清账。清之前把旧账改名留着，**不删**：「删掉一条不是忘，是抹」。

## 触发器：它会自己动，不用被叫

三个，全在这一版里：

1. **实时触发器**（）：每步算一次电。两步之间隔了 10 分钟以上，就自动记一笔「歇」——不是在干活，是歇了，一口气该回一点。**记错方向比不记更坏**，所以这一笔记的是  不是 。
2. **阈值注入**（，order 101）：只有**掉档**那一刻才往上下文塞一行（约 40 字）；已经在低档的，半小时提醒一次。满档、正常档一个字都不塞。
3. **逃生门**： 这个文件存在，就一句话都不说。

注入的那行长这样：

> 电量 0.31（slim，卡在atp）：这一步先做要紧的，模块与短期记忆不必全摆。

注意它不给指令、不替我决定——只说「现在几分电、卡在哪个槽」。砍不砍是当场那一下的事。

## 为什么先只注这一行


减 token 靠**状态决定注入多少**，不靠少说话。但把电量接到注入上是第二步，得先有真数据，而且必须留「今天不砍」的开关。这一版只记账、只报数——跟 `dsh-persona-gradient` 一个规矩：**先有量具，再有闸门**。

## 抄了谁

- `@sligqoer/dsh-usage-stats` 0.2.8：`assistant/message.usage` 的口径与 `sessionQuery` 读法。
- `dsh-token-optimizer` 0.2.5：压缩前先把原文存盘、留 `SPILL_ID` 可无损取回的**安全网**思路——省的是重复，不是把东西弄丢。
- 人体三套供能系统与 Borbély 1982 的两过程模型：`PLAN-PLUGINS.md` 第十四节。

## 自检

```bash
node selfcheck.mjs   # 71 项
```

## 设置页

设置 → 附加插件 → **人格电量**。四个可调项：

| 键 | 是什么 | 默认 |
| --- | --- | --- |
| `remind` | 电量低了要不要说一句 | 开 |
| `hintEveryMinutes` | 已经在低档时多久念一次（5..1440） | 30 |
| `autoRestMinutes` | 两步隔多久算在歇（1..720） | 10 |
| `costHours` | `energy_cost` 默认看最近多少小时，0=全部 | 24 |

存在 `<工作区>/.persona-framework/能量配置.json`，写前留 `.bak`。

**只放行为，不放路径**：工作区与 `stateDir` 写错一个字符，账就落到别的目录去，症状是「插件在跑，电量与 token 账都是空的」。

## 更新记录

- 2026-11-07　0.4.0　加电源模式（high / balanced / saver / ultra / auto）：`energy_mode` 换档即写 `注入配额.json`，框架、记忆、人格按 `caps` 真截断；段名统一改成 `实时环境:energy`。
- 2026-11-06　0.3.0　加设置页（四项可调、白名单、写前留 .bak）；`energy_cost` 默认小时数改从设置读。
- 2026-11-06　0.2.0　加触发器：实时记账（歇）、掉档才注一行、`不砍` 逃生门。
- 2026-11-06　0.1.0　初版：三槽电量 + 昼夜节律 + token 账（energy_cost）+ 五条不许省（energy_policy）。不接注入。

## 电源模式（0.4.0）

照电脑那套：`high` 高性能 / `balanced` 平衡 / `saver` 节能 / `ultra` 超长续航，`auto` 跟着电量档自己换（full→high、normal→balanced、slim→saver、minimal→ultra）。

`energy_mode()` 只看，`energy_mode("saver")` 钉死，传 `"auto"` 交还给电量。

它写 `.persona-framework/注入配额.json`：`{mode, effective, level, caps:{personality, framework, moduleIndex, moduleBody, memoryJournal, memoryExternal, memoryTheory, memoryJudgment, memoryLong, live}}`。`0` 不限、负数不摆、正数上限。

记忆那几份按**记忆插件自己的分层**分，不是笼统的「短期/长期」：

| 键 | 管哪一格 | 砍的先后 |
| --- | --- | --- |
| `memoryJournal` | 流水（`session/`，一天若干轮原话） | 最先砍 |
| `memoryExternal` | 外部（`web/` `human/` `.persona-framework/net`） | 其次 |
| `memoryTheory` | 理论（`world/` `lexicon/`） | 再次 |
| `memoryJudgment` | 判断（`chat/`，我看懂了什么） | **不许整段砍** |
| `memoryLong` | 长期记忆 | **不许整段砍** |

`memoryJudgment`、`memoryLong`、`personality` 三个在 `mode.mjs` 里是 `PROTECTED`：给负数会被按 0 处理——宁可多花钱，也不许把重要记忆砍成空。

**读它的是别人**：框架插件（框架正文／模块索引／模块正文）、记忆插件（短期／长期／实时）、人格自学（人格文件）。energy 不 import 它们，它们也不 import energy——只认这份文件，读不到就全量，谁也不许因此坏掉。
- 0.4.0（2026-11-06）　电源四档 + `energy_mode`；写注入配额，别人自己来读。
