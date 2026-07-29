# MeasureCell / Dataset Measure 协议收口

## 现象

公开作者模型已是 Calculation / MetricValue，但内部仍双轨：
`MeasureCell` 别名、`DatasetField.kind: "measure"`、`Cell.kind: "measure"`，
以及渲染面读预生成 `display`。

## 裁决

2026-07-29：清尽 MeasureCell 双轨。

- 读数格统一为 `MetricValue`（无预生成 `display`；renderer 按 `unit` / `format` 格式化）。
- `DatasetField.kind` 与 `Cell.kind` 改为 `"metric"`。
- `MeasureColumn` → `MetricColumn`；公开 react 面不再导出 `MeasureCell` / `MeasureColumn`。
- 旧 `Measure` 接口改名为内部 `AttemptMetric`（show 切片 / `metrics.ts` /
  `computeCell` 仍用）；公开官方读数是 `Calculation`。
- `Measure.display` 覆盖映射为 `MetricValue.format: { kind: "custom" }`。

## 日期

2026-07-29
