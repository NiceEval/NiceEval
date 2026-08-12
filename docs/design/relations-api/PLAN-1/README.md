# PLAN-1：package-owned pure assembler

关系作者接收若干 closed projections，以普通纯函数返回穷尽 relation cells。anchor 查找、cardinality 与错误
分类属于该 assembler 的实现；host 只验证输入属于同一 Sample，并验证输出包含完整 population。

```ts
const attempts = yield* executeRelationAssembler({
  definition: attemptFactsAssembler,
  projections: { otel, commands, assertions, verdict },
});
```

公开扩展面是普通函数类型：

```ts
type RelationAssembler<Inputs, Cell> = (
  inputs: SameSample<Inputs>,
) => ExhaustiveRelationValue<Cell>;

declare function defineRelationAssembler<Inputs, Cell>(input: {
  readonly inputs: ProjectionShape<Inputs>;
  readonly assemble: RelationAssembler<Inputs, Cell>;
}): RelationAssemblerDefinition<Inputs, Cell>;

declare function executeRelationAssembler<Inputs, Cell>(input: {
  readonly definition: RelationAssemblerDefinition<Inputs, Cell>;
  readonly projections: Inputs;
}): Effect.Effect<
  ExhaustiveRelationValue<Cell>,
  RelationInputError | RelationOutputError
>;
```

`SameSample` 只由 `executeRelationAssembler` 在核对 input identities 后创建。assembler 不能构造另一份
denominator。

共同 output shape 与错误联合见 [Limits](../LIMITS.md)，本 PLAN 不另造较弱结果。

host 不理解 edge graph，也不能为任意第三方 assembler 提供 dangling、duplicate 或 cardinality 的统一结构
诊断。共享算法通过普通函数和库复用，领域 owner 对 relation 语义保持完整控制。

若同时承诺 host 对 edge/cardinality 做通用验证，这个候选就已经变成 PLAN-2；两项不是基础层与语法糖。

## 生命周期与失败

definition 是纯值，可跨 execution 复用。调用消费 closed projections，不要求 reader 或 live Sample handle，
结果也是 closed value。

不同 Sample、population shape 错配与少返回 cell 是 host typed input/output error。unmatched、ambiguous 与
package read state 是成功数据。assembler throw 是 defect；host 不把它改名为 dangling relation。

## Cases

- R1：assembler 自己实现 `many`，返回同一 send 的全部 spans。
- R2：缺少 durable anchor 时输出 unmatched，并保留 operation local fact。
- R3：host 在调用 assembler 前拒绝不同 Sample inputs。

## Limits 与扩展

host 限制 input projections、logical cells 与每个 cell 的关系项数量，但不解释领域 edge。第三方通过
`defineRelationAssembler` 扩展，并负责自己的 anchor、cardinality 与 deterministic output。
