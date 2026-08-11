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

`defineEval` 使用 Pass Eval。Boolean mismatch 使最终 Verdict failed，但其它 Assertion 继续结算。
measurement 必须设 `.atLeast(n)`。

`defineScoreEval` 使用 Score Eval。每条 Assertion 默认只保存 evaluation；`.score(n)` 和 `t.score(n)` 才贡献
score。它没有 Verdict、总分或百分比。正常没有贡献项时，score 仍为 `0`。

| 用例 | 推荐形态 |
|---|---|
| 所有条件必须满足 | `defineEval` + Boolean condition |
| 部分完成仍可比较 | `defineScoreEval` + score contribution |
| 开放式质量作为通过条件 | Judge measurement + `.atLeast(n)` |
| 开放式质量贡献分数 | Judge measurement + `.score(n)` |

## API → 篇目对照

| API | 所在篇目 |
|---|---|
| `t.send` / `t.sendFile` / `t.reply` / `turn.message` / `turn.data` | [单轮](first-single-turn.md) |
| `turn.succeeded` / `turn.judge` / `t.newSession()` / `session.*` | [多轮与并行会话](multi-turn-sessions.md) |
| `calledTool` / `notCalledTool` / `toolOrder` / `event` | [过程与成本](process-and-cost.md) · [calledTool 匹配](calledtool.md) |
| `t.check(value, match)` / `.orStop()` / `niceeval/expect` matcher | [单轮](first-single-turn.md) · [沙箱](sandbox-coding.md) |
| `t.judge` / `turn.judge` / `autoevals.*` | [裁判评质量](judge-quality.md) |
| `.score(n)` / `t.score(n)` | [Score Eval](rubric-points.md) |
| 数组导出 / keyed record 导出 / `loadYaml` / `loadJson` | [测试集](dataset-fanout.md) |
| `t.sandbox.*` | [沙箱 coding 任务](sandbox-coding.md) |
