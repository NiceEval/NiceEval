---
format: niceeval.feedback/v1
id: 20260824111930-report-header-experiment-selector
title: Report Header 实验选择器回归为未选择索引
state: open
reportedAt: 2026-08-24T11:19:30+08:00
source:
  kind: dogfood
  repository: NiceEval/NiceEval-Preview
  originId: preview-pr-108-header-experiment-selector
  commit: 587f07590bb8f1883b30feade86c5af6220b58f2
subject: product
claim: defect
observation: 这里有一个回归bug吧，之前说实验选择应该是在head在语言选择的左边，没有选的时候默认选第一个，什么时候又回归成这种了
impact: 包含多个实验组的 Report 打开根 URL 后显示未选择范围的实验链接索引，Header 只有语言选择器。读者不能立即看到一个具体实验范围，也不能从语言选择左侧直接切换实验。
adoptedContract:
  path: docs/engineering/testing/e2e/report.md
  anchor: report-browser-journey
memoryRelations:
  - kind: root-cause
    memory: report-header-experiment-selector-regression
---
## Reporter observation

> 这里有一个回归bug吧，之前说实验选择应该是在head在语言选择的左边，没有选的时候默认选第一个，什么时候又回归成这种了

## Provenance

在 NiceEval PR #108 的 Netlify Report preview 根页面观察到。公开页面包含 gallery、judge-unavailable、sandbox-group、sandbox-reuse 与 states 五个实验范围，却只显示正文链接索引；Header 右侧只有语言选择。