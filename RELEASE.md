# 公开发布

依据官方文档：[插件市场](https://deepseek-harness.github.io/deepseek-harness/guide/plugin-market)、[索引格式说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/feature/2026-10-02-plugin-market-index-format.zh.md)。

一个包的发布分两件事：**代码放哪**、**索引放哪**。DSH 只认索引，不认「官方上架」——任何静态主机上的 JSON 都能被用户加为市场来源。

## 一、先改 package.json

现在这份是私用的（`"private": true`），发布前要动几处（下面示例版本号以 `package.json` 为准）：

```json
{
  "name": "dsh-persona-framework",
  "version": "4.20.0",
  "private": false,
  "license": "MIT",
  "author": "你的名字",
  "repository": { "type": "git", "url": "https://github.com/你/dsh-persona-framework" },
  "homepage": "https://github.com/你/dsh-persona-framework#readme",
  "keywords": ["dsh", "dsh-plugin", "persona", "framework"],
  "engines": { "dsh": ">=0.2.0-rc.2" }
}
```

- `name` 必须在 npm 上唯一（`dsh-persona-framework` 已核实：npm registry 查不到（404），可以用）。
- `engines.dsh` 要与索引里写的版本范围一致。
- 包内 `files` 已经列好了：`index.js`、`client.js`、`lib`、`framework`、`locale`、`icon.svg`、`cordis.patch.yml`、`README.md`。

## 二、代码放哪（二选一）

### A. Git 仓库（不用 npm，最快）

```bash
git init
git add .
git commit -m "dsh-persona-framework 4.20.0"
git remote add origin https://github.com/你/dsh-persona-framework.git
git push -u origin main
git rev-parse HEAD   # 记下 40 位 commit
```

索引里用：

```json
"source": {
  "type": "git",
  "url": "https://github.com/你/dsh-persona-framework",
  "commit": "40位sha"
}
```

包在 monorepo 子目录时才需要 `path`。

### B. npm（可被市场按版本安装）

```bash
npm login
npm publish --access public
```

索引里用：

```json
"source": { "type": "npm" }
```

## 三、写索引 index.json

最小可用版（单插件、单版本）：

```json
{
  "format": 1,
  "title": { "en": "Persona Framework", "zh": "人格框架" },
  "plugins": [
    {
      "name": "dsh-persona-framework",
      "title": { "zh": "人格框架", "en": "Persona Framework" },
      "description": "给 AI 用的人格框架：分层切分、原话验证、出口判据；不定义你是谁，只规定怎么构成、怎么长、怎么说清楚。",
      "icon": "icons/dsh-persona-framework.svg",
      "author": "你的名字",
      "homepage": "https://github.com/你/dsh-persona-framework#readme",
      "repository": { "url": "https://github.com/你/dsh-persona-framework" },
      "versions": [
        {
          "version": "4.20.0",
          "publishTimestamp": 1793000000,
          "source": { "type": "git", "url": "https://github.com/你/dsh-persona-framework", "commit": "40位sha" },
          "engines": { "dsh": ">=0.2.0-rc.2" }
        }
      ]
    }
  ]
}
```

要点（违反任何一条，DSH 会整份拒收）：

- `format` 必须是 `1`；`title` 为本地化文本对象，必须含 `en`。
- 每个版本必须有 `version`、`publishTimestamp`（Unix 秒）、`source`。
- `source` 二选一：`{"type":"npm"}` 或 `{"type":"git","url":"https","commit":"40位hex","path"?}`。
- 图标：内联 `data:` URL（≤32 KiB）或 URL；相对路径相对索引 URL 解析。
- 索引 UTF-8、≤128 MiB、2xx 返回、不重定向。

不想手写，可以用官方生成器（在 DSH 源码仓库里）：

```bash
pnpm --filter @deepseek-ai/dsh-plugin-market-generator start \
  --input plugins.txt --output site/index.json --title "人格框架"
```

`plugins.txt` 每行一个 npm 包名或 https Git 仓库 URL。

## 四、托管

索引和 `icons/` 放同一个目录，发布到任意静态主机：

- GitHub Pages（`https://你.github.io/dsh-persona-framework/index.json`）
- GitLab Pages
- 对象存储（S3/OSS 等，需 https）

## 五、用户怎么装

DSH 里：**插件 → 更多（实验性插件旁）→ 打开「自定义插件市场」→ 发现 → 添加索引源 → 填你的 index.json URL**。

之后卡片上点「安装」，会显示来源（仓库 + commit，或 npm 包名）并做兼容性检查。

## 六、注意

- 市场是第三方内容：DSH 只校验格式，不校验声明。发布方自己保证 `repository`、`author` 真实。
- 换版本时：发新版本 + 更新索引版本列表（`publishTimestamp` 用真实时间）。
- 预发布版（`1.5.0-beta.1`）会被标出来，不会顶掉稳定版推荐。
- 别把密钥、个人路径写进包里；`cordis.patch.yml` 里现在写的默认 `frameworkFile` 是空串，安全。
