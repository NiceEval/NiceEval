---
format: niceeval.docs-node/v1
kind: feature
relations: {}
---

# Judge

Judge 是一种受管、异步的特殊 evaluator。普通 `ScoreMatch` 保持纯函数；只有 NiceEval 创建的
`JudgeDefinition` 可以使用模型 I/O。作者用 `defineJudge` 声明一个连续质量量尺，再把应用原生值作为命名
JSON 材料传给 `t.judge(value, definition)`。root、Session 与 Turn 都提供这一显式材料入口；`t.check(value, definition)` 仍进入同一个登记 dispatcher。

```ts
const followsIntent = defineJudge({
  name: "follows-intent",
  rubric: "根据 intent 评价 post 是否保留明确要求，没有编造未给出的时间。",
  anchors: [
    { measurement: 0, description: "偏离意图或编造关键信息" },
    { measurement: 0.5, description: "保留主要意图，但遗漏部分明确要求" },
    { measurement: 1, description: "保留全部明确要求且没有编造" },
  ],
});

export default x.defineScoreEval({
  judge: followsIntent,
  async test(t) {
    const intent = "邀请大家今晚在河边入口集合，不指定时间";
    const post = await t.post({ intent });
    t.judge({ intent, post }, followsIntent).score(25).label("发帖遵循意图");
  },
});
```

材料在登记 Assertion 时生成有界 canonical JSON 快照。Judge 只产出有限 `[0,1]` measurement 与公开
rationale，不自行决定 Verdict 或 score。Pass 与 Score 都用 `.gate(minimum)` 建立显式质量门；
Score Eval 还可用 `.score(points)` 按 measurement 贡献分数，并在 gate 失败时保留 contribution。

| 目的 | 入口 |
|---|---|
| API、定义、材料、配置与失败 | [Library](library.md) |
| Assertion、两种 Eval 与结果 | [Assertions](../assertions/README.md) |
| 配置变化怎样影响缓存 | [Experiments · Cache](../experiments/cache.md) |
