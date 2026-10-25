## 0.4.7

两个小修，都是 0.4.6 用起来才暴露的：

- **只有日记的工作区不再被当成「空的」。** 之前提示段判断「这一节还是空的」只看人设/画像/事件，于是只有日记的工作区在非开场回合会收到空工作区的引导语。现在任何一类有条目都算非空。
- `persona_recall` 的描述里把工具名写错了（`person_remember`），改回 `persona_remember`。

安装仍是：

```bash
dsh plugin install https://github.com/mihomooo/dsh-persona-panel/releases/latest/download/dsh-persona-panel.tgz
```
