# Assertions —— 计分

`defineEval` 是通过制。它的正常路径需要至少一个 verdict use，最终结果是 `passed`、`failed`、`errored` 或 `skipped`。

`defineScoreEval` 用 `t.score` 累加题内得分，并在正常路径返回 `t.finishScore()`：

```ts
export default defineScoreEval({
  judge: true,
  async test(t) {
    const turn = await t.send("总结需求。");
    const quality = turn.judge.autoevals.summarizes("原始需求");

    t.assert(quality, { atLeast: 0.7, label: "最低质量" });
    t.score("摘要质量", quality, { max: 20 });
    t.score("格式", { earned: 2 });
    return t.finishScore();
  },
});
```

一个 ScoreFact 可以同时有一个 verdict use 和一个 score use。它只求值一次。Boolean Fact 也可用于 score：通过获得 `max`，失败获得 0。

score Attempt 的 terminal：

| 条件 | terminal | `creditedScore` |
|---|---|---|
| 所有 Fact/use 可用 | `scored` | `earnedScore` |
| 任一 verdict use failed | `invalid` | 0 |
| 被消费 Fact unavailable | `unavailable` | `null` |
| evaluator 或执行 error | `errored` | `null` |
| 显式 skip | `skipped` | `null` |

`earnedScore` 是诊断值。`totalScore` 只聚合非 null `creditedScore`；invalid 的 0 进入分子和分母，unavailable、errored 与 skipped 不伪装为零分。

没有 `points` 链式 API、隐式满分、软观察分或运行期 strict 开关。作者把每个 consumer 的阈值、上限和分值直接写在 `assert` 与 `score` 调用处。
