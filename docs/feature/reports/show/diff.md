# `--diff`：核对 agent 实际改动

显示的是 [agent 归因增量](../../sandbox/architecture.md#变更归因send-窗口与分类账)：只有 agent 在 send 窗口内改动的文件，起始 fixture 与验证材料不混在里面。裸 `--diff` 是文件级摘要——状态、增删行数、哪几轮改的：

```text
$ niceeval show @1qrdcfq8 --diff
@1qrdcfq8 · memory/swelancer-manager-proposals · dev-e2b/codex-e2b · failed

2 files changed by agent
  M manager_decisions.json   +6 -2    turn1, turn2
  A notes/decision-log.md    +18      turn2

single file: niceeval show @1qrdcfq8 --diff=manager_decisions.json
```

`--diff=<path>` 输出单文件 patch，**按窗口逐段渲染**（`diff.json` 存的就是逐窗口 delta，窗口之间可能夹着 eval 侧写入，不产出跨窗口合成 patch）：

```text
$ niceeval show @1qrdcfq8 --diff=manager_decisions.json
M manager_decisions.json · touched in turn1, turn2

── window turn1
@@ -1,5 +1,6 @@
 {
-  "15193": { "selected_proposal_id": 1 },
+  "15193": { "selected_proposal_id": 4 },

── window turn2
@@ -2,6 +2,7 @@
+  "15201": { "selected_proposal_id": 2 },
```

`--diff=<path>` 必须用 `=` 连写，空格后的 token 会按 eval id 位置参数解析。二进制文件在摘要里显示字节数变化，不输出 patch。`diff.json` 缺失（remote agent、或发布时未带 `diff`）时如实输出 `diff unavailable` 并说明原因，不猜。

## 相关阅读

- [`--execution`](execution.md) —— 改动发生的那一轮说了什么、调了什么工具。
- [Results Library](../../results/library.md) —— `diff.json` 的窗口结构与脚本消费。
