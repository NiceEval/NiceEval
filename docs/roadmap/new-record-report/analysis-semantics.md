# ② Analysis 语义层

```text
┌────────────────────────────────────┐
│ Analysis Semantics = 统计口径合同  │
└────────────────────────────────────┘
```

## 心智模型

Analysis 语义层回答“这些事实应当怎样计算和比较”。它定义名义总体、维度、指标、关系和归并规则，是官方数值与自定义 Report 共用的唯一统计口径。

Analysis 不是对数组执行任意 TypeScript，也不是一条 SQL。作者声明有稳定 identity 的字段和关系，平台把一次查询编译成有限 `QueryPlan`。

## 解决的问题

- 明确每个字段属于哪个 nominal population。
- 把多次 Attempt 归并为 logical slot，再跨 slot 聚合。
- 区分合法零值、missing、partial、unsupported 与 failed。
- 保留 observed、denominator、issues 与 Evidence refs。
- 检查 producer compatibility。
- 通过具名 relation 连接不同 population，拒绝 heuristic join。

## 核心对象

```text
Population
   ├─ Dimension
   ├─ Measure
   └─ AnalysisRelation → 另一个 Population
```

Analysis 作者从 `niceeval/analysis` 定义这些对象：

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

## Measure 合同

Measure 必须声明完整的归并与缺测口径：

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

每一段 reduction 都保留 state、observed、denominator、issues 与 refs。中间步骤只剩 scalar 时，后续步骤不能重新制造 `MetricValue`。

## Relation 合同

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

Report 内使用同一语义的 `aggregate()`：

```ts
const rows = await aggregate(sample, {
  by: { model, task },
  values: { passRate, latency },
});
```

两者绑定调用时的 frozen Sample，并编译同一种 field DAG。Report 不能通过 `.filter()`、raw predicate 或 arbitrary join 建立另一个总体。

## 编译输出

语义层向执行层提供 engine-neutral plan：

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

## 禁止跨出的边界

- 不读取旧 Record schema；旧版本必须先由 Record migration 升级。
- 不选择 TypeScript、DuckDB 或其它执行引擎。
- 不返回未包装的 scalar 作为官方 Measure result。
- 不生成 Table、Chart、Page 或 route。
- 不把显示排序、limit、颜色或 locale 纳入 row identity。
