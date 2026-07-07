// niceeval/report/react 的数据契约(组件 props 类型)。
//
// 契约的家在计算层(../types.ts,照 docs/reports.md「计算函数与数据契约」),这里 re-export,
// 「算」与「画」两侧共用同一份类型;本文件零运行时代码——组件不做任何聚合或数据操作。

export type {
  AttemptRef,
  MetricColumn,
  MetricCell,
  TableData,
  MatrixData,
  ScoreboardData,
  ScatterData,
  OverviewData,
  DeltaData,
  CaseListData,
} from "../types.ts";
