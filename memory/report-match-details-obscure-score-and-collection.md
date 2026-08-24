---
format: niceeval.memory/v1
id: report-match-details-obscure-score-and-collection
title: Report Match 详情混淆计分语义并摊平 collection
createdAt: 2026-08-24T12:25:00+08:00
kind:
  type: problem
  state: resolved
  resolution:
    kind: fixed
    proof:
      - "E2E red: candidate 096f08f54642aba88b03ff3253b1bf0e7880672b5b937980ede2e91945e68335 failed because the scored mismatch header was absent before the report UI change."
      - "E2E green: pnpm e2e run --candidate <096f08f5 candidate> --repo report -- --run test/report.browser.spec.ts -g 经典报告将 Attempt passed and verified scored weight/earned, measurement observed/threshold, and collapsed Array(2) input."
      - "E2E takeover: report reliability matrix passed all isolated-copy, same-copy, repo-default-parallel, and target-single observations for the same candidate digest."
promotions:
  - kind: feature
    current:
      path: docs/feature/assertions/library/display.md
      anchor: 单条-assertion
    history: []
---
# Report Match 详情混淆计分语义并摊平 collection

## 问题

Attempt source 详情把所有计分 Assertion 归为 `soft`，再把 sealed result 改写成 `passed` 或 `failed`。标题只追加实际 earned 值，因而 `soft failed +0 pts` 同时隐藏声明的 points，并让合法零分看起来像 Attempt 失败。measurement 的闭合 observed value 也没有进入主要读面。

generic matcher 的 Input 直接递归渲染 `list` 与 `fields`。数组始终展开为无编号 bullet，嵌套对象之间没有卡片、摘要或折叠边界；事件 collection 因而看起来像一组连续的无归属字段。

## 根因

`AttemptAssertionView.severity` 把非 gate 的 scored contribution 命名为 `soft`，`assertionNodes()` 又只根据通用 outcome 和 earned suffix 拼接标题，没有同时呈现 sealed result、points 与 earned。`GenericEvidence` 只从 matcher diagnostic 读取 received，不读取 measurement 已封口在 `Observed.value` 中的数值。

通用 `Value` renderer 把所有 list 直接映射为 `<ul>`，并让每个对象继续使用无边界的 definition list。它没有 collection 摘要或逐项身份层级。

## 修复边界

计分项应以 `matched`／`mismatched`／`unavailable` 表达 matcher 结果，并同时显示 `weight N pts` 与 `earned N pts`。measurement 的主要读面同时显示实际值与 threshold。generic collection 默认显示 `Array(n)`，展开后按序号和独立边界显示元素；技术详情继续保留完整闭合值。

回归由 `docs/engineering/testing/e2e/report.md#report-browser-journey` 的安装后浏览器 Journey 拥有。

## 不覆盖的相邻能力

这次修复只关闭计分文案、measurement 和 generic collection 边界。它没有建立 Matcher Filter Debugger 所需的 source-owned ledger、稳定 identity、scope relation、逐行 overlay 或 order artifact；`Array(n)` 也不能回答哪些记录被检查、哪一行命中或顺序在哪一步受阻。

采用后的 Feature 要求 collection filter 显示权威计数与 coverage-aware overlay，并让 order 显示最早 witness path 或 `failure frontier`。这组能力不由本 Problem 的 fixed receipt 证明，也不能据此扩张原 closure 的含义。
