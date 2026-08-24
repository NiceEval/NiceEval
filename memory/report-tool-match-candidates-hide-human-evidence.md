---
format: niceeval.memory/v1
id: report-tool-match-candidates-hide-human-evidence
title: Report 工具匹配候选隐藏可读证据
createdAt: 2026-08-24T13:13:34+08:00
kind:
  type: problem
  state: open
promotions:
  - kind: feature
    current:
      path: docs/feature/assertions/library/display.md
      anchor: 单条-assertion
    history: []
---
## 问题

工具 collection 的诊断树保留了每个 occurrence 及其 `name`、`input`、`output`、`status` 子 matcher，但 Report 折叠态只显示内部候选 identity 和字段名。用户无法直接看出“第几次调用、调用了什么、整体是否命中、哪个字段的期望与实际不同”。

## 根因

`evaluateToolMatchCollection()` 把 candidate child 的 label 写成 `candidate ${occurrence.id}`，把内部关联 identity 提升成了主要展示文案。工具字段的成功诊断又没有一致保存 observed 值，Report 无法展示实际 input、output 与 status。

`MatchNode` 只在 `aria-label` 中写 sealed state，视觉 summary 仅渲染 label 并以颜色区分状态；诊断中的 `expected`、`received` 和 `reason` 必须再次展开字段行才出现。它还把任意非空 diagnostic 都包装成 `<details>`，即使该叶子没有子节点或可展示技术事实，点击后便得到空白区域。

后续把内部 identity 换成统一的“调用 N”仍不够：collection 检查的是全部 tool occurrence，`commandMatch` 的第一个候选可能是普通工具、第二个才是命令。若诊断没有闭合每个候选的 invocation 类型与实际 subject，Report 仍只能展示无语义序号，读者无法知道“调用 1/2”分别是什么。

连续的 UI 修补仍把 retained matcher diagnostic 当成完整候选集合。Assertions 只保存有界代表项，无法据此形成完整 source ledger、exact row filters 或可靠的 `retained X / examined Y`。order 还只剩 final tri-state 与普通 matcher tree，没有 query steps、稳定 witness path 或 `failure frontier`。

跨区关联也缺少持久 identity。source owner 没有为每个独立事件和 logical tool occurrence 交付 `eventId`、`toolOccurrenceId` 与准确 scope relation／`scopeId`；Agent Turns 的 producer-minted `callId` 不能替代。React 若继续按数组位置或相邻节点拼接，就无法处理跨 Turn tool lifecycle，也无法让历史 Record 诚实降级。

## 修复边界

工具候选的主要标题先区分普通工具与命令，再使用按 canonical source order 固定的 Tn／En 编号：普通工具显示实际工具名，命令显示已闭合、已脱敏且有界的逻辑 argv preview。内部 identity 只留在技术 locator。工具字段诊断保存有界 observed preview，并随 Report locale 使用界面用语。每个 matcher 行视觉显示 sealed state，颜色不再是唯一表达。

叶子 matcher 在折叠态内联显示可用的 expected、observed 或 unavailable reason。只有存在子节点或技术事实时才渲染可展开结构；没有额外内容的叶子保持静态。

完整修复还必须建立固定五段式 Matcher Filter Debugger：Query summary、权威聚合计数、source-owned ledger、coverage-aware assertion overlay 与 selected-row detail。Analysis 用具名 composite DomainView 按稳定 identity 关闭跨 family join；Report 提供精确过滤、行内详情、会话日志定位和当前 Assertion 的 transient trace overlay。

order artifact 保存 query steps、最早 witness path 或 `failure frontier`、suffix aggregate、有界 representative diagnostics、locators 与 relation status。旧 Record 缺少逐条 relation 时只显示中立 ledger、retained old diagnostics 和明确降级文案；任何 reader 都不重跑 matcher 或合并推断。

回归由 `docs/engineering/testing/e2e/report.md#report-browser-journey` 的安装后浏览器 Journey 拥有。
