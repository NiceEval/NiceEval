---
format: niceeval.docs-node/v1
kind: feature
relations: {}
---

# Judge

Judge 是使用受管模型能力的 `ScoreMatch`。`defineJudge` 与五个现成裁判都走公开 `defineScoreMatch`；
自定义高级 Match 使用同一组模型原语。所有 Match 经 `t.check(value, match)` 的统一准备、登记、执行与封口路径。
`t.judge(value, match)` 是受管 LLM Match 的便利入口，root、Session 与 Turn 都要求显式材料。

现成裁判包含事实一致性、上下文忠实度、指令遵循、两答案比较和基于给定材料的问答。
自由评分、分类映射与分解后聚合共享模型调用能力，分数含义由各算法明确声明。

```ts
import { defineConfig, defineJudge } from "niceeval";
import { OpenAIProvider } from "niceeval/judge";

export default defineConfig({
  judgeRuntime: OpenAIProvider({ model: "judge-model" }),
});

const followsIntent = defineJudge({
  name: "follows-intent",
  rubric: "根据 intent 评价 post 是否保留明确要求，没有编造未给出的时间。",
  anchors: [
    { measurement: 0, description: "偏离意图或编造关键信息" },
    { measurement: 0.5, description: "保留主要意图，但遗漏部分明确要求" },
    { measurement: 1, description: "保留全部明确要求且没有编造" },
  ],
});
```

项目通过 `OpenAIProvider`、`VercelProvider`、`OpenRouterProvider` 或 `TypesafeProvider` 显式选择服务。
四个工厂都从 `niceeval/judge` 导出；Vercel 工厂表示 Vercel AI Gateway。
Eval 与 Experiment 可以只替换模型字符串，也可以整体替换 Provider，不按 hostname、模型前缀或进程变量猜服务。

TypeSafe System One 使用自己的 `/systemone` 协议。它支持 `score`、`classify` 和 `batchClassify`，但不支持 `extract`。
因此依赖 `extract` 的 `faithfulness()` 在 TypeSafe 上得到 `unavailable`，不会退化为另一种评分算法。

材料在登记 Assertion 时生成有界 canonical JSON 快照。Judge 产出有限 `[0,1]` measurement，并保留模型步骤及公开理由，
不自行决定 Verdict 或 score。通过制与计分制都用 `.gate(minimum)` 建立显式质量门；
计分制还可用 `.score(points)` 按 measurement 贡献分数，并在 gate 失败时保留 contribution。

| 目的 | 入口 |
|---|---|
| API、现成裁判、Provider、材料与失败 | [Library](library.md) |
| 统一执行、预算、协议映射与完整审计 | [Architecture](architecture.md) |
| 接上 Provider 并验证真实判分 | [配置并验证 Judge](use-case/verify-judge.md) |
| 用 Experiment 比较模型或 Provider | [裁判 A/B](use-case/experiment-ab.md) |
| Assertion、两种 Eval 与结果 | [Assertions](../assertions/README.md) |
| 配置变化怎样影响缓存 | [Experiments · Cache](../experiments/cache.md) |
