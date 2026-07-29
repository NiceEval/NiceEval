# metric-views 内部路径暂留（已翻案）

> **已翻案（2026-07-29）**：见 [report-metric-views-deleted](report-metric-views-deleted.md)。

## 原裁决（废止）

`metric-views`（`defineMeasure` / MeasureCell / `*Data` / Dataset 投影）**不从
`niceeval/report` 公开导出**，但**暂不删除实现**：`show --stats` /
多 `--exp` 对照切片仍动态 import `deltaTableData` / `stabilityMatrixData`，
`StabilityOverview` 仍调用 `stabilityMatrixData`。

## 曾选方案

一次删掉 `src/report/components/metric-views/**` 与 `model/metrics.ts` /
`model/aggregate.ts`，把 show 切片改写成 `aggregate()` + `Table`/`Bars`。

## 否决理由（当时）

show 对照矩阵与稳定性矩阵的单元格形状尚未有等价公开 Calculation；强删会让
CLI 切片与大量测试同时红。

## 后续路径（已部分执行）

1. 公开 `toDeltaRows` / `toStabilityRows`（或等价 Calculation 组合）——未做。
2. show / StabilityOverview 改走公开转换——未做；仍用 `src/report/slices/`。
3. 已删 `metric-views` 目录与 `defineMeasure`；切片与 chart 数学迁出。
