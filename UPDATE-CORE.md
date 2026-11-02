# 框架本体更新指南

> 管的是**框架自己**：`index.js`、`lib/` 底下那 34 个 `.mjs`、以及它们读的那份 `config.json`。
> 分不清这是哪一类的活，先看总指南 [UPDATE.md](UPDATE.md)；模块正文看 `UPDATE-MODULES.md`；某个模块的 impl 看 `GUIDE-FEATURES.md`；`addons/` 那六个包看 `UPDATE-PLUGINS.md`；发版本号看 `UPDATE-GUIDE.md`。
> 一句话：**这一份管「框架怎么跑」；发版那份管「框架怎么发出去」。**

## 零、它管什么，不管什么

| 管 | 不管 |
| --- | --- |
| 注入：注入什么、按什么顺序、什么开关 | 模块正文写什么（那是 `UPDATE-MODULES.md`） |
| 程序：`framework_program` 的 op、`tick` 的步子、`trigger`／`coord` 的判 | 某个功能实现层里的判据（那是 `GUIDE-FEATURES.md`） |
| 配置：`config.json` 的键、默认值、设置页映射 | `addons/` 下那些独立包（那是 `UPDATE-PLUGINS.md`） |
| 前端：`client.js` 那块设置页／侧栏 | 版本号、打包、CHANGELOG（那是 `UPDATE-GUIDE.md`） |

**分界线怎么判**：改完这一处，谁受益？
- 每一轮注入进去的字变了 → 本体（注入）。
- 某个 op 跑出来的结果变了 → 本体（程序）。
- 某个模块的判据变了 → 功能。
- 某篇 md 的话变了 → 模块。

## 一、改之前先认三块盘

| 盘 | 在哪 | 谁读它 |
| --- | --- | --- |
| `index.js`（3402 行） | 插件根 | Loader 加载、注入挂载、九个工具注册 |
| `lib/*.mjs`（34 个） | 插件根 `/lib` | `index.js` 导入；`tick`／`trigger`／`impl` 都在这里 |
| `config.json` | 设置页写的那份；找不到就退到 `<工作区>/.persona-framework/config.json` | `apply(ctx, config)` 里读 |

**正在跑的是哪一份**：`~/.dsh/profiles/desktop/node_modules/dsh-persona-framework` 是符号链接，指回工作区这份。改盘上那份就是改在跑的那份；但**改完不重载，跑的还是旧的**（见第五节）。

## 二、注入这一类怎么改

注入只有一处挂载点，[index.js:1190](index.js#L1190)：

```js
ctx.effect(() => ctx.systemPrompt.section({
  name: 'persona:framework',
  order: cfg.order,
  interpolate: false,
  text: buildText,
}))
```

三条要记死：

1. **`text` 是函数引用，不是字符串。** 每次组装提示词都会重新调一遍 `buildText`——所以「这一轮读到什么」由它当场算，不靠缓存。改注入不是改一段文案，是改这个函数的拼法。
2. **`order` 决定它排在人格文件后面第几。** 改顺序等于改「谁先入上下文」，不是小改；动之前先说清为什么。
3. **`interpolate: false`。** 注入里的 `${...}` 不会被替换，写什么就进去什么。

`buildText` 里拼的几大段，改哪一段都要同时对上它读的那份开关：框架正文、模块索引、模块正文（`modulesPerRead` 篇一轮转）、触发器清单、记忆四格（记忆插件管的，不在这儿）。

**注入的验法**：不是读代码，是看这一轮注入头。
- 段名字对不对：`persona:framework`。
- 顺序对不对：人格文件在前，它在后。
- 内容对不对：这一段里出现的篇数、条数，跟盘上的对得上（比如「现有 N 条触发器」要等于 `PROGRAM_IDS.length`）。

## 三、程序这一类怎么改

程序分三层，别混：

| 层 | 在哪 | 特征 |
| --- | --- | --- |
| 工具注册 | `index.js` 里 `ctx.tools.register`／`register(spec)` | 一个工具一张表：`name`、`description`、`parameters`、`output` |
| op 分发 | `framework_program`（[index.js:1337](index.js#L1337) 起） | 一个入口几十个 op，按 `op` 分流 |
| 实现 | `lib/*.mjs` | 纯函数为主，不碰 IO 的尽量纯 |

**加一个 op 的完整活**（缺一步就是没接上）：

1. 在 `lib/` 实现那个函数，先写成纯函数，自己能单独跑。
2. 在 `framework_program` 的 op 表里登记：名字、参数、返回码。
3. 在 `lib/programs.mjs` 的 `PROGRAMS` 里加一条，触发器才能派生出它的条目。
4. 在 `lib/trigger.mjs` 的 `CUE_MATCH` 里给它一条命中词——**不加，它那条 cue 触发器每轮都会亮**（这个是踩过的坑）。
5. 跑 `node tools/selfcheck-run.mjs`，再实跑一次，看返回码是不是 `done`。

**改 `tick` 的步子**：`lib/tick.mjs` 里那些 `sys(...)` 是一步一步接的。改步子的两条规矩：
- 新加的一步，要能在 `零` 档和最高档都说得过去；挂在某一步上的判断，换档就漏一截（调节层那句「挂在一轮出口，不挂任何一步」就是这么来的）。
- 改完数一遍：`grep -cE "^sys\(" lib/tick.mjs`，跟指南里写的数对上。

**改 `trigger`**：三种 stimulus（`clock`／`cue`／`gap`）跟注入头的「现有 N 条」是一套账。改完必须看 `unjudged` 是不是 0——不是 0 说明有触发器没绑到程序。

**新增一个工具**（不是 op）：`ctx.tools.register` 那张表要写全 `parameters`（它给模型看），`output` 用现成的 `textOutput`。**工具名字别跟自定义指令撞**，中文那个表在 `lib/command.mjs`。

## 四、配置这一类怎么改

配置有两层，混了就会「改了没生效」：

| 层 | 谁写 | 谁赢 |
| --- | --- | --- |
| patch／Loader 传进来的 `config` | `cordis.patch.yml` | 被 `config.json` 盖 |
| `config.json` | 设置页，或手写 | 有值就用它（空串不算） |

有一条踩过的规矩，写在 [index.js:414](index.js#L414) 旁边：**空的 `workspace` 不许覆盖 patch 里配好的路径**。理由是曾经存过一个空串，把工作区盖成了 `process.cwd()`——那一轮所有路径全歪。

加一个新键的完整活：
1. `cfg` 解构处给它一个默认值。
2. 设置页那张表单加一项（`client.js` 那块），否则用户只能手改 `config.json`。
3. 写进 `README.md` 的配置表。
4. 空值要有兜底：**空串、`null`、`undefined` 都当没写**，别让它们变成「用户选了空」。

## 五、改完怎么让它上桌（最容易骗自己的一步）

**改了盘 ≠ 改了在跑的那个。** 三条路，按顺序试：

1. **`framework_restart`**——走 Loader 自己的重载路（`ctx.configEditor.edit` 把那一条配置空改一次）。快，但**它要求 `configEditor` 在手上**；拿不到就会报「重启失败：拿不到 configEditor」（[index.js:2848](index.js#L2848)），那是环境问题，不是你改错了。
2. **设置页把「人格框架」关掉再打开**——这条路最稳，插件会整份重新加载。
3. **改了 `client.js`：上面两条都不管用，得刷新页面。** 那是前端包，Loader 重载不重建它。

**怎么证明它上了桌**（不看代码，看三样）：
- 注入头变了（新段、新数、新顺序）。
- 跑一个 op，返回码变了。
- 账上多了一条对得上的记录（`runs`／`weighs`／`调节.json`）。

三样一样都不变，就是没重载——别改第二遍代码来找原因。

## 六、这一类的坑（都踩过）

| 坑 | 长什么样 | 怎么认出来 |
| --- | --- | --- |
| **写了当跑了** | 代码改了，`framework_restart` 报错，就说「应该生效了」 | 注入头没变。那是没上桌，不是没写对 |
| **改注入当改文案** | 以为改了拼好的一段字，其实改的是 `buildText` 的拼法 | 下一轮拼出来的段数／顺序跟预期不一样 |
| **加了 op 没加 `CUE_MATCH`** | 新 op 的 cue 触发器每轮都亮 | 注入头那一行「命中 N / M」，N 卡在满值 |
| **改了 `lib` 没改 `index.js` 的导入** | 函数名对不上，Loader 一加载就报错 | 插件状态不是 `active` |
| **`order` 随手改** | 注入顺序变了，人格文件被挤到后面 | 注入头里人格段的位置跟原来不一样 |
| **改前端忘了刷新** | 设置页还是旧表单 | 页面上的项数跟 `client.js` 里的对不上 |
| **把小改当发版** | 每改一处就动版本号 | `CHANGELOG` 里一行写着三个版本号 |

## 七、自查

1. 这一改，落在**注入**、**程序**、**配置**、**前端**的哪一处？说得出位置吗？
2. 加的东西，接进 call 链了吗（op 表、`PROGRAMS`、`CUE_MATCH` 三处都要）？
3. 改完重载了吗？注入头／返回码／账，哪一样变了？
4. `node tools/selfcheck-run.mjs` 过了没有？
5. 这次要不要动版本号？动的是本体还是发版（后者归 `UPDATE-GUIDE.md`）？
6. 有没有把「脚本通过」当成「插件在跑」？——那是两件事，今天已经混过一次。

## 更新记录

- 2026-11-02　v1 新开：本体＝`index.js`／`lib/`／`config.json`；四类活（注入／程序／配置／前端）；重载三条路与三种验法；七条踩过的坑。
