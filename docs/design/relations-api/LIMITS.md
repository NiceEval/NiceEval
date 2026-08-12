# Limits

- Relations 不能接触 Record、reader、migration、Projection declaration 或 package bytes。
- 不按时间邻近、文本相等、provider ID 或数组位置猜测 join。
- 不执行 where、grouping、Measure、aggregation、reconciliation 或页面路由。
- 输出必须对 Sample population 穷尽；少返回 rows 不能缩小 denominator。
- 只改变 builder 方法名或包装对象的 facade 不构成独立候选。

两个 PLAN 共同返回同一个 closed ordinary value：

```ts
interface ExhaustiveRelationValue<Cell> {
  readonly sample: AnalysisSample;
  readonly cells: readonly RelationCell<Cell>[];
  readonly inputs: readonly ProjectionProvenance[];
  readonly coverage: RelationCoverage;
}

type RelationInputError = DifferentSampleError | PopulationAlignmentError;
type RelationOutputError = MissingCellError | DuplicateCellError | UnknownSlotError;
```
