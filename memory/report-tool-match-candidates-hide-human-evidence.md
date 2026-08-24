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

`evaluateToolMatchCollection()` 把 candidate child 的 label 写成 `candidate ${occurrence.id}`，把内部关联 identity 提升成了主要展示文案。`MatchNode` 则只在 `aria-label` 中写 sealed state，视觉 summary 仅渲染 label 并以颜色区分状态；诊断中的 `expected`、`received` 和 `reason` 必须再次展开字段行才出现。因此树的结构虽然完整，第一层信息架构却没有回答用户的诊断问题。

## 修复边界

工具候选的主要标题使用按检查顺序稳定编号的“调用 N”，并在可推导时显示观察到的工具名；内部 occurrence identity 只留在技术 locator。每个 matcher 行视觉显示 sealed state，颜色不再是唯一表达。叶子 matcher 在折叠态内联显示可用的 expected、observed 或 unavailable reason，展开后仍保留完整诊断事实。

回归由 `docs/engineering/testing/e2e/report.md#report-browser-journey` 的安装后浏览器 Journey 拥有。
