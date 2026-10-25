# 投稿到 awesome-dsh-plugin（草稿）

前置：仓库创建满 1 天 → 最早 `2026-10-26 15:23 +08` 之后提交。

## 步骤 0：Release 已就绪（2026-10-25 完成）

[v0.4.9](https://github.com/mihomooo/dsh-persona-panel/releases/tag/v0.4.9) 已发布为 latest，
附件 `dsh-persona-panel.tgz`（128,083 字节，0.4.9 内容）。
市场条目里的 `tarball`（`releases/latest/download/dsh-persona-panel.tgz`）现在指向它；不要再建新 Release，
否则 latest 会挪走而条目仍写死 `latest`——这是对的，条目本来就该跟着最新版本走。

## 要提交的文件

路径：`data/plugins/mihomooo__dsh-persona-panel.yml`

内容用本目录的 `mihomooo__dsh-persona-panel.yml`（同名，直接复制）。

## 步骤（网页，不装 git 也能做）

1. 打开 https://github.com/awesome-dsh-plugin/awesome-dsh-plugin
2. 右上角 **Fork** → 创建 `mihomooo/awesome-dsh-plugin`。
3. 在 fork 里：**Add file → Create new file**。
4. 文件名填 `data/plugins/mihomooo__dsh-persona-panel.yml`（斜杠会自动建目录）。
5. 粘贴 yml 内容 → **Commit changes**（提交到 main 即可）。
6. 回到 fork 首页，点 **Contribute → Open pull request**（或 Compare & pull request）。
7. 标题：

```
Add dsh-persona-panel (memory)
```

8. 正文：

```
Adds `dsh-persona-panel`, a per-workspace memory panel for DeepSeek Harness.

- One store per workspace: persona traits (intensity + hard rules), user notes, dated events, first-person diary (append-only).
- Every entry keeps its source quote and can be retracted; trait removal is staged.
- Workspaces can share one memory (symbiote) and be cut apart again.
- Optional per-person profiles for group chats; capped event list with ★ marks.
- Local only: data in `~/.dsh/persona-panel/`, no network calls, zero npm dependencies.
- Repo: https://github.com/mihomooo/dsh-persona-panel
- Install: https://github.com/mihomooo/dsh-persona-panel/releases/latest/download/dsh-persona-panel.tgz
```

## CI 会查的（自查清单）

- [x] `package.json` 有 `dsh.bundle.patch`（`./cordis.patch.yml`）
- [x] 仓库根有 `cordis.patch.yml`
- [x] topic `dsh-plugin`
- [x] 仓库创建满 1 天
- [x] 真实代码（index.js + client.js）
- [x] 描述只是功能、不带营销词
- [x] `repository` 指回本仓库
- [x] `screenshots.json` 在仓库根，指向 `screenshot.png`
- [x] 只加一个文件，不改 README、不动别人的条目
