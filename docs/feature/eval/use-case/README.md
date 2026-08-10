# Eval 用例

本目录把 `defineEval` 与 `defineScoreEval` 的 API 组合成真实场景。基础契约只在 [Library](../library.md)、[Context](../library/context.md)、[Assertions](../../assertions/library.md) 和 [Sandbox](../../sandbox/library.md) 定义。

## 会话驱动

- [单轮：一问一答就断言](first-single-turn.md)
- [多轮与并行会话：每轮各自断，跨轮显式评](multi-turn-sessions.md)
- [HITL 审批：agent 停在人工输入上](hitl-approval.md)

## Fact 与评分

- [过程与成本：断 agent 怎么做到的](process-and-cost.md)
- [calledTool 匹配：名称、输入、状态与次数](calledtool.md)
- [裁判评质量：规则写不出对错时](judge-quality.md)
- [计分制：检查点和质量分都用 Fact](rubric-points.md)

## 规模与运行条件

- [测试集从输入数组生成多条 eval：一套逻辑跑一批 case](dataset-fanout.md)
- [本地测试文件：普通上传与动态身份](criteria-files.md)
- [沙箱 coding 任务：从放文件到评 diff](sandbox-coding.md)
- [Fixture 与反馈：prepare 与长步骤报告](fixtures-lifecycle.md)

## 通过制还是计分制

`defineEval` 通过 `t.assert` 与 `await t.require` 的 verdict use 折叠为四态 Verdict。
`defineScoreEval` 用 `t.score` 叠加得分，并在 `test` 正常返回时自动收尾；它的终态保留 `scored`、`invalid`、`unavailable`、`errored` 或 `skipped`。

| 用例 | 推荐形态 |
|---|---|
| 独立可跑的检查 | 拆成多个通过制 eval |
| 全部条件都必须满足 | `defineEval` + verdict use |
| 部分完成也有比较意义 | `defineScoreEval` + score use |
| 开放式质量 | Judge ScoreFact，再选择 verdict use、score use 或两者 |

每个 Fact 都先由 producer 创建，再由 `assert`、`require` 或 `score` 消费。没有链式 severity、可选消费或 `.points()`。

## API → 篇目对照

| API | 所在篇目 |
|---|---|
| `t.send` / `t.sendFile` / `t.reply` / `turn.message` / `turn.data` | [单轮](first-single-turn.md) |
| `turn.succeeded` / `turn.judge` / `t.newSession()` / `session.*` | [多轮与并行会话](multi-turn-sessions.md) |
| `parked` / `requireInputRequest` / `respond` / `respondAll` | [HITL 审批](hitl-approval.md) |
| `calledTool` / `notCalledTool` / `toolOrder` / `event` | [过程与成本](process-and-cost.md) · [calledTool 匹配](calledtool.md) |
| `t.check` / `t.assert` / `t.require` / `niceeval/expect` matcher | [单轮](first-single-turn.md) · [沙箱](sandbox-coding.md) |
| `t.judge` / `turn.judge` / `autoevals.*` | [裁判评质量](judge-quality.md) |
| `t.score` | [计分制](rubric-points.md) |
| 数组导出 / keyed record 导出 / `loadYaml` / `loadJson` | [测试集从输入数组生成多条 eval](dataset-fanout.md) |
| `t.sandbox.*` | [沙箱 coding 任务](sandbox-coding.md) |
| `sandbox` + `.prepare()` / `t.progress` / `t.diagnostic` / `t.skip` | [Fixture 与反馈](fixtures-lifecycle.md) |
