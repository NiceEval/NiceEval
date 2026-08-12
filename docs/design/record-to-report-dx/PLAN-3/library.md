# PLAN-3 Library

## Open 与 selection

```ts
const analysis = yield* openAnalysis({
  root,
  selection: explicitRuns({ runIds }),
});

const result = yield* executeQuery({ analysis, query });
```

`openAnalysis()` 在一个 Effect Scope 内打开 frozen Record 并完成 Run selection。返回值公开 semantic
model 与 pure scope summary，不公开低层 owner lookup。

```ts
interface AnalysisDatabase {
  readonly scope: AnalysisScope;
  readonly model: AnalysisModel;
}

interface AnalysisModel {
  readonly selectedRuns: BaseRelation<SelectedRunRow, BasePopulation>;
  readonly logicalSlots: BaseRelation<LogicalSlotRow, BasePopulation>;
  readonly includedAttempts: BaseRelation<IncludedAttemptRow, BasePopulation>;
  readonly originRuns: BaseRelation<OriginRunRow, BasePopulation>;
  gradingClaims(
    selection: GradingClaimSelection,
  ): BaseRelation<GradingClaimRow, BasePopulation>;
}
```

Report host 使用相同入口。脚本可以直接执行任何 Query，因此不需要导入 Page 或 Report 类型。

## Relations

内建 model 至少包含：

- `selectedRuns`：每个 selected Run 一行；
- `logicalSlots`：每个 `(selectedRunId, slotId)` 一行；
- `includedAttempts`：logical slot 到 exact Attempt 的 relation，保留 population edge；
- `originRuns`：Attempt 到 origin Run 的 relation；
- `gradingClaims`：显式 selected grading Run 到 subject Attempt/node 的 relation。

Base Relation 只描述 Analysis 已固定的 population 与 identity edges，不承载派生控制流：

```ts
interface BaseRelation<Row, Population> {
  query(): SemanticQuery<Row, Population>;
}

interface SemanticQuery<Row, Population> {
  join<Other>(edge: BaseRelation<Other, Population>): SemanticQuery<Joined<Row, Other>, Population>;
  select<Shape>(shape: Shape): SemanticQuery<SelectedRows<Shape>, Population>;
  where(predicate: Expression<Row, boolean>): SemanticQuery<Row, Population>;
  groupBy<Dimensions, Measures>(input: {
    readonly dimensions: Dimensions;
    readonly measures: Measures;
  }): SemanticQuery<GroupedRows<Dimensions, Measures>, Population>;
  orderBy(order: OrderExpression<Row>): SemanticQuery<Row, Population>;
  take(limit: number): SemanticQuery<Row, Population>;
  rebasePopulation(input: {
    readonly id: PopulationId;
    readonly reason: ExclusionReason;
  }): SemanticQuery<Row, Subpopulation<Population>>;
  map<Inputs, Output>(input: {
    readonly inputs: Inputs;
    readonly compute: (values: Values<Inputs>) => Output;
  }): SemanticQuery<Output, Population>;
}
```

调用 `query()` 后进入 managed Derivation 层。`where()` 与 `take()` 改变参与 rows，但不删除
`Population`。任何 aggregate 仍收到原 population、排除
reasons 与 coverage。只有显式 `rebasePopulation()` 才建立新 denominator；它返回具名 result 并要求作者
提供排除理由。新 population 保留 parent identity、排除理由、coverage 与 evidence，不能替换 Analysis
的 base population。

`Expression` 与 `OrderExpression` 是 package-created typed nodes，不是任意 callback。需要普通 TypeScript
时使用 `map({ inputs, compute })`；明确列出的 inputs 进入 managed dependency graph。Semantic Query 本身
就是可 materialize declaration，`executeQuery()` 是唯一执行入口。

## Fields 与 relations

Field 明确 owner 和 relation：

```ts
const energy = defineField({
  on: model.includedAttempts,
  attachment: energyFamily,
  project: ({ value }) => value.payload.kwh,
});
```

`project` 同步且只见当前 owner。Field result 保留 Attachment 六态。Run-owned fields 分别属于
`selectedRuns` 或 `originRuns` namespace，不存在含混的 `run.evaluation`。

Custom base relation 只能由 package 提供的 exact identity edges 组合。作者不能写任意 owner lookup
callback。Filter、join、grouping 与 ordering 都返回 semantic Query，不会把派生后的 rows 伪装成新的
Analysis facts。

## Dimensions 与 Measures

```ts
const passRate = defineMeasure({
  on: model.logicalSlots,
  value: fields.executionVerdict,
  appliesWhen: fields.selectedEvaluationKind.equals("pass"),
  perEval: "mean",
  acrossEvals: "mean",
  unit: "ratio",
  direction: "higher-is-better",
});
```

Measure 固定 value grain、两级 aggregation、missing policy、unit、direction 与 evidence projection。作者
不能通过少写一次 `groupBy` 得到 retry-weighted 假通过率。

官方入口分成 `measures.execution.*` 与 `measures.grading.*`：

```ts
const claims = model
  .gradingClaims(explicitGradingRuns({ runIds: gradingRunIds }))
  .query();
const quality = measures.grading.passRate({ claims });
```

Grading claim selection 不改变 Analysis base population，也不自动选 latest claim。

## Report consumers

简单 dashboard 可以直接消费 Query。复杂 Page 使用 query result callback：

```ts
page({
  route: "/",
  data: { rows: qualityByAgent },
  render: ({ data }) => qualityDocument(data.rows),
});
```

Query 只按 object identity 执行一次。PageFamily 的 query 在实例展开前完成；实例不能追加 query。
机器可读 Download 可以消费同一 query result，不重复公式。
