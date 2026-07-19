---
name: phase-a-red-tests-pending-standard-attempt-page
description: 3 个测试在 Phase A 后仍红——内建 standard 还没有 attempt-input page；Phase D 加上后应自动转绿，不是回归
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
