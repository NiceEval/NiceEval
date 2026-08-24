---
format: niceeval.memory/v1
id: report-header-experiment-selector-regression
title: Report SPA 丢失 Header 实验选择器与默认实验组
createdAt: 2026-08-24T11:19:30+08:00
kind:
  type: problem
  state: resolved
  resolution:
    kind: fixed
    proof:
      - "E2E red: fix-parent dc3f89c243de2214555960dc9e48d7356a48157f installed candidate 3465f8f1fa110c0303c3efd4f9478247f46438e83e51fe059a14670286aaf4f2 failed e2e/report/test/report.browser.spec.ts at the earliest public root URL assertion: received /, expected #/group/named/classic."
      - "E2E green: candidate 4c26ab7f9a42890dfe2a3e37e1e353baab56e262f026a5c92967b07b8e5ec693 ran pnpm e2e test --repo report -- --run test/report.browser.spec.ts with 2 passed; the selector Journey covered default route, Header order, group switching, Back/Forward, locale, overlay, and deep link."
      - "E2E reliability takeover: /tmp/niceeval-report-selector-takeover.PHx3Hw completed 3 isolated copies, same-copy repeat, repo-default-parallel 6 files / 13 tests, and target-single with category pass and scratch cleanup ok."
      - "Public regression check: https://deploy-preview-108--niceeval-report-preview.netlify.app at NiceEval commit 3756e5c479762f76dc5c6d499dd57b5781decd13 defaulted to #/group/named/gallery, exposed Experiments=gallery before Language=EN with five options, and switching states produced #/group/singleton/states plus the scoped 1 experiment / 5 eval results."
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
