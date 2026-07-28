// 指标视图:compute 函数供 sources 与测试内部使用;呈现走 Table / Chart 原语。

export {
  deltaTableData,
  measureRowsData,
  metricLineData,
  metricMatrixData,
  metricScatterData,
  metricTableData,
  scoreboardData,
  stabilityMatrixData,
  type DeltaTableOptions,
  type MetricLineOptions,
  type MetricMatrixOptions,
  type MetricScatterOptions,
  type MetricTableOptions,
  type MeasureRowsOptions,
  type ScoreboardOptions,
  type StabilityMatrixOptions,
} from "./compute.ts";

export {
  validateDeltaData,
  validateLineData,
  validateMatrixData,
  validateScatterData,
  validateScoreboardData,
  validateStabilityMatrixData,
  validateTableData,
} from "./validate.ts";
