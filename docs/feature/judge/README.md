---
format: niceeval.docs-node/v1
kind: feature
relations: {}
---

# Judge

Judge 是使用受管 LLM 能力的 `ScoreMatch`。`defineJudge` 和现成裁判都通过公开 `defineScoreMatch` 构造；
自定义高级 Match 使用同一组模型原语。所有 Match 经 `t.check(value, match)` 的统一准备、登记、执行与封口路径。
`t.judge(value, match)` 是受管 LLM Match 的便利入口，root、Session 与 Turn 都要求显式材料。

现成裁判提供事实一致性、上下文忠实度、指令遵循和两答案比较。
自由评分、分类映射与分解后聚合共享模型调用能力，分数含义由各算法明确声明。

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

材料在登记 Assertion 时生成有界 canonical JSON 快照。Judge 产出有限 `[0,1]` measurement，并保留模型步骤及其公开理由，不自行决定 Verdict 或 score。Pass 与 Score 都用 `.gate(minimum)` 建立显式质量门；
Score Eval 还可用 `.score(points)` 按 measurement 贡献分数，并在 gate 失败时保留 contribution。

| 目的 | 入口 |
|---|---|
| API、定义、材料、配置与失败 | [Library](library.md) |
| 统一执行、预算与完整审计 | [Architecture](architecture.md) |
| Assertion、两种 Eval 与结果 | [Assertions](../assertions/README.md) |
| 配置变化怎样影响缓存 | [Experiments · Cache](../experiments/cache.md) |
