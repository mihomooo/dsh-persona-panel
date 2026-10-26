# npm 账号冻结：已确认自动解冻，无需申诉

**结论（2026-10-26 收到官方邮件确认）**：账号 `mihomooo` 因**使用恢复码登录**进入 72 小时安全冻结。
**自动恢复：2026-10-28 08:09 UTC = 2026-10-28 16:09（北京时间）**。期间只读——
不能发布、不能建 token、不能改包设置、不能改维护者；登录、浏览、安装正常。

邮件原文要点：

```
Your npm account 'mihomooo' has been temporarily suspended for 72 hours because a recovery code
was used to log in. Your account will automatically return to normal on October 28, 2026 at 08:09 UTC.
IF THIS WAS YOU: no further action is required.
```

政策依据：GitHub Changelog《npm extends recovery-code security holds to all accounts》(2026-09-09)
<https://github.blog/changelog/2026-09-09-npm-extends-recovery-code-security-holds-to-all-accounts/>
原文：`The hold expires automatically — no action or support request is needed to restore full access.`

**所以：不申诉、不填表、不发邮件。到点再试就行。**

## 但「是不是我」必须先确认：恢复码曾经出现在聊天记录里

邮件里 `IF THIS WAS NOT YOU` 分支的那几步必须走一遍——同一批恢复码被贴进过对话，按已泄露处理。
这几步在冻结期内仍然可以做：

1. 改密码 <https://www.npmjs.com/settings/~/password> —— 让任何既有会话失效。
2. 审计 2FA 设备 <https://www.npmjs.com/settings/~/tfa/list> —— 只保留自己的 passkey，删掉不认识的。
3. 重新生成恢复码 <https://www.npmjs.com/settings/~/recovery-codes> —— 旧的一次性码全部作废。
4. 审计 token <https://www.npmjs.com/settings/~/tokens> —— 撤销任何不是自己建的 granular token。

解冻后再核对一次：`Require 2FA for write actions` 是否仍是原样、包的维护者列表里有没有陌生账号。

## 解冻后怎么验证（2026-10-28 16:09 之后）

1. 登录 <https://www.npmjs.com/settings/mihomooo/profile>，顶部红条应已消失。
2. 本地 `npm login --auth-type=web`（浏览器点授权），`npm whoami` 应回 `mihomooo`。
3. `npm publish --dry-run` 走一遍打包，不真发；不应再出现 403。

三条都过，按 `PR.md` 的步骤 0 正式发版。**发版时不要标 Pre-release**——市场条目的 tarball 走
`releases/latest/download`，标了 pre-release，`latest` 仍指向上一版，别人装到的是旧版本。

## 万一到点仍未解除（这种情况才申诉）

渠道按顺序，只用一个：

1. <https://www.npmjs.com/support> —— 官方支持表单，登录态提交，类目 Account / Publishing。
2. 表单打不开就发 `support@npmjs.com`。
3. 不要用 npm/cli 的 GitHub issue 当申诉通道，那里不处理账号问题。

只发一次，之后最多每周跟进一次；重复提交会降低优先级。

### 邮件模板（英文，直接改括号）

```
Subject: Security hold not lifted - npm user mihomooo (publishing still blocked)

Hello npm Support,

My account "mihomooo" (email: <你的注册邮箱>) received the 72-hour recovery-code security hold
notice, which said the account would return to normal on October 28, 2026 at 08:09 UTC. It is now
<当前时间 UTC> and publishing is still blocked; the web UI still shows the account as temporarily
suspended.

What I need: the hold lifted so I can publish the package "dsh-persona-panel" and create a
granular access token scoped to it.

Account facts:
- username: mihomooo
- 2FA: enabled (passkey), working
- packages published: none yet
- no one else has access to this account
- password rotated and recovery codes regenerated after the hold notice

Thank you,
<你的名字>
```

**绝对不要**附上：密码、2FA secret、恢复码、任何 token。

## 解冻之后立刻做三件事（顺序别换）

1. **重新生成恢复码**（旧的曾在对话里出现，作废）。这一步如果已在冻结期内做过，跳过。
2. 建 granular token：`Read and write (publish and stage)` + `All packages`，有效期给短一点。
3. `npm publish --access public`，然后等次日 12:1x–12:3x（+08）的 `dsh-plugin-catalog` 索引重建，
   DSH 内 Plugins → Discover 才搜得到。
