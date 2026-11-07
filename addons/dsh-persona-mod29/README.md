# 模块 · 插件（`dsh-persona-mod29`）

模块 29 讲的四样——接口、权限、生命周期、失败隔离——落到真能跑的动作上：
**装上、卸下、启用、停用、回读。** 每一步都留得下退路。

## 为什么它是「功能实现」

| 判据 | 这一件 |
| --- | --- |
| 改状态 | 改 profile 的 `package.json`（依赖与 `dsh.profile.bundles`），跑 `pnpm add` / `pnpm remove` |
| 不给人格字 | 不注册 `systemPrompt.section`，一个字都不摆进上下文 |
| 下一轮真的变了 | 写完立刻回读 `package.json`，回话里带「回读：在／不在」 |

## 工具

| 工具 | 干什么 | 回什么 |
| --- | --- | --- |
| `mod29_list` | 列出依赖与启用状态 | 每行 `●/○ 包名 版本` |
| `mod29_install` | `pnpm add` 一个包 | 装完回读依赖；已装会 skip |
| `mod29_enable` | 写进 `bundles` | 回读是否在 bundles 里 |
| `mod29_disable` | 从 `bundles` 去掉 | 回读是否已不在 |
| `mod29_remove` | `pnpm remove` | 回读依赖是否已不在 |
| `mod29_verify` | 只读：依赖在不在、启用没有 | 一行状态 |

## 抄的是形状，不是代码

市场里两件同类：`dsh-plugin-session-view`（看并启停当前 profile 的插件）、`dsh-dpk-manager`（装前校验、装后回读）。
借的两条判据：**每一步都要能回读真实状态；失败只坏自己。**

## 边界

- 只碰 `profile/package.json` 与 pnpm 依赖，不改别的包的文件。
- 装失败会回退出码与最后三行输出，不吞。
- 改完 profile 要重启 DSH 才生效——这一步不在本插件里。

## 更新记录

- 0.1.0 —— 第一版：六个工具，装/卸/启停/回读，账落 `.persona-framework/模29账.jsonl`。
