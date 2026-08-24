---
format: niceeval.memory/v1
id: report-header-experiment-selector-regression
title: Report SPA 丢失 Header 实验选择器与默认实验组
createdAt: 2026-08-24T11:19:30+08:00
kind:
  type: problem
  state: open
promotions: []
---
## Problem

包含多个实验组的标准 Report 应在 Header 的语言选择左侧显示原生实验选择器，并在根 URL 没有显式 hash 时稳定进入第一组。当前 SPA 打开 `/`，显示一个未选择范围的实验链接索引；Header 只显示语言选择。

长期 owner `docs/engineering/testing/e2e/report.md#report-browser-journey` 仍明确要求默认第一组与始终有值的 Header selector。`docs/feature/reports/README.md` 的 CSS/View shell 摘要也仍写两个原生选择器，但同页前文和 `architecture.md` 被改成内容链接与只显示语言，形成互相矛盾的目标。

## Root cause

提交 `e077c1c15e9f25a2b8959be9cd1da3fc044fed09`（PR #85）统一 Report SPA 时，没有把旧静态 shell 的 experiment-group 导航迁入新 manifest/client：

- 新 `App.tsx` 只渲染语言 selector；
- `landingPage()` 改为第一个普通 `presentation: page`，使标准 Overview `/` 成为默认 route；
- manifest 不再携带客户端形成实验选择所需的已闭合 group route/label；
- 同一 PR 删除了浏览器 owner 对 `Experiments` combobox、默认第一组和切换后 scoped 内容的断言。

旧 CSS selector 仍在，说明退化不是样式隐藏，而是产品控件和默认路由语义被移除。

## Regression proof

修复必须先加强既有 `e2e/report/test/report.browser.spec.ts`，从安装后的 fix-parent candidate 经真实 `niceeval view` 与 Chromium 取得红灯。断言只观察根 URL、Header combobox、真实 option/href 导航和 scoped Page 内容，不读取 Record 或 manifest 私有实现。

## Repair boundary

恢复行为时只把 Host 已闭合的实验组 route 与显示标签交付给 app client；浏览器不读取 Analysis、不重新分组，也不执行作者 callback。根 URL 的默认 route 与 selector options 必须来自同一次已验证 revision，稳定排序规则只有 Host 一处 owner。
