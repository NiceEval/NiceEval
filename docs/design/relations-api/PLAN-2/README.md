# PLAN-2：host-validated typed relation builder

关系作者以公共 vocabulary 声明 projection inputs、typed anchor、edge 与 cardinality。host 核对 Sample token、
population alignment、exact owner 与 provenance，再统一产生穷尽 relation cells。

```ts
const attemptRelations = defineRelations({
  inputs: {
    agentEvents: input(agentEventsProjection),
    otel: input(otelProjection),
  },
  edges: ({ agentEvents, otel }) => ({
    sendOperations: edge(agentEvents.send, otel.operation, { cardinality: "many" }),
  }),
});

const attempts = yield* relate(
  attemptRelations,
  { agentEvents, otel },
);
```

公共声明只表达结构：

```ts
interface RelationEdge<From, To, Cardinality> {
  readonly from: ProjectionField<From>;
  readonly to: ProjectionField<To>;
  readonly anchor: DurableAnchorDefinition<From, To>;
  readonly cardinality: Cardinality;
}

declare function defineRelations<Inputs, Edges>(input: {
  readonly inputs: ProjectionInputDeclarations<Inputs>;
  readonly edges: (inputs: ProjectionFieldDeclarations<Inputs>) => Edges;
}): RelationDefinition<Inputs, Edges>;

declare function relate<Inputs, Edges>(
  definition: RelationDefinition<Inputs, Edges>,
  projections: Inputs,
): Effect.Effect<
  ExhaustiveRelationValue<RelationCells<Edges>>,
  RelationDefinitionError | RelationInputError
>;

type RelationDefinitionError =
  | UnknownRelationFieldError
  | OwnerMismatchError
  | AnchorVersionMismatchError
  | InvalidCardinalityError;

type RelationInputError = DifferentSampleError | PopulationAlignmentError;
```

`relate` 是只消费 closed projections 的 relation capability，不携带 reader 或 live Sample handle。它返回
closed `ExhaustiveRelationValue`。共同 shape 由 [Limits](../LIMITS.md) 定义。每个 included cell 穷尽表达 matched、unmatched、
ambiguous 或输入 package state，并保留 input provenance；非 included slot 原样传递 Sample state。

builder 只表达结构关系，不含 where、grouping、Measure 或 reconciliation。host 可以统一报告 unmatched、
ambiguous、dangling 与输入错配，但公共 vocabulary 会限制领域可表达性，并增加 token 与 schema 设计成本。

官方扩展面若选择本候选，就不能再把任意 pure assembler 作为同级、同保证的 relation API；后者只能作为
builder 内部实现或普通 Derivation，避免绕过 host validation。

## 生命周期与失败

definition 在 I/O 外构建并可跨 execution 复用。execution 只消费 closed projections，先验证 Sample token、
population、field type 与 anchor version，再按 slot 建关系；结果不保留 builder 或 live capability。

unknown field、owner mismatch、anchor kind/version mismatch 与不同 Sample 是 typed definition/input error。
cardinality 的零个或多个目标形成 unmatched/ambiguous data，不是 Effect failure。builder implementation defect
保持 Cause，不污染 package validity。

## Cases

- R1：`many` 接受多个 spans；`one` 才把多个 targets 表达为 ambiguous。
- R2：没有 durable anchor 时只产生 unmatched，不运行时间或文本 heuristic。
- R3：任何 edge 执行前拒绝来自不同 Sample handles 的 projections。

## Limits 与扩展

host 限制 inputs、edges、logical cells 与每个 edge 的 targets。第三方只能用公共 field、anchor 和
cardinality vocabulary 扩展；自定义执行 callback 不能绕过结构验证。
