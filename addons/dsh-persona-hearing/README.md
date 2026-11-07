# dsh-persona-hearing · 器官 · 耳

> 一句话：**声音落成带时间码的字；听不清也要标出来。**

器官层的「耳」。器官名是 `ear`，这个包是实现件（`dsh-persona-hearing`）——功能可以换，器官不换。

## 它是哪一类器官

**被调用器官**：只有 `ear_*` 被调时才听。没有段、没有触发器，不调就没有。
跟手、嘴（自动器官，工具 + 账 + 触发器）不一样：耳不主动听，也不常开。

## 四个工具

| 工具 | 干什么 | 判据 |
| --- | --- | --- |
| `ear_status` | python / ffmpeg / faster-whisper 三样齐不齐，账上几段 | 缺哪样写哪样，不给 `ready:true` 的假话 |
| `ear_hear` | 真听一段音频/视频，转成带时间码的文本 | 引擎不齐就直说缺什么；不给假时间码 |
| `ear_take` | 把已经转好的 txt / srt 收进来 | srt 保时间码，txt 一行一段；没引擎也能走 |
| `ear_receipt` | 看耳朵账 | 时间、来源、句数、第一句 |

## 形状抄自谁

`dsh-cixisound`（第三方，MIT）：装载只报状态、不在装载时装依赖、工具输出声明用 `{ schema, render }`。
**抄的是形状**；引擎探测、账本格式、pending 与「说过就清」是我们自己的。

## 引擎

`ear_hear` 要三样：python 3.10+、ffmpeg（PATH 里）、`faster-whisper`（`pip install faster-whisper`）。
三样齐才听；不齐就回一句「缺 X」，并把这次失败记进耳朵账——**失败也算一段听见的事**。
没引擎时 `ear_take` 照样能用：别处转好的稿子直接收。

## 三条边界

- **不猜内容**：引擎没回 JSON、文件不存在，都直说。
- **不常开听**：耳朵不是监听器。
- **不当记忆**：听见的进耳朵账，不进记忆池——要进记忆得另走一步。

## 账本

- `.persona-framework/耳朵账.jsonl` —— 一行一段：`{at, ok, source, segments, chars, reason?}`
- `.persona-framework/耳朵状态.json` —— `{pending: [...], spokenAt}`；注过就清。

## 更新记录

- 2026-11-07　v0.1.0 初版：四个工具、引擎三探、srt/txt 解析、pending 与「说过就清」；自检 15 项全过。
