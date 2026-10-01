---
format: concord.document/v1
id: feedback-report-tool-match-leaf-expands-empty
title: Report 的工具匹配叶子展开后为空
createdAt: 2026-08-24T13:45:27+08:00
kind: issue
state: draft
memoryRelations:
  - kind: root-cause
    memory: memory/report-tool-match-candidates-hide-human-evidence.md
adoptions:
  current:
    - docs/feature/assertions/library/display.md#单条-assertion
  history: []
origin:
  kind: dev
  repository: NiceEval/NiceEval
  commit: 73b47f1eb24255bdd4a87b18ee53ff95c9c90cf0
subject: product
claim: defect
observation: 用户点击工具 matcher 的 name、input、output 或 status 叶子后，只出现额外空白区域，没有任何新证据。
impact: 展开箭头承诺了可下钻内容，实际空白让读者误以为数据丢失或页面未加载完成，也增加了逐项试点成本。
history:
  - at: 2026-09-14T15:00:25.173Z
    action: migrate
    reason: Transferred the existing observation to its current Issue owner.
    source:
      path: feedback/feedback-report-tool-match-leaf-expands-empty/README.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:14edbd9ac255263ea9e63e2e47d55ab9722c74789609aa1fb1adb22cf4caf691
---
# Report 的工具匹配叶子展开后为空

用户在真实 Report 中继续观察到：工具 matcher 的字段叶子带有展开控件，但点击后没有任何新增内容，只把后续内容向下推开。

## 仍缺的产品能力

让无内容叶子保持静态只能消除空白展开区。完整产品还需要 source ledger 行内详情、selected-row detail、exact locator 导航与当前 Assertion 的 transient trace overlay；缺失逐行结果时必须显示“逐行结果未保留”，不能用现有 diagnostic tree 冒充完整 overlay。本条 Feedback 因而保持 open。
