# npm 账号冻结：先判断，再申诉

账号 `mihomooo`，包名 `dsh-persona-panel`。症状：能登录、能浏览，但发布和建 token 被拒；
网页顶部红条写 `Your account has been temporarily suspended due to a recent security-sensitive action.`

## 一、先确认是哪一种（别急着写邮件）

npm 自 2026-09-09 起对**所有账号**启用一条规则：用恢复码（recovery code）登录成功之后，
账号会进入 **72 小时安全冻结**，期间「发布」和「建 access token」等敏感写操作被暂停，登录和装包不受影响，
**到期自动解除，不需要联系支持、也不需要申诉**。

- 依据：GitHub Changelog《npm extends recovery-code security holds to all accounts》(2026-09-09)
  <https://github.blog/changelog/2026-09-09-npm-extends-recovery-code-security-holds-to-all-accounts/>
- 关键原文：`The hold expires automatically — no action or support request is needed to restore full access.`

所以第一步：翻 npm 发来的那封「security hold / suspended」通知邮件，看**时间戳**，加 72 小时，
那个时刻之后再试。不要在这个窗口内反复提交申诉——只会拖慢处理。

> 时间只能从邮件里取，别按记忆估。截图上的 04:26–04:30 是哪一天，决定了到期点是哪一天的凌晨。

## 二、到期之后怎么验证

1. 浏览器登录 <https://www.npmjs.com/settings/mihomooo/profile>，看顶部红条是否消失。
2. 本地 `npm login --auth-type=web`（浏览器点授权），然后 `npm whoami` 应回 `mihomooo`。
3. `npm publish --dry-run` 走一遍打包，不真发；确认没有 403。

三条都过，就可以正式发版（见 `PR.md` 的步骤 0）。

## 三、到期仍然冻结，才申诉

渠道（按顺序，只用一个）：

1. <https://www.npmjs.com/support> —— 官方支持表单，登录状态下提交，类目选 Account / Publishing。
2. 表单打不开就发邮件：`support@npmjs.com`。
3. 不要用 npm/cli 的 GitHub issue 当申诉通道，那不处理账号问题。

只发一次，之后最多每周跟进一次；重复提交会降低优先级。

### 邮件模板（英文，直接改括号）

```
Subject: Account suspension appeal - npm user mihomooo (publishing blocked)

Hello npm Support,

My account "mihomooo" (email: <你的注册邮箱>) is currently blocked from publishing and from
creating access tokens. The web UI shows: "Your account has been temporarily suspended due to a
recent security-sensitive action." This started on <YYYY-MM-DD HH:MM timezone> and is still
present after <N> hours.

What I was doing when it started: I signed in and enabled two-factor authentication (passkey),
then tried to create a granular access token for publishing a new package.

What I would like: the hold lifted so I can publish the package "dsh-persona-panel" and create a
granular token scoped to it.

Account facts:
- username: mihomooo
- 2FA: enabled (passkey), working
- packages published: none yet
- no one else has access to this account

I have already read the recovery-code security hold policy and understand the hold may be
automatic; I am writing because it has not cleared after the stated window.

Thank you,
<你的名字>
```

**绝对不要**附上：密码、2FA secret、恢复码、token。恢复码已经不该再出现在任何地方——见下一节。

## 四、解冻之后立刻做三件事

1. **重新生成恢复码**（Settings → 2FA → recovery codes，旧的作废）。旧的曾经出现在聊天记录里，按已泄露处理。
2. 建 granular token：`Read and write (publish and stage)` + `All packages`，有效期给短一点。
3. 再 `npm publish --access public`，然后等次日 12:1x–12:3x（+08）的 `dsh-plugin-catalog` 索引重建，Discover 里才能搜到。
