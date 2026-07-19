---
name: phase-a-red-tests-pending-standard-attempt-page
description: 已修——3 个测试在 Phase A 后仍红，Phase D 加 standardAttemptPage 后按预期自动转绿；但需要先 pnpm run build:report，且还有一处未预见到的测试(内建报告页数/内容 parity)要手工改
metadata:
  type: project
---

`plan/report-pages-attempt-detail-alignment.md` 的 Phase A（统一 report definition、page context、runtime facade）落地后，`pnpm test` 有 3 个测试保持红，且是有意留红,不是回归：

- `src/show/show.test.ts` › "裸 show 的 --page attempts / traces 渲染内建证据页（AttemptList / TraceWaterfall 的 text 面）"
- `src/view/data.test.ts` › "同一实验两次快照：报告槽跨快照补齐每 eval 的最新判定，不残缺；历史快照仍供证据室"
- `src/view/view-report.test.ts` › "报告槽双语渲染：同一棵树按 locale 渲染两遍，chrome 文案分语言、数据不分语言"

# Why

Phase A2 把 `WebContext.attemptHref` / `TextContext.attemptCommand` 改成真正可选：宿主只在当前
`ReportDefinition` 声明了 `input: "attempt"` page 时才注入下钻生成器（[[attempt-detail-is-a-parametrized-page]]）。
这 3 个测试都通过**裸** `show` / `loadViewScan`（不带 `--report`）走内建报告 `standard`，而
`standard`（`src/report/built-in/standard.tsx`）在 Phase D 之前只有三页（`report`/`attempts`/`traces`），
没有任何 `input: "attempt"` page——所以断言里期待的 `href="#/attempt/@..."` / `niceeval show @<locator> --timing`
命令暂时不出现，这是当前架构下的正确行为，不是实现漏了什么。

其它同类测试（`src/report/site-components.test.tsx` 的 TraceWaterfall、`src/report/react/render.test.tsx` 的
ExperimentList、`src/view/view-report.test.ts` 的 exam-report 自定义报告测试）已经在 Phase A 里改掉了——
它们用的是**测试专属 fixture**，不会因为 Phase D 改 `standard` 而自动变绿，所以直接改了测试本身
（给 fixture 显式传 `attemptHref`/`attemptCommand`，或给 fixture 加一张隐藏 attempt page，或断言改成
「无 attempt page → 纯文本」）。上面留红的 3 个不一样：它们绑定的是 `standard` 本身,`standard` 迟早会
在 Phase D 拿到 `standardAttemptPage`,那时候断言无需改动就会自然转绿。

# How to apply

- 执行 Phase D（`src/report/built-in/standard.tsx` 加第四张 `standardAttemptPage`）后,重跑这 3 个测试;
  预期直接转绿,不需要改测试内容。
- 如果转绿后行为对不上（比如命令里 `--report` 上下文缺失、href 格式不对），才是真正需要修的地方。
- 后续如果 `pnpm test` 又多出跟 attemptHref/attemptCommand 相关的新红测试，先判断它是「绑定 standard,
  等 Phase D」还是「绑定某个测试专属 fixture,需要现在就改」——判据见上面两类的区分。

# 已修(Phase D 落地记录)

预期成立,3 个测试原样转绿,但过程有两点在裁决时没预见到:

1. **改完 `standard.tsx` 直接跑 `pnpm test` 这 3 个测试仍然红**——因为 `show`/`view` 是从
   `dist/report/built-in/index.js` 装载 `niceeval/report/built-in`(`package.json` exports 指向编译产物,
   见 [report-build-rootdir-and-module-identity](report-build-rootdir-and-module-identity.md) 同一套
   "raw src 与编译产物是两份模块实例" 的坑),改 `src/report/built-in/standard.tsx` 后必须先
   `pnpm run build:report` 重新编译 `dist/report/**`,这 3 个测试才会真的看到第四页。
2. **`src/report/dual-render.test.tsx`「内建报告」describe 块**(不在上面列的 3 个里)硬编码了
   `standard` 只有三页(`pages.map(id)` 等值断言、`user` 手写 fixture 只抄了前三页)——这是「绑定
   `standard` 本身」但**不是**"自动转绿"的第 4 类:它会直接因为多出第四页而断言失败(数组长度不等),
   需要手动补页(页数/标题/`input`/`navigation` 断言,`user` fixture 补第四页,外加一段用
   `renderReportTreeToText`/`renderReportTreeToStaticHtml` 直接渲染 attempt 页内容做 parity 的新断言,
   因为 attempt-input page 不能经 `pageId` 走 `pickReportPage` 选中,`renderReportToText`/
   `renderReportToStaticHtml` 那条按 pageId 选页的路径对它必抛 `ReportPageNeedsLocatorError`)。
   修在同一 commit,与本条一起落地。
