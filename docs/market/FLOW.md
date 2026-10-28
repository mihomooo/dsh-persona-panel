# 发版与上市场：一条流程走完

> 每次发新版都照这份做。图省事跳过某一步，出过的错都在「坑」里。

## 1. 代码与文档

1. `package.json` 的 `version` 改成新版本（`0.7.3` 这种三段）。
2. 写 `docs/market/release-notes-<版本>.md`：改了什么、为什么、测试、升级命令。
   **示例一律用假设的名字与工作区**（如「小满」「阿元」「书房」）—— 发布说明是公开的。
3. `node --check index.js && node --check client.js`。
4. 跑全套：`for f in demo/*-test.mjs; do node $f; done`，必须全绿。
5. 提交并推：`git add -A && git commit -m ... && git push`。

## 2. 打包与发布到 npm

```powershell
npm pack                                   # 产出 dsh-persona-panel-<版本>.tgz
Move-Item -Force dsh-persona-panel-<版本>.tgz dsh-persona-panel.tgz
(Get-FileHash dsh-persona-panel.tgz -Algorithm SHA256).Hash

# 用临时 .npmrc 注入 token，别写进全局配置、别提交进仓库
$token = (Get-Content -Raw "$env:USERPROFILE\npm-token.txt").Trim()
$tmp = Join-Path $env:TEMP ('npmrc-' + [guid]::NewGuid().ToString('N'))
[IO.File]::WriteAllText($tmp, ('//registry.npmjs.org/:_authToken=' + $token), (New-Object Text.UTF8Encoding($false)))
npm publish --access public --userconfig $tmp
Remove-Item $tmp -Force
```

- 版本号发布后**不能覆盖**，再发必须先在 `package.json` 里升版本。
- token 存 `~/.npm-token.txt`（granular，90 天，2026-10-28 建 → **2027-01-26 到期**）。到期只会让 CLI 报 401，已发布的包、版本、下载量都不受影响；届时重建一个 token 覆盖该文件即可。
- 刚发完 `npm view` 可能先显示 `0.0.0-stage`（新包占位），等一两分钟再看真版本；`latest` 会指向真版本。
- bypass-2FA 的 granular token **不能 unpublish**（会 403），要删版本得在网页上带 6 位码操作。
- npm 已宣布 **2027 年 1 月起**取消 bypass-2FA token 的直接发布：到那之后要么用 stage-only token + `npm stage publish` 再人工批准，要么走 trusted publishing（CI OIDC）。

**资产名不带版本号**：市场条目用 `releases/latest/download/dsh-persona-panel.tgz`，
文件名带版本就会在下次发版时 404。

## 3. 发 GitHub Release（网页，用 bsk）

1. 打开 `https://github.com/mihomooo/dsh-persona-panel/releases/new`。
2. Tag 下拉 → 输入新 tag（`v0.7.3`）→ **Create new tag** → Create。
3. Title 填 tag 名；正文用发布说明全文。
   - 中文不要经命令行参数传（bsk 的 argv 会按 ANSI 解码 → 乱码）：写进页面时用
     `window.__b64='<base64>'` + `TextDecoder` 还原，再 `set.call(textarea, s)` + `input` 事件。
4. 附件：`bsk upload --session <sid> --selector '.js-upload-release-file' --file <tgz>`。
5. Release label 选 **Latest**，**不勾 Pre-release**（勾了市场会犹豫），点 **Publish release**。

## 4. 发完核对（别只看页面）

```powershell
$h = @{'User-Agent'='dsh'}
$r = Invoke-RestMethod 'https://api.github.com/repos/mihomooo/dsh-persona-panel/releases/latest' -Headers $h
"$($r.tag_name) draft=$($r.draft) pre=$($r.prerelease)"
$r.assets | % { "$($_.name) $($_.size)" }
```

再下它的 `browser_download_url` 对字节与 SHA-256。
**`releases/latest/download/…` 有 CDN 缓存**，刚发完可能还取到上一版；要立刻核对就用
`assets[].browser_download_url`。要修已发的 release 又不改 tag：删 release（tag 会留）→ 用同一 tag
重建 → 重新上传 → Publish。

## 5. 市场条目

- 文件：`data/plugins/mihomooo__dsh-persona-panel.yml`（上游已收录在 `main`）。
- 内容写 `tarball: …/releases/latest/download/dsh-persona-panel.tgz`，**发新版不用改条目**。
- 截图声明在**自己仓库**的 `screenshots.json`，不在上游仓库。

## 6. 收录规则（要改条目、或做新插件时照这个自查）

CI 自动查：一个 PR ≤3 条 · 仓库满 1 天 · `package.json` 有 `dsh.bundle`（只有 `dsh.client` 会被拒）·
条目文件路径 `data/plugins/<owner>__<repo>.yml` · `description.en` 必填 · awesome-lint 与站点构建。
维护者手工读：描述是否与代码相符（夸大是主要打回原因）· 分类是否贴近 · 是否真代码 · 是否重复 ·
源码有无可疑 · PR 是否乱改别人条目 · 是不是纯聚合包 · 依赖是否指原作者。

## 7. 坑（都真踩过）

- **分支落后上游 = PR 冲突 = gate 不跑**。冲突几乎都在生成的 README 行上，推送解决不了；
  维护者会 rebase，或者**直接把条目落进 main 再关掉 PR**（`closed` ≠ 被拒，别重开、别重提）。
  提 PR 前先同步 fork：`git fetch upstream main && git reset --hard FETCH_HEAD && git push --force origin main`。
- **别手改 README**（由 `data/plugins/*.yml` 生成）。
- `held: author` 标签 = 等你改：推同一分支 + **一条**评论说明改动即可，别反复推、别催。
- 写文件别用 PowerShell 的 `Set-Content -Encoding utf8`（BOM），中文会坏；用编辑器/Node 写。
