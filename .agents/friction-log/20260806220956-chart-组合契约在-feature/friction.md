---
title: 'Chart 组合契约在 Feature 文档与公开 API 中不一致'
severity: 'major'
---

## Expected Behavior

Feature 文档里的组合图 JSX、公开 TypeScript 类型与运行时应描述同一套 `Chart` / `Series` 输入。

## Current Behavior

`docs/feature/reports/library.md` 承诺 `Chart points` 作为默认 rows，并允许每个 series 自带 `points` 与 `external`。当前公开实现则要求 `Chart data={Dataset}`，而 `Series.points` 是 identity field 字符串；`Series` 也没有逐 series 的 `external` rows。`docs/feature/reports/components/charts/README.md` 还示例了未导出的 `ComposedChart`。

## Possible Solution

以 `docs/roadmap/report-chart-kernel/` 定义的 beta 迁移统一作者契约，并在实现落地时同步公开类型、官方调用点、类型测试与 Feature 示例。

## Minimal Reproducible Example

对照以下位置：

- `docs/feature/reports/library.md` 的混合图示例。
- `docs/feature/reports/components/charts/README.md` 的组合坐标图段落。
- `src/report/definition/primitives/chart.tsx` 的 `ChartProps`。
- `src/report/definition/primitives/chart-map.ts` 的 `SeriesProps`。

## Context

调研 TanStack Table / Charts 并为 NiceEval 图表语义内核写 roadmap 时，这个差异使现有作者 DSL、mixed evidence/external 验收和迁移范围无法直接从单一契约判断。
