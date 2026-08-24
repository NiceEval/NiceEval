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

## 修复边界

工具候选的主要标题先区分普通工具与命令，再使用按检查顺序稳定编号：普通工具显示实际工具名，命令显示已闭合、已脱敏且有界的逻辑 argv preview；旧 Record 缺少身份证据时明确显示详情未记录。内部 occurrence identity 只留在技术 locator。工具字段诊断保存有界 observed preview，并随 Report locale 使用界面用语。每个 matcher 行视觉显示 sealed state，颜色不再是唯一表达。

叶子 matcher 在折叠态内联显示可用的 expected、observed 或 unavailable reason。只有存在子节点或技术事实时才渲染可展开结构；没有额外内容的叶子保持静态。

回归由 `docs/engineering/testing/e2e/report.md#report-browser-journey` 的安装后浏览器 Journey 拥有。
