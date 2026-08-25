---
format: niceeval.feedback/v2
id: feedback-report-tool-match-candidates-hide-human-evidence
title: Report 的工具匹配候选隐藏可读证据
state: open
reportedAt: 2026-08-24T13:13:34+08:00
source:
  kind: dev
  repository: NiceEval/NiceEval
  commit: f47b828cf5a19b05c9a9b93b04691e1735b73cce
subject: product
claim: defect
observation: Attempt 源码详情把工具匹配候选显示成 `candidate [niceeval.logical-tool-occurrence/1,...]`，候选内只列出 `name`、`input`、`output`、`status`。字段是否命中只由颜色表达，折叠态不显示期望值、实际值或状态文字。
impact: 读者无法直接判断每个候选是哪次工具调用、哪一字段不匹配，以及期望与实际相差什么；必须逐层展开并依赖颜色猜测，仍会被内部 occurrence identity 干扰。
adoptions:
  current:
    - docs/feature/assertions/library/display.md#单条-assertion
  history: []
memoryRelations:
  - kind: root-cause
    memory: report-tool-match-candidates-hide-human-evidence
---
# Report 的工具匹配候选隐藏可读证据

用户在真实 Report 的 Attempt source 详情中观察到：工具 matcher 虽然保留了候选树，却把内部 occurrence identity 当作候选标题；字段行只显示字段名并以颜色编码状态，折叠态看不到期望与实际。

## 仍缺的产品能力

可读候选标题、视觉状态和 expected／observed 摘要只改善 retained diagnostic。Report 仍没有完整 source-owned ledger、稳定 `toolOccurrenceId`／`eventId`、准确 scope relation、四维完整性、coverage-aware overlay、精确过滤与跨区定位。order 也没有稳定 witness path 或 `failure frontier`；旧 Record 还不能按关系缺失诚实降级，因此本条 Feedback 保持 open。
