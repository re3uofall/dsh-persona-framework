# dsh-persona-console · 人格框架台

**侧栏一页，把这一套拆成三部分摆出来**——和 DSH 原来的「插件」页分开。

左边那一列，和「日记」「成果」并排，多一个「人格框架」图标。点开是三块：

| 组 | 里面是什么 | 判据 |
| --- | --- | --- |
| **总模块插件** | 本体 `dsh-persona-framework`，加上 `persona-ai/modules/*.md` 的模块正文（现在 97 篇，按编号排） | 本体只有一个；正文不是插件，是本体每轮按配额挑进去读的东西 |
| **模块功能实现** | 程序模块 `programs/<id>/`（自读写、适配：各自一份 `module.md` 正文 + `impl.mjs` 实现），后接总模块自己的实现程序 `impl/*.mjs` | 这三样都是人格框架自身的实现；改了要重启 DSH 才生效 |
| **附加插件** | `dsh-persona-framework/addons/*`（现在 18 个） | 「已登记」= 在 `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 里；没登记就显示空心圈 |

## 为什么单独一页

原来要看这一套，得去「插件」页从四十多个包里翻：本体不在 bundles 里，模块正文根本不是插件，附加插件和别人的插件混在一张表里。这一页只回答一个问题——**这一套现在长到什么样**。

## 数据从哪来

host 半端只读这几个地方，不改任何东西：

- `<工作区>/dsh-persona-framework/package.json` → 本体版本
- `<工作区>/persona-ai/modules/*.md` → 模块正文清单（按编号排）
- `<工作区>/dsh-persona-framework/programs/<id>/program.json` → 程序模块（名字、顺序、正文与实现的位置）
- `<工作区>/dsh-persona-framework/impl/*.mjs` → 总模块自己的实现程序
- `<工作区>/dsh-persona-framework/addons/*/package.json` + `locale/zh.json` → 附加插件的名字、版本、中文标题
- `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` → 登记没登记

工作区从哪来：先认配置里的 `workspace`，再认这一步会话的 `cwd`（`agent/pre-step` 里拿），最后往上找**同时**有 `dsh-persona-framework/` 和 `persona-ai/` 的那一层。只看一样会认错——本体目录里也有一个占位的 `persona-ai/`。

接口：`GET /api/persona-console`，回 `{ ok, workspace, counts, groups }`。

## 用法

装好、登记进 bundles、重载之后，刷新页面就能看见侧栏那个图标。面板右上角「刷新」重新扫一遍盘——扫的是盘，不是缓存。

## 边界

- **只看不装**：它不加载、不卸载、不改 bundles。要开关插件还是去插件页。
- **不替代插件页**：DSH 自己的插件页管全部插件（含别人的）；这一页只管人格框架这一套的三层。
- **没有工具**：不进上下文、不注段、不花 token。它的形状是一个「看板」，不是「器官」。

## 更新记录

- 0.1.2 —— 按师父口径改成三部分：总模块插件（本体＋模块正文，97 篇正文归第一部分）、模块功能实现（程序模块 自读写／适配，后接总模块的 impl/*.mjs）、附加插件。程序模块归框架自己，不再算附加插件。
- 0.1.1 —— 面板自己吃滚轮：根容器 `height:100%` + `overflowY:auto`（原来套在无高度的容器里，页面滚不动），内层不再单独滚。
- 0.1.0 —— 第一版：侧栏一页，三组（本体 / 模块正文 / 附加插件），只读扫描 + 刷新。
