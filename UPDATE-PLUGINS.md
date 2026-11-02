# 插件更新指南

> 管的是**附加插件**——`addons/` 底下那六个独立 npm 包，各自有 `package.json`、`index.js`、自检。
> 分不清这是哪一类的活，先看总指南 [UPDATE.md](UPDATE.md)。框架本体（注入／程序／配置）看 `UPDATE-CORE.md`；框架本体发版看 `UPDATE-GUIDE.md`；框架内部的功能（某个模块的 impl）看 `GUIDE-FEATURES.md`；模块正文看 `UPDATE-MODULES.md`。
> 五份管五样东西，别拿错。

## 一、先认清哪份是活的

同一个插件在盘上常有三份，长得一样，动错一份白干：

| 位置 | 是什么 | 动它有没有用 |
| --- | --- | --- |
| `C:\爱思考的大肥鱼思思\<插件目录>\` | **工作区那份，正在跑的就是它** | 有用，改这里 |
| `dsh-persona-framework\addons\<插件目录>\` | **发布副本**，跟着仓库推给别人的 | 有用，但要先同步 |
| `~/.dsh/profiles/desktop/node_modules/<包名>` | 指向工作区的**符号链接** | 别动，动了两边不一致 |

判据：`ls -l` 看那个路径是不是箭头（`->`）。是箭头就说明它只是门牌，真正的屋子在工作区。

**常见错法：改了 `addons/` 那份，以为在跑的那份也变了。** 不会——副本是独立文件，不是链接。所以顺序永远是：改工作区 → 跑通 → 同步到 `addons/`。

### 两处插件的不同，一句话说清

**工作区那份是活的，`addons/` 那份是给别人装的。** 改动只有一个方向：从工作区流向 `addons/`，从不反向。`addons/` 那份长得再全，也只是包裹，不是正在跑的那个。

判断「库里那份是不是新的」，**只认一条命令，不认印象**：

```bash
diff -rq "/c/爱思考的大肥鱼思思/<插件目录>" "/c/爱思考的大肥鱼思思/dsh-persona-framework/addons/<插件目录>"
```

空输出 = 一致；只要吐出任何一行 `differ`，就是「盘上改了、库里还是旧的」——**这时候不许提交、不许推**，先把工作区那份整个覆盖过去（第 39 行那条 `cp -r`），再 diff 一次到空。

**别拿「工作区那个目录没有 `.git`」当成「这个插件不在发布仓库里」。** 插件在不在仓库里，看的是 `dsh-persona-framework/addons/` 有没有它；工作区那份本来就不该有 `.git`——它是源码，不是仓库。这两件事分开看，就不会把「没 git 仓库」误读成「推不上去」。

## 二、改之前先看清楚它长什么样

一个附加插件至少这几处，改之前先读一遍，别凭印象：

- `package.json`：`name`（包名，可能与目录名不同）、`version`、`dsh` 段的挂载信息。
- `index.js`：默认配置（`DEFAULTS`）、工具定义（`ctx.tool(...)`）、注入段（`systemPrompt.section`）。
- `client.js`（有的话）：面板那一侧，改了要刷新页面，热重载不一定管用。
- `selfcheck.mjs`：自检脚本，**改完必须真跑**。
- `README.md`：给人看的用法，版本号、功能清单写在这。

包名和目录名不是一回事：`persona-diary-plugin/` 的包名是 `dsh-persona-diary`。符号链接认的是包名，别拿目录名去找。

## 三、更新七步

1. **在工作区那份上改。** 改完先在当前会话里试一次真调用，别只读代码。
2. **跑自检。** `node selfcheck.mjs`（或 `selfcheck-memory.mjs`），全绿再往下。自检里该有的项：纯函数、边界、错误路径。**只加功能不加自检，等于没验收。**
3. **改版本号。** 三处要对得上：工作区 `package.json`、`addons/` 那份 `package.json`、`README.md` 里写的版本。小改 `+0.0.1`，加功能 `+0.1.0`，改行为与不兼容 `+1.0.0`。
4. **更新 README。** 写清这一版多了什么、怎么用、有什么边界（比如「私密不是加密」这种要写明）。用户看的是它，不是代码。
5. **同步到 `addons/`。** 用 `cp -r`，本机没有 `rsync`：

   ```bash
   src="/c/爱思考的大肥鱼思思/persona-diary-plugin"
   dst="/c/爱思考的大肥鱼思思/dsh-persona-framework/addons/persona-diary-plugin"
   cp -r "$src/." "$dst/"
   diff -rq "$src" "$dst"    # 空输出才算同步干净
   ```

6. **提交。** 一次一个插件一件事，标题写清插件名和版本，别写「优化若干细节」。
7. **推。** 见下面第五节——**只推插件，不推记忆和日记。**

## 四、改完要真跑一次

代码提交了不算生效，插件得重新加载：

- `framework_restart`（走 Loader 的重载路，改了 `index.js` / `lib/*.mjs` 用它）。
- 改了 `client.js` 不行——那是前端包，得刷新页面。
- 改完看注入里有没有那一段（比如日记的 `persona:diary` order 13），再看面板上多没多出那一档。

**判据：盘上多了一条、面板上多了一个能点的地方。** 只有代码变了、看得见的地方没变，就是没生效。

## 五、推之前先证明「只推了插件」

**顺序不许倒：先让库里那份变新 → 再证明只推了插件 → 最后才推。** 库里那份没更新就推，推上去的是旧版；这不算「推错了文件」，而是推了一个坏版本——别人装下来就是坏的。

所以推之前跑三条，前一条必查，后两条必须空：

```bash
cd "/c/爱思考的大肥鱼思思/dsh-persona-framework"
diff -rq "/c/爱思考的大肥鱼思思/<插件目录>" "addons/<插件目录>"   # 必须空：库里那份是新的
git ls-files | grep -Ei "knowledge|日记|growth|session/"   # 仓库里混进了记忆/日记
git status --short                                          # 还有没提交的东西
```

只在 `dsh-persona-framework` 这个仓库里推（它是唯一有 remote 的）：

```bash
git push origin main
```

推不动先分三样，别反复重试：

- **连不上**（`Failed to connect` / `Connection was reset`，或 `curl https://github.com` 返回 `000`）：**代理没覆盖到 git**，跟凭证无关——别去清凭据、别换账号。先找本机代理端口：

  ```bash
  netstat -ano | grep LISTENING | grep -E ":(7890|7897|1080|10808)\b"
  ```

  查到端口后，**只给这一次**加代理，不动全局配置：

  ```bash
  git -c http.proxy=socks5h://127.0.0.1:1080 push origin main
  ```

  `curl --socks5-hostname 127.0.0.1:1080 -I https://github.com` 返回 200，就说明这条路通。要长期用再 `git config --global http.proxy socks5h://127.0.0.1:1080`。
- **要用户名**（`could not read Username`）：`git config --global credential.helper manager`。
- **认证失败**（`Invalid username or token`）：清掉旧凭据重来，别在弹窗里手输 token——那会把令牌留在记录里。

**远端比自己新**（`fetch first` 或 `rejected`）时，先 `git log --oneline HEAD..origin/main` 看远端那几个提交本地有没有等价内容。全有的话用 `git merge -s ours origin/main` 把历史连上，内容仍以本地为准——**不用 force，远端的记录也留着**。

## 六、这轮踩过的坑

- **`addons/` 是副本，会变旧。** 长期不同步的后果是：推上去的是三个月前的插件，别人装下来就是坏的那版。
- **把「工作区那份没 git 仓库」读成「这插件不在发布仓库里」。** 工作区目录从来不该有 `.git`，它只是源码；发布副本在 `addons/`。两件事分开看，就不会得出「推不上去」这种结论——那不是推不上去，是没先把库里那份换新。
- **只改了活的那份，就以为改完了。** 符号链接指向工作区，所以运行永远正常、面板永远对；错的只是仓库里那份，安静地停在旧版。**它不报错，只在别人装上时坏。** 判据只有 `diff -rq`，不看它跑得顺不顺。
- **先推再同步，等于推了个旧版本。** 顺序倒过来不会有报错，只会把旧代码送上去，然后本地还是新的——两边从此各说各的，下次谁也不知道哪个算数。
- **目录名不等于包名。** 找符号链接、找配置里的挂载点，认包名。
- **自检写了两处、跑了一处。** host 端加过滤、client 端加了，host 那次忘了加同样一条——面板能看见、接口查不到。**同一条判据写两遍，两遍都要验。**
- **网络问题当成凭证问题。** 弹窗、清凭据、换账号折腾一圈，其实是连不上。先看错误原文说的是哪个词。
- **「插件更新」和「功能更新」混着叫。** 插件是一个独立包，功能是框架里的一个 impl。混着说，改出来的东西落错地方。

## 附录：当前清单

> 2026-11-02 核对。**只列自建的**——别人的插件自有它的作者和文档，抄进来出事时不知道该找谁。
> 这里只有一份真源；`framework/modules/83-插件清单.md` 已改成指向这一节。

### 主件

| 包名 | 版本 | 做什么 | 位置 |
| --- | --- | --- | --- |
| `dsh-persona-framework` | 5.18.0 | 人格框架：88 个模块，外挂注入，不覆盖人格文件 | `https://github.com/re3uofall/dsh-persona-framework` |

### 可随框架一起装的

| 包名 | 版本 | 做什么 | 位置 |
| --- | --- | --- | --- |
| `dsh-persona-grow` | 1.2.0 | 每轮注入人格；从纠正里长出新的一条，带版本可回滚 | `persona-grow-plugin/`，未发布 |
| `dsh-persona-diary` | 1.3.0 | 日记：公开／私密两本、分类、搜索、浏览 | `persona-diary-plugin/`，未发布 |
| `dsh-persona-explore` | 0.3.0 | 自己上网搜、读原文，把值得留的写进 `knowledge/web` | `persona-explore-plugin/`，未发布 |
| `dsh-persona-results` | 1.2.0 | 把认下的判断收进侧栏 | `persona-results-plugin/`，未发布 |
| `dsh-persona-memory` | 1.2.2 | 记忆分层：按预算取、超期归档、摘要带指针可翻原文 | `dsh-persona-memory/`，未发布 |
| `dsh-persona-vision` | 0.1.0 | 看图：抓几帧、只留变了的、拼一张喂视觉模型 | `addons/dsh-persona-vision/`，未发布 |

**一加六**：一个主件有仓库，六个附件都没上 GitHub。vision 没有独立的工作区目录，只活在 `addons/` 里——它还没装进 node_modules，设置页里也扫不到。

改清单的规矩和改模块一样：**不删旧条，划一道线写「已迁往」**。删掉等于抹。
