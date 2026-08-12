# PLAN-3：Typed semantic relations

Record 被暴露成一套 typed semantic relations。作者使用 fields、relations、dimensions 与 measures
声明需要的数据；同一 query 可以交给 Table、Chart、PageFamily、Download 或脚本执行器。

```ts
const attempts = model.logicalSlots
  .query()
  .join(model.includedAttempts)
  .join(model.originRuns)
  .select({
    selectedEvaluation: fields.selectedRun.evaluation,
    assertions: fields.attempt.assertions,
    verdict: fields.attempt.verdict,
    score: fields.attempt.score.allowUnavailable(),
    originEvaluation: fields.originRun.evaluation,
  });

const qualityByAgent = attempts.groupBy({
  dimensions: { agent: dimensions.agent },
  measures: {
    passRate: measures.execution.passRate,
    cost: measures.execution.costUSD,
  },
});

export default defineReport({
  id: "quality-report",
  pages: {
    overview: dashboard({
      route: "/",
      data: qualityByAgent,
      views: [
        scatter({ x: "cost", y: "passRate", point: "agent" }),
        table(),
      ],
    }),
  },
});
```

## 核心心智

这套候选接近 typed relational API 与 semantic layer。Analysis 的 base Relation 拥有 population、grain
与 lineage，Field 读取 facts。Relation 一旦进入 filter、join 或 grouping 就形成 managed semantic Query。
Dimension 分组；Measure 定义 aggregation grain、coverage、unit 与 evidence。

作者获得比 PLAN-1 更通用的查询语言。Filter、join、groupBy、orderBy 与 top-N 都是 public operations，
但 query engine 必须持续保存原 population，防止过滤后把缺失行从 denominator 中抹掉。

## 范围

包含 public AnalysisModel、base Relation、Field、Dimension、Measure、semantic Query 与通用 query executor。Report
consumer 只消费 Query 或 materialized semantic rows。

不包含 raw SQL、字符串字段名 lookup、浏览器查询、组件 I/O 或任意 reader callback。

## Cases

本候选的可核查状态见 [Evaluation](../EVALUATION.md)。C3 的两级聚合由 Measure 固定；C4b 由 semantic
Query identity 与 planner failure boundary 实现；C10 要求脚本学习 semantic executor。C11 的 planner
能避免未请求 Attachments，但不能选择性读取一份已请求 Attachment 的 blob chunks。其它 Cases 尚未逐一展开。

## 入口

- [Library](library.md)：semantic objects 与查询语法。
- [Architecture](architecture.md)：logical plan、coverage 与 execution。
- [Attempt detail](use-case/attempt-details.md)：relation selection 与 dynamic pages。
