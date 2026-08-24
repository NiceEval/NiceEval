---
format: niceeval.docs-node/v1
kind: feature
relations: {}
---

# Judge

Judge 是异步 Assertion evaluator。它给出有限 `[0,1]` measurement、理由与 evidence；它不是 Match，
也不自行决定 Verdict 或 score。

Judge recipe 调用时直接登记一条 Assertion，并返回同一 entry 的 handle。

```ts
const quality = turn.judge.autoevals.closedQA("回答是否解释了风险？")
  .gate(0.8)
  .label("风险说明质量");
```

Pass Eval 必须为 Judge measurement 调用 `.gate(n)`。Score Eval 可直接 `.score(n)`，也可添加
`.atLeast(n)` 作为局部 condition。两种配置都只执行一次 Judge evaluator，写一条 AssertionResult。

| 目的 | 入口 |
|---|---|
| recipe、材料、配置与失败 | [Library](library.md) |
| Assertion、两种 Eval 与结果 | [Assertions](../assertions/README.md) |
| 配置变化怎样影响缓存 | [Experiments · Cache](../experiments/cache.md) |
