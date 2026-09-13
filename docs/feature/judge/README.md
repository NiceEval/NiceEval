---
format: niceeval.docs-node/v1
kind: feature
relations: {}
---

# Judge

Judge 是一种受管、异步的特殊 Match。普通 `CustomScoreMatch` 保持纯函数；只有 NiceEval 创建的
`JudgeDefinition` 可以使用模型 I/O。作者用 `defineJudge` 声明一个连续质量量尺，再把应用原生值作为命名
JSON 材料传给 `t.check(value, definition)`。

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
    t.check({ intent, post }, followsIntent).score(25).label("发帖遵循意图");
  },
});
```

材料在登记 Assertion 时生成有界 canonical JSON 快照。Judge 只产出有限 `[0,1]` measurement 与公开
rationale，不自行决定 Verdict 或 score。Pass Eval 使用 `definition.atLeast(threshold)` 配合 `.gate()`；
Score Eval 直接用 `.score(points)` 按 measurement 贡献分数。

| 目的 | 入口 |
|---|---|
| API、定义、材料、配置与失败 | [Library](library.md) |
| Assertion、两种 Eval 与结果 | [Assertions](../assertions/README.md) |
| 配置变化怎样影响缓存 | [Experiments · Cache](../experiments/cache.md) |
