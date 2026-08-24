---
format: niceeval.feedback/v1
id: feedback-report-tool-match-leaf-expands-empty
title: Report 的工具匹配叶子展开后为空
state: open
reportedAt: 2026-08-24T13:45:27+08:00
source:
  kind: dev
  repository: NiceEval/NiceEval
  commit: 73b47f1eb24255bdd4a87b18ee53ff95c9c90cf0
subject: product
claim: defect
observation: 用户点击工具 matcher 的 name、input、output 或 status 叶子后，只出现额外空白区域，没有任何新证据。
impact: 展开箭头承诺了可下钻内容，实际空白让读者误以为数据丢失或页面未加载完成，也增加了逐项试点成本。
adoptedContract:
  path: docs/feature/assertions/library/display.md
  anchor: 单条-assertion
memoryRelations:
  - kind: root-cause
    memory: report-tool-match-candidates-hide-human-evidence
---
# Report 的工具匹配叶子展开后为空

用户在真实 Report 中继续观察到：工具 matcher 的字段叶子带有展开控件，但点击后没有任何新增内容，只把后续内容向下推开。

## 仍缺的产品能力

让无内容叶子保持静态只能消除空白展开区。完整产品还需要 source ledger 行内详情、selected-row detail、exact locator 导航与当前 Assertion 的 transient trace overlay；缺失逐行结果时必须显示“逐行结果未保留”，不能用现有 diagnostic tree 冒充完整 overlay。本条 Feedback 因而保持 open。
