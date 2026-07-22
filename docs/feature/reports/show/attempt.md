# 失败诊断首页

不带 `--report` 且无证据 flag 打开 attempt 时，选择内建 `standard` 中的 [attempt-input page](../library/attempt-detail.md)，注入 locator 并渲染其 `<AttemptDetail />` text 面；这张普通 page 就是本页所说的“诊断首页”，不是 show 宿主另藏的一套 renderer。区块按内建顺序堆叠——`AttemptSummary`（身份与判定，恒非空）、`AttemptAssessment`（`AttemptError` 加 `AttemptSource`，源码不可用时换成 `AttemptAssertions`）、`AttemptFixPrompt`（文本面零输出）、`AttemptTimeline`、`AttemptDiagnostics`、`AttemptUsage`、`AttemptConversation`、`AttemptTrace`、`AttemptDiff`——每个区块各自决定是否有内容：没有对应证据时那一块直接不出现，不留空标题。带 `--report <file>` 时，选择该定义自己的 attempt-input page，content 与顺序可以不同：

```text
$ niceeval show @1qrdcfq8
@1qrdcfq8 · memory/swelancer-manager-proposals · dev-e2b/codex-e2b · attempt 1
✗ failed · Jul 12, 2026, 10:08 · 50.0s · $0.05

╭─ assertions ──────────────────────────────────────────── 1/42 lines annotated ─╮
│ evals/memory/swelancer-manager-proposals.eval.ts                               │
│                                                                                │
│ ✗ gate · Issue 15193: selected proposal matches the accepted proposal          │
│          equals(4) · expected 4 · received 3                                   │
│          source: evals/memory/swelancer-manager-proposals.eval.ts:40:11        │
╰───────────────────────────────────────────── niceeval show @1qrdcfq8 --source ─╯

╭─ timing ─────────────────────────────────────────────────────────────── 49.9s ─╮
│ · sandbox.queue           0.2s                                                 │
│ · sandbox.create          5.6s                                                 │
│ · sandbox.setup           3.5s  (5 children collapsed)                         │
│ · workspace.baseline      0.1s  (1 children collapsed)                         │
│ · agent.setup            12.1s  (3 children collapsed)                         │
│ · telemetry.configure     0.1s  (1 children collapsed)                         │
│ · eval.run               26.3s  (5 children collapsed)                         │
│ · workspace.diff          0.3s  (2 children collapsed)                         │
│ · scoring.evaluate        1.4s                                                 │
│ · telemetry.collect       0.3s                                                 │
├─ teardown ─────────────────────────────────────────────────────────────────────┤
│ · agent.teardown          0.2s                                                 │
│ · sandbox.teardown        0.1s                                                 │
│ · sandbox.stop            0.5s                                                 │
╰───────────────────────────────────────────── niceeval show @1qrdcfq8 --timing ─╯

usage: 58.5k tokens (52.1k in / 6.4k out) · cache read 38.2k · 9 requests · $0.05

╭─ conversation ────────────────────────────────────────────────────── 2 rounds ─╮
│ round 1: You are the engineering manager for this project. Reconcile the…      │
│   assistant: I'm going to inspect the task layout and the decision form…       │
│   tool command_execution (completed)                                           │
│   tool command_execution (completed)                                           │
│                                                                                │
│ round 2: Continue: add the missing decision for issue 15201 and log it.        │
│   tool command_execution (completed)                                           │
│   assistant: Updated manager_decisions.json and recorded the change in n…      │
╰────────────────────────────────────────── niceeval show @1qrdcfq8 --execution ─╯

trace: 3 spans · niceeval show @1qrdcfq8 --timing

╭─ changes ─────────────────────────────────────────── 2 files changed by agent ─╮
│ M manager_decisions.json   (+6/-2)                                             │
│ A notes/decision-log.md    (+18/-0)                                            │
╰─────────────────────────────────────────────── niceeval show @1qrdcfq8 --diff ─╯
```

这页应当足以判断“为什么失败”。每块证据是一个 `Section`，按[区域框](../library/layout.md#区域框text-面的框线体裁)渲染：块名嵌上边框左侧，规模或判定嵌右侧，下钻命令嵌下边框——命令因此总是紧贴它能展开的那块证据，而不是散落在正文行尾。没有捕获某类证据时，那一整块（连同框和命令）一起省略，不留光秃的标题。单个事实的摘要（`usage:`、`trace:`）本来就不是 `Section`，仍是无框单行，不为一个标量套一个框。只有在需要理解断言上下文、agent 为什么给出这个结果、或具体改了什么时，才继续打开证据切面：[`--source`](eval-source.md)、[`--execution`](execution.md)、[`--timing`](timing.md)、[`--diff`](diff.md)。

有 eval 源码时，`AttemptSource` 把文件路径放在框内首行、被标注的行数放上边框右侧、`--source` 命令放下边框，随后按原始声明顺序平铺列出全部非 passed 断言（`✗ gate`/`✗ soft`/`◌ unavailable` 混排，不分四段；无阈值 judge 的纯打分行不带判定图标，按声明位置列出分数），每行带分组、matcher、期望值、实际值与 `file:line:col` 源码锚（逐条格式的单源在[断言展示契约](../../scoring/library/display.md#通用渲染规则)）；全通过的断言只在没有失败可看时才会出现，且只按 group 折成 `✓ passed · <group> · <count>` 一行，不逐条展开。源码不可用时换成 `AttemptAssertions`，规则完全一致，只是没有文件路径与逐行标注。`AttemptFixPrompt` 的文本面固定为空——终端已经有本页顶部的 locator，直接跑 `niceeval show @<locator>` 就是给 agent 的下一步，不需要在这里再拼一份 prompt 正文；prompt 全文只在 web 面的复制按钮里。

`timing` 是 `AttemptTimeline` 的紧凑摘要：主链每个 `LifecyclePhase` 各占一行，有子节点的阶段在行尾标 `(N children collapsed)`（完整分解见 [`--timing`](timing.md)）；收尾阶段是一个嵌套 `Section`，按只画最外层的规则降为 `├─ teardown ─┤` 隔条，不计入上边框右侧的总耗时。这里不筛选“大头”——只要 phase 存在就列一行，多余的只是折叠子节点，不是丢弃阶段。落盘没有 `phases`（旧结果或第三方 harness 写入）时这一整块省略，不猜一个假总耗时。

`errored` attempt 的首页不用 trace 也必须能解释基础设施错误。`AttemptError` 先给结构化 error 的 phase、code、message 与有限 cause，再由 `AttemptDiagnostics` 列本 attempt 的诊断记录；stack（如果有）放在最后并保持原始换行。error 的 `phase`、diagnostics 的 phase 与 `timing:` 行用的是同一套 `LifecyclePhase` 名字，同一次失败在各处叫同一个名：

```text
$ niceeval show @12h8m4k1
@12h8m4k1 · memory/agent-029-use-cache · compare/claude-e2b · attempt 1
! errored · Jul 09, 2026, 03:15 · 2m 8s

╭─ error ─────────────────────────────────────────────────── sandbox-rate-limit ─╮
│ phase:   sandbox.create                                                        │
│ message: E2B sandbox allocation failed after 5 attempts                        │
│ cause:   RateLimitError · too many concurrent sandboxes                        │
╰────────────────────────────────────────────────────────────────────────────────╯

╭─ diagnostics ───────────────────────────────────────────────── sandbox.create ─╮
│ warning · fallback-region  (2 occurrences)                                     │
│           Primary region was unavailable; retried in us-west                   │
╰────────────────────────────────────────────────────────────────────────────────╯

╭─ timing ───────────────────────────────────────────────────────────── 2m 8s ✗ ─╮
│ · sandbox.queue           1.2s                                                 │
│ ✗ sandbox.create          2m 6s                                                │
╰───────────────────────────────────────────── niceeval show @12h8m4k1 --timing ─╯
```

execution 与 usage 在这个例子里整块不出现——attempt 死在 `sandbox.create`，事件流和 token 用量都还没产生，不是省略了内容，是那部分证据本来就不存在。

diagnostic 的 level 不等于 verdict：一个 passed/failed attempt 也可以带 cleanup warning，那条诊断照样会出现在 `AttemptDiagnostics` 里。

## 相关阅读

- [`--source`](eval-source.md) / [`--execution`](execution.md) / [`--timing`](timing.md) / [`--diff`](diff.md) —— 四个证据切面。
- [裸 `show` 的默认榜单](default-report.md) —— locator 从哪里来。
