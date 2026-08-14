# ② Analysis 层

```text
┌────────────────────────────────────┐
│ Analysis = 事实解释合同            │
│ 定义怎样算，内部完成计算，输出闭合值│
└────────────────────────────────────┘
```

## 心智模型

Analysis 回答“这些事实应当怎样计算、比较和诊断”。它定义名义总体、维度、指标、关系、归并与 Evidence 口径，并向 Report 提供闭合结果。

Analysis 内部包含语义合同、执行机制和输出合同。这三部分需要清楚的代码边界，但共同组成一个产品层。

```text
┌──────────────────────────────────────────────┐
│ Analysis                                    │
│                                             │
│  typed fields                               │
│      ↓                                      │
│  semantic query                             │
│      ↓                                      │
│  QueryPlan → internal executor              │
│      ↓                                      │
│  SemanticFrame / DomainView                 │
└──────────────────────────────────────────────┘
```

## 解决的问题

- 明确每个 field 属于哪个 nominal population。
- 把多次 Attempt 归并为 logical slot，再跨 slot 聚合。
- 区分合法零值、missing、partial、unsupported 与 failed。
- 保留 observed、denominator、issues 与 Evidence refs。
- 检查 producer compatibility。
- 通过具名 relation 连接不同 population。
- 为 Table、Chart 和诊断组件形成闭合输入。

## 输入边界

Analysis 只接收当前版本的 frozen Record snapshot。旧 Record 必须先由 `niceeval migrate` 升级，历史 schema 不会成为 Analysis 类型联合。

```text
Current sealed Record
        ↓
Frozen Sample
        ↓
Analysis
```

Analysis 不取得 write session、migration authority、Record root 或文件路径。

## Population、Dimension 与 Measure

Analysis 作者从 `niceeval/analysis` 定义有稳定 identity 的 fields：

```ts
declare function definePopulation<Member>(options: {
  readonly id: string;
}): Population<Member>;

declare function defineDimension<Member, Value>(options: {
  readonly id: string;
  readonly population: Population<Member>;
  readonly value: (member: Member) => Value;
}): Dimension<Member, Value>;

declare function defineMeasure<Member, Value>(
  options: MeasureOptions<Member, Value>,
): Measure<Member, Value>;

declare function defineAnalysisRelation<From, To>(
  options: AnalysisRelationOptions<From, To>,
): AnalysisRelation<From, To>;
```

Measure 必须一次声明完整口径：

```ts
const passRate = defineMeasure({
  id: "pass-rate",
  population: logicalSlots,
  value: passed,
  withinAttempt: latestCompletedAttempt(),
  withinSlot: oneResultPerSlot(),
  acrossSlots: ratio(),
  denominator: allLogicalSlots(),
  missing: partial(),
  unit: "ratio",
  format: "percent",
  better: "higher",
});
```

每段 reduction 都保留 state、observed、denominator、issues 与 refs。中间步骤只剩 scalar 时，后续步骤不能重新制造 `MetricValue`。

## Relation

跨 population 查询必须通过具名 relation：

```ts
const attemptToRun = defineAnalysisRelation({
  id: "attempt-to-run",
  from: attempts,
  to: runs,
  cardinality: "many-to-one",
  match: attempt => attempt.runRef,
});
```

Report 不能写 join，也不能按 label、数组位置、时间接近或浮点容差猜测成员关系。

## Query API

独立分析使用 `analyze()`：

```ts
const rows = await analyze(sample, {
  by: { model, task },
  values: { passRate, latency },
});
```

Report 内的 `aggregate()` 使用同一种 field graph 和 executor：

```ts
const rows = await aggregate(sample, {
  by: { model, task },
  values: { passRate, latency },
});
```

两者绑定调用时的 frozen Sample。Report 不能通过 `.filter()`、raw predicate 或 arbitrary join 建立另一个总体。

## 内部执行

typed query 被编译成 engine-neutral plan：

```ts
interface QueryPlan {
  readonly sample: FrozenSampleIdentity;
  readonly population: PopulationIdentity;
  readonly dimensions: readonly DimensionPlan[];
  readonly measures: readonly MeasurePlan[];
  readonly relations: readonly RelationPlan[];
  readonly reductions: readonly ReductionPlan[];
  readonly evidence: EvidencePlan;
}
```

`QueryPlan` 不包含 SQL 字符串、组件 props 或 renderer 配置。

内部 executor SPI：

```ts
interface AnalysisExecutor {
  readonly id: AnalysisExecutorIdentity;
  readonly version: AnalysisExecutorVersion;

  execute(
    plan: QueryPlan,
    input: CurrentRecordSnapshot,
  ): Promise<SemanticFrame>;
}
```

`AnalysisExecutor` 是 host capability，不从 `niceeval/analysis` 或 `niceeval/report` 导出。

TypeScript executor 是语义参考实现。它支持所有合法 plan，也是未来 backend 差分验收的 oracle。

DuckDB 只能作为 `QueryPlan` 之后的可选内部 backend：

```text
QueryPlan
   ├─ TypeScript executor
   └─ DuckDB executor
```

DuckDB 不能查询 Record 物理表，也不能定义 population、denominator、missing 或 retry。它的完整结果必须与 TypeScript backend 语义相等。

## SemanticFrame

`SemanticFrame` 是 Analysis 给中立组件的闭合表格结果：

```ts
interface SemanticFrame<Fields extends FrameFields = FrameFields> {
  readonly sample: FrozenSampleIdentity;
  readonly population: PopulationIdentity;
  readonly fields: Fields;
  readonly rows: readonly SemanticRow<Fields>[];
  readonly problems: readonly AnalysisIssue[];
}
```

每一行包含完整 grouping coordinate 和稳定 row key：

```ts
interface SemanticRow<Fields extends FrameFields> {
  readonly key: SemanticRowKey;
  readonly dimensions: DimensionValues<Fields>;
  readonly measures: MeasureValues<Fields>;
}
```

每一个 Measure cell 是完整结果：

```ts
interface MetricValue<Value> {
  readonly value: Value | null;
  readonly state: "available" | "partial" | "empty" | "unavailable" | "failed";
  readonly observed: number;
  readonly denominator: number;
  readonly issues: readonly AnalysisIssue[];
  readonly refs: readonly EvidenceRef[];
  readonly unit?: string;
  readonly format?: MeasureFormat;
  readonly better?: "higher" | "lower" | "neutral";
  readonly producerCompatibility: ProducerCompatibility;
}
```

中立组件通过 typed field identity 选择字段，不能依赖作者维护平行数组的位置关系。

## DomainView

`DomainView` 是 Analysis 给诊断组件的闭合领域结果。它保留树、时序、身份、问题和 Evidence，不为了通用图表而压平。

```ts
type DomainView =
  | TraceView
  | AttemptTimelineView
  | EvidenceView;
```

```ts
interface TraceView {
  readonly type: "trace";
  readonly identity: TraceIdentity;
  readonly root: TraceSpanView;
  readonly problems: readonly TraceProblem[];
  readonly refs: readonly EvidenceRef[];
}
```

```ts
interface AttemptTimelineView {
  readonly type: "attempt-timeline";
  readonly identity: AttemptIdentity;
  readonly events: readonly TimelineEventView[];
  readonly completion: AttemptCompletionView;
  readonly problems: readonly AttemptProblem[];
  readonly refs: readonly EvidenceRef[];
}
```

领域投影是平台与官方领域 package 的内部 capability：

```ts
interface DomainProjection<Target, View extends DomainView> {
  readonly id: DomainProjectionIdentity;
  project(
    sample: FrozenSample,
    target: Target,
  ): Promise<View>;
}
```

Report 作者把 opaque identity 或 exact ref 交给官方组件。Report host 在闭合语义树前调用对应 projection，renderer 不取得该 capability。

已完成 Experiment 的 expected population、completed、failed、missing 与比较结果进入 `SemanticFrame`。Experiment 不因为拥有官方页面而成为 `DomainView`。

## 探索性 SQL

探索性 SQL 与官方 Analysis 是不同产品路径：

```text
versioned logical catalog → SQL → ExploratoryRows
```

`ExploratoryRows` 必须与 `SemanticFrame` 和 `MetricValue` 类型不兼容。它可以帮助调查 ad-hoc join、window 或 pivot，但不能直接进入官方 Metric、Comparison 或可复核 Report。

有长期价值的探索查询需要提升为具名 Population、Dimension、Measure 或 Relation，之后才能进入官方路径。

## 禁止跨出的边界

- 不读取旧 Record schema；旧版本必须先执行 Record migration。
- 不把 SQL、TypeScript 或 DuckDB backend 变成作者语义。
- 不返回未包装的 scalar 作为官方 Measure result。
- 不生成 Table、Chart、Page 或 route。
- 不把显示排序、limit、颜色或 locale 纳入 row identity。
- 不把执行 cache 或闭合结果保存成新的权威 Record schema。
