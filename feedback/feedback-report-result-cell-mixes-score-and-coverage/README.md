---
format: niceeval.feedback/v2
id: feedback-report-result-cell-mixes-score-and-coverage
title: Report 结果列混合浮点尾数与无标签覆盖度
state: open
reportedAt: 2026-08-24T13:45:27+08:00
source:
  kind: dev
  repository: NiceEval/NiceEval
  commit: 73b47f1eb24255bdd4a87b18ee53ff95c9c90cf0
subject: product
claim: defect
observation: ExperimentTable 的 Result 列显示 `34.111111111111114`；另一行把 `100%`、角标 `4/8` 与 `2 通过` 连在一起，没有说明 `4/8` 表示结果覆盖度。
impact: 读者看到实现层浮点噪声，并可能把 `4/8` 误解成分数、通过数或总题数，无法快速判断实验结果。
adoptions:
  current:
    - docs/feature/reports/library.md#中立组件与官方组合组件
  history: []
memoryRelations:
  - kind: root-cause
    memory: report-result-cell-exposes-float-noise-and-unlabeled-coverage
---
# Report 结果列混合浮点尾数与无标签覆盖度

用户在真实 Report 的实验表中观察到：分数暴露很长的浮点尾数；通过率旁边的 `4/8` 没有标签，且与 verdict 计票挤在同一行。
