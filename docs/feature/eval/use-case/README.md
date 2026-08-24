# Eval 用例

本目录把 `defineEval` 与 `defineScoreEval` 组合成真实场景。基础契约只在
[Library](../library.md)、[Context](../library/context.md)、[Assertions](../../assertions/README.md) 和
[Sandbox](../../sandbox/library.md) 定义。

## 会话驱动

- [单轮：一问一答就断言](first-single-turn.md)
- [多轮与并行会话：每轮各自断言](multi-turn-sessions.md)
- [HITL 审批：agent 停在人工输入上](hitl-approval.md)

## Assertions 与评分项

- [过程与成本：断言 Agent 怎样完成任务](process-and-cost.md)
- [calledTool 匹配：名称、输入、状态与次数](calledtool.md)
- [裁判评质量：规则写不出对错时](judge-quality.md)
- [Score Eval：检查项与质量 measurement](rubric-points.md)

## 通过制还是 Score Eval

`defineEval` 使用 Pass Eval。Boolean mismatch 的 gate 在 Assertion 封口后参与 Core `outcome`、sealed
Assertions 与显式 skip 的 Verdict 读侧折叠；其它 Assertion 继续结算。measurement 用 `.gate(n)` 才进入 failed。

`defineScoreEval` 使用 Score Eval。每条 Assertion 在 `niceeval.assertions` family 的 persistence revision `3` envelope 内封口 evaluation。
`.score(points)` 和 `t.score(points)` 才将 points 与 earned contribution 加入同一份 sealed facts。Score 从
这些 facts 与 rubric 在读侧形成 complete、partial 或 unavailable。正常没有 contribution 时，earned score
仍为 `0`；低分不会成为 `failed`。

| 用例 | 推荐形态 |
|---|---|
| 所有条件必须满足 | `defineEval` + Boolean condition |
| 部分完成仍可比较 | `defineScoreEval` + score contribution |
| 开放式质量作为通过条件 | Judge measurement + `.atLeast(n)` |
| 开放式质量贡献分数 | Judge measurement + `.score(points)` |

## API → 篇目对照

| API | 所在篇目 |
|---|---|
| `t.send` / `t.sendFile` / `t.reply` / `turn.message` / `turn.data` | [单轮](first-single-turn.md) |
| `turn.succeeded` / `turn.judge` / `t.newSession()` / `session.*` | [多轮与并行会话](multi-turn-sessions.md) |
| `calledTool` / `notCalledTool` / `toolOrder` / `event` | [过程与成本](process-and-cost.md) · [calledTool 匹配](calledtool.md) |
| `t.check(value, match)` / `.orStop()` / `niceeval/expect` matcher | [单轮](first-single-turn.md) · [沙箱](sandbox-coding.md) |
| `t.judge` / `turn.judge` / `autoevals.*` | [裁判评质量](judge-quality.md) |
| `.score(points)` / `t.score(points)` | [Score Eval](rubric-points.md) |
| 数组导出 / keyed record 导出 / `loadYaml` / `loadJson` | [测试集](dataset-fanout.md) |
| `t.sandbox.*` | [沙箱 coding 任务](sandbox-coding.md) |
