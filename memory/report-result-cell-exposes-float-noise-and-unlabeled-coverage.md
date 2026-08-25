---
format: niceeval.memory/v1
id: report-result-cell-exposes-float-noise-and-unlabeled-coverage
title: Report 结果格泄露浮点尾数并混淆覆盖度
createdAt: 2026-08-24T13:45:27+08:00
kind:
  type: problem
  state: open
promotions:
  - kind: feature
    current: []
    history:
      - target: docs/feature/reports/library.md#中立组件与官方组合组件
        commit: 50cf5fce5ff0189caf6c55f27717f3b162f00b3d
---
# Report 结果格泄露浮点尾数并混淆覆盖度

## 问题

ExperimentTable 的 Result 列会把分数显示为 `34.111111111111114`，并把部分覆盖度 `4/8` 作为无标签角标插在 `100%` 与 `2 通过` 之间。读者既看到实现层浮点噪声，也无法判断 `4/8` 是得分、通过数还是数据完整度。

## 根因

score cell 使用 `String(earned)` 直接投影 Analysis 的原始 number，没有复用 Report 已有的人读数字格式。Pass Eval 的 stacked cell 又沿用 standalone MetricValue 的紧凑 coverage 角标；进入主结果格后，角标失去字段标签，并与业务通过率和 verdict tally 排在同一行。

## 修复边界

score 只在显示层复用统一紧凑数字格式，保留原始值和排序语义。Pass Eval 主结果格把业务通过率与判定计票留在主行；部分 `samples/total` 以“结果完整度”具名放到次级行。standalone MetricValue 的紧凑覆盖展示不因此改变。

回归由 `docs/engineering/testing/e2e/report.md#report-browser-journey` 的安装后浏览器 Journey 拥有；用户确认样式前保持 Problem open。
