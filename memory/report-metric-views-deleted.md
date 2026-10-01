---
format: concord.document/v1
id: report-metric-views-deleted
title: metric-views 目录删除
createdAt: 2026-07-29T15:56:20+08:00
createdAtSource:
  kind: first-recorded
  path: memory/report-metric-views-deleted.md
  commit: 8c7c88454f4e2622e7a8eb7a8c74f8797f3155c8
kind: memory
memoryKind: problem
state: captured
epoch: 0
evidenceRequirement: concord.native-reliability/v1
promotions: []
history: []
---
# metric-views 目录删除

## 现象

公开作者模型已是「普通值 → 组件」，但 `src/report/components/metric-views/**`
仍整目录保留 `defineMeasure` / `*Data` / 专用组件入口，与收口目标冲突。

## 裁决

2026-07-29：推翻「内部暂留」([report-metric-views-internal-retained](report-metric-views-internal-retained.md))。

- 删除 `metric-views/**` 与 `defineMeasure` 符号。
- `chart-math` / `plot` 迁到 `src/report/model/chart/`（Chart text 面依赖）。
- show `--stats` / 对照切片仍需的 `deltaTableData` / `stabilityMatrixData`
  迁到 `src/report/slices/`（无专用 UI 组件目录）。
- 内部 Measure 字面量与 MeasureCell 仍服务 aggregate / Dataset Chart 内核 /
  entity-lists；公开面只导出 Calculation / `to*` / plain props。

## 日期

2026-07-29
