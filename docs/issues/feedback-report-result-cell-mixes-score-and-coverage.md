---
format: concord.document/v1
id: feedback-report-result-cell-mixes-score-and-coverage
title: Report 结果列混合浮点尾数与无标签覆盖度
createdAt: 2026-08-24T13:45:27+08:00
kind: issue
state: draft
memoryRelations:
  - kind: root-cause
    memory: memory/report-result-cell-exposes-float-noise-and-unlabeled-coverage.md
adoptions:
  current:
    - docs/feature/verdict/cli.md
  history:
    - target: docs/feature/reports/library.md#中立组件与官方组合组件
      commit: 50cf5fce5ff0189caf6c55f27717f3b162f00b3d
origin:
  kind: dev
  repository: NiceEval/NiceEval
  commit: 73b47f1eb24255bdd4a87b18ee53ff95c9c90cf0
subject: product
claim: defect
observation: ExperimentTable 的 Result 列显示 `34.111111111111114`；另一行把 `100%`、角标 `4/8` 与 `2 通过` 连在一起，没有说明 `4/8` 表示结果覆盖度。
impact: 读者看到实现层浮点噪声，并可能把 `4/8` 误解成分数、通过数或总题数，无法快速判断实验结果。
history:
  - at: 2026-09-14T15:00:25.173Z
    action: migrate
    reason: Transferred the existing observation to its current Issue owner.
    source:
      path: feedback/feedback-report-result-cell-mixes-score-and-coverage/README.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:da7fc73a80f84989f14633cf2945b1f51aa6423ef82eee9bccacc63a73e2c5f7
---
# Report 结果列混合浮点尾数与无标签覆盖度

用户在真实 Report 的实验表中观察到：分数暴露很长的浮点尾数；通过率旁边的 `4/8` 没有标签，且与 verdict 计票挤在同一行。
