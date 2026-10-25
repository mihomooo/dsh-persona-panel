## 0.4.6

**记忆按挡位读取，不再每轮全塞。**

- 每轮常驻只有人设卡与画像；事件只在会话开场按总量读取（≤8 条全读、≤20 条读 80%、更多读 60%），之后只剩「三天内到期」的提醒。
- 日记在会话开场读最近 21 天（不足 21 条则读最新 21 条）；不够时用 `persona_recall` 按段往回翻。
- `persona_recall` 新增 `depth`：`index`（按月目录）、`shallow` / `medium` / `deep`（各四分之一）、`all`（全部）。目录先看，再挑一段，最后才全部展开。
- 事件容量默认 20 条、可调、0 = 不限；标 `★ 重要` 的事件不占名额，注入时排最前。
- 自我日记（0.4.0）：第一人称、只能往下写，面板只读，改不了也删不了。
- 工程事件（0.3.0）：项目推进、定下的方案、做完并验收的工作记为 `work`；踩过的坑与「别再这样做」写进 AGENTS.md，不进记忆。
- 共生工作区同步：上限、称呼、开关、词库随共享的 store 一起变；记录挡位（manual/half/active/auto）故意不同步。
- 多用户画像：默认关闭；开启后按昵称区分群友，可检索、可单独删除。

安装：

```bash
dsh plugin install https://github.com/mihomooo/dsh-persona-panel/releases/latest/download/dsh-persona-panel.tgz
```

或用市场里的「记忆」分类。纯本地存储，`~/.dsh/persona-panel/db.json`，卸载不删数据。

### English

- Standing prompt now carries persona + impression only. Events load at session start as 100% / 80% / 60% of the drawer (by size), then only what comes due within three days.
- Diary loads the last 21 days at session start. `persona_recall` gained `depth`: `index` (a month-by-month table of contents), `shallow` / `medium` / `deep` (a quarter each), `all`.
- Event cap: 20 by default, configurable, 0 = unlimited; entries marked ★ important are exempt and sorted first.
- Self-diary (append-only, read-only in the panel), work events, symbiote sharing, and multi-user profiles for group chats.
