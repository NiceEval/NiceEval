---
format: niceeval.feedback/v1
id: feedback-report-match-details-obscure-score-and-collection
title: Report 的 Match 详情混淆计分结果并摊平 collection 输入
state: closed
reportedAt: 2026-08-24T12:15:54+08:00
source:
  kind: dev
  repository: NiceEval/NiceEval
  commit: e8b4f34d9436453f088c39b3489da52174a5a2e9
subject: product
claim: defect
observation: Attempt 源码详情把带 points 的 Boolean mismatch 显示成 `soft failed +0 pts`，把 measurement 显示成 `soft passed +3 pts`，却没有同时显示声明的 points 与 measurement。`satisfies` 收到事件数组时，Input 又把元素字段连续摊开，元素边界和 collection 大小不可辨认。
impact: 读者会把合法的零分贡献误解为 Attempt 失败，也无法快速核对 measurement、weight、earned 之间的关系；面对事件数组时还必须阅读大段原始字段才能确认 matcher 实际检查的材料。
adoptedContract:
  path: docs/feature/assertions/library/display.md
  anchor: 单条-assertion
memoryRelations:
  - kind: root-cause
    memory: report-match-details-obscure-score-and-collection
closure:
  kind: fixed
  memory: report-match-details-obscure-score-and-collection
  proof:
    - E2E browser regression passed for scored matcher labels, measurement evidence, and collapsed collection input with candidate 096f08f54642aba88b03ff3253b1bf0e7880672b5b937980ede2e91945e68335.
    - E2E takeover completed with matrixValidation.ok=true and no issues.
---
# Report 的 Match 详情混淆计分结果并摊平 collection 输入

用户在真实 Report 的 Attempt source 详情中观察到两类问题：计分 matcher 使用 `soft passed`／`soft failed` 汇总状态，却省略声明的 points 或 measurement；generic `satisfies` 输入把事件数组的对象字段连续展开，无法先看 collection 摘要或辨认元素边界。

## 相邻的产品能力缺口

本条 closure 只证明计分语义、measurement 与 generic collection 边界已经修复。`Array(n)` 摘要不是 Matcher Filter Debugger：它没有 source-owned ledger、权威聚合计数、逐行 overlay、identity relation 或 order witness／`failure frontier`。原 observation 的 fixed 状态保持有效，这组更大的产品能力由采用后的 Feature 契约继续约束。
