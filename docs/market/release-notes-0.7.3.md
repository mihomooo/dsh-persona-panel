# dsh-persona-panel 0.7.3

## 改：名字、称呼、工作区，写在卡片开头

0.7.2 之前这三样混在一个背景标题里（`背景：拾 在「ds」`），读起来像分隔符，不像事实。新会话被问「你是谁、叫什么」时，确实出现过答「还没名字」——东西在，写得太轻。

现在卡片第一行就是一句陈述：

```
## 我叫「拾」
他叫我「好搭档」。
我在「ds」这里。
```

名字、称呼、所在工作区各自成行，没有人名的地方就整行不出。卡片其余部分（此刻最像我、先看三眼、这些字是真的、回话之前、写下来的时候）与 0.7.2 相同。

## 测试

- 19 套件全绿（含 `demo/core-test.mjs` 的新断言：首三行按名字/称呼/工作区顺序出现，缺一项不出那一行）。

## 升级

```bash
dsh plugin --profile <profile> add https://github.com/mihomooo/dsh-persona-panel/releases/latest/download/dsh-persona-panel.tgz
```

装完**重启 DSH**；数据不用迁移，`~/.dsh/persona-panel/` 原样可用。
