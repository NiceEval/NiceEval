---
format: niceeval.docs-node/v1
kind: feature
relations: {}
---

# Judge

Judge 是异步 managed `ScoreMatch<JudgeMaterial>` evaluator。它给出有限 `[0,1]` measurement、理由与 evidence；
它不拥有登记特权，也不自行决定 Verdict 或 score。

`niceeval/expect` 导出的 `closedQA`、`factuality` 与 `summarizes` 都是纯 Match factory。factory 不读取 ctx、
不绑定 subject、不登记；作者显式提供公开 `JudgeMaterial = { input, output }`，唯一中立 primitive
`check(subject, match)` 才登记一次 Assertion。

```ts
const quality = turn.check(
  { input: turn.input, output: turn.message },
  closedQA("回答是否解释了风险？").atLeast(0.8),
)
  .gate()
  .label("风险说明质量");
```

`ScoreMatch.atLeast(n)` 在登记前返回 `ThresholdedScoreMatch`，是唯一 threshold 入口。Pass Eval 对 thresholded
measurement 调用无参 `.gate()` 才把局部 condition 纳入 Verdict。Score Eval 对未 threshold 或已 threshold
Match 都可 `.score(n)`。这些配置都只执行一次 Judge evaluator，并写既有 `judge-measurement/v1` artifact。

| 目的 | 入口 |
|---|---|
| recipe、材料、配置与失败 | [Library](library.md) |
| Assertion、两种 Eval 与结果 | [Assertions](../assertions/README.md) |
| 配置变化怎样影响缓存 | [Experiments · Cache](../experiments/cache.md) |
