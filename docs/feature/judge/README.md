# Judge

Judge 是一个原生 `ScoreFact` producer。它用独立模型给文本材料打出 `[0,1]` 的归一化分数，但不自行决定 Attempt 的判定或得分。

每个 Eval 必须显式声明 `judge` capability。未声明 capability 时创建 Judge Fact 是同步 author error。

```ts
export default defineEval({
  judge: true,
  async test(t) {
    const turn = await t.send("解释这个变更。");
    const quality = turn.judge.autoevals.closedQA("回答是否解释了风险？");
    t.assert(quality, { atLeast: 0.8 });
  },
});
```

Judge Fact 在 `assert`、`require` 或计分 Eval 的 `score` 消费前不调用模型。每个 Fact 最多有一个 verdict use 和一个 score use，求值结果在这两个 use 之间复用。

## 从哪里开始

| 目的 | 入口 |
|---|---|
| 声明、材料、配置与调用预算 | [Library](library.md) |
| Fact/use、落盘与展示 | [Assertions](../assertions/README.md) |
| 配置变化怎样影响缓存 | [Experiments · Cache](../experiments/cache.md) |
| 没有模型或 key 时的公开结果 | [Eval E2E owner](../../engineering/testing/e2e/eval.md#eval-assertion-judge-unavailable) |
