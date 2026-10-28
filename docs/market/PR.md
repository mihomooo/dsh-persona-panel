# 投稿到 awesome-dsh-plugin

**已提交：2026-10-26 → [PR #9584](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/9584)**
（1 commit / 1 file / +7。维护者 `fkysly` 于 10-27 20:41Z 关闭该 PR，并**直接把条目落进主仓库 `main`**：
说明是「分支与 main 冲突、CI 跑不了，按冲突流程直接落」，落地前核过 `dsh.bundle`、图标与 tarball 三项。
落地文件与最终提交逐字节一致（`data/plugins/mihomooo__dsh-persona-panel.yml`，964 字节，`sha 48fe8def`）。
`closed` 不等于被拒，也**不要重复提 PR**——条目已在 `main`，等站点重建即出现在市场。）

余下流程与文案保留在下面，供下次发新版或修改条目时复用。

## 步骤 0：Release 已就绪（2026-10-28 17:25 更新，0.7.3 为 latest）

[v0.7.3](https://github.com/mihomooo/dsh-persona-panel/releases/tag/v0.7.3) 已发布为 latest，
附件 `dsh-persona-panel.tgz`（147,836 字节，SHA-256 `f9d838f79c4b219f023ce4901a8cb4467caf8b9de2672142550d1ee61de59196`，0.7.3 内容）。
市场条目里的 `tarball`（`releases/latest/download/dsh-persona-panel.tgz`）现在指向它；条目写 `latest`
就是让包跟着最新版本走，以后发新版不必改条目。发新版前先确认 latest 已经挪过去，再提 PR。
（0.7.3 把名字、称呼、工作区写成卡片第一行的三句陈述，并让新会话先接纳这些字再判断——之前它常
把那批记忆当成「上一个会话的」，读到了也不用。0.7.2 把提示词从「规定」改成「问句」：先摊材料、
再问三句、最后才是写法；以「要…」「不要…」开头的 self trait 会被宿主拦下。0.7.1 则把「什么算重要」
交回模型自己判断。）
（`releases/latest/download/…` 是 CDN 缓存的地址，刚发完版可能还取到上一版；要立刻核对就用 API 给的
`assets[].browser_download_url`，那个不带缓存。）

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
