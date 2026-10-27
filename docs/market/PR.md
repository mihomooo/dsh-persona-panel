# 投稿到 awesome-dsh-plugin

**已提交：2026-10-26 → [PR #9584](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/9584)**
（1 commit / 1 file / +7；`mergeable=True`，`action_required` 是首次贡献者需要维护者点一次批准跑 CI，属正常。）

余下流程与文案保留在下面，供下次发新版或修改条目时复用。

## 步骤 0：Release 已就绪（2026-10-27 23:38 更新，0.7.2 为 latest）

[v0.7.2](https://github.com/mihomooo/dsh-persona-panel/releases/tag/v0.7.2) 已发布为 latest，
附件 `dsh-persona-panel.tgz`（147,439 字节，SHA-256 `a93f9dbf47f75ad7c18bea8d1e02459280f2548cc14bf0e3023724009027166b`，0.7.2 内容）。
市场条目里的 `tarball`（`releases/latest/download/dsh-persona-panel.tgz`）现在指向它；条目写 `latest`
就是让包跟着最新版本走，以后发新版不必改条目。发新版前先确认 latest 已经挪过去，再提 PR。
（0.7.2 把提示词从「规定」改成「问句」：先摊材料、再问三句、最后才是写法；写自己时以「要…」「不要…」
开头的 trait 会被宿主拦下，要求改写成「当时我做了什么」；提醒改成问句并按信号提前。0.7.1 则把
「什么算重要」交回模型自己判断。PR #9584 尚未合并，条目本身不需要改。）

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
