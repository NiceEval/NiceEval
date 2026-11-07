# view 外壳导航未按 page.navigation 过滤

现象：`docs/feature/reports/library/shell.md`「导航的组成只有一条规则」声明 pages 中
`navigation !== false` 的项才进导航，且这条规则不限于 `input: "attempt"` 的参数化
page——任何 scope-input page 都可以显式声明 `navigation: false` 退出导航。但
`niceeval view` 的外壳导航（`App.tsx` 的 `TabsList`）会把它照样渲染成一个可点击 tab。

根因：`src/view/data.ts` 的 `renderReportSlot` 计算了
`navigablePages = scopePages.filter((p) => p.navigation !== false)`，但这个变量只用于
`initialPageId` 兜底与「Available pages」错误提示；真正写进 `viewData.report.pages`
（`App.tsx` 直接拿来渲染 `TabsList`）的是未经过滤的
`scopePages.map((p) => ({ id: p.id, title: p.title }))`。`ViewReportPageMeta` 类型本身
也不携带 `navigation` 字段，`App.tsx` 端无从二次过滤。当前唯一会设
`navigation: false` 的场景（`input: "attempt"` 的参数化 page）恰好在更早一步被
`scopePages = hostReport.pages.filter((p) => p.input !== "attempt")` 挡掉，所以这个
缺口目前是潜伏的——没有已知场景触发，也没有测试覆盖到「scope-input page 显式声明
`navigation: false`」这个组合。

修法：已修，走的是「给 `ViewReportPageMeta` 加 `navigation` 字段、由 `App.tsx` 侧过滤
`TabsList`」这一路，落点 `src/view/shared/types.ts` / `src/view/data.ts` /
`src/view/app/App.tsx`。**没有**走看起来更短的「`meta.pages` 改喂 `navigablePages`」——
`viewData.report.pages` 不只是导航列表，它同时是三样东西的键：`App.tsx` 的 `TabsContent`
内容槽、`main.tsx` 抠 `<template id="niceeval-report-<pageId>-<locale>">` 静态块的
`pageIds`、以及 `tabFromHash` 认 `#/page/<id>` 深链的白名单。把页从这份列表里删掉，
`--page <该页 id>`（`initialPageId` 会取到它）与 `navigablePages` 全空时的
`?? scopePages[0]?.id` 兜底都会落到「有 tab 值、没有对应内容槽」的空白页上——用少一个多余
tab 换一个白屏，是更坏的失败形态。

顺带记下一处**没动**的不一致，留给契约裁决：`renderReportSlot` 里 `--page` 未命中时的
错误文案只列 `navigablePages`（"Available pages: …"），但 `initialPage` 是从 `scopePages`
里 find 的，所以 `--page <navigation:false 的 scope page>` 实际能打开、只是不在它自己报的
可用列表里。是"退出导航的页也允许 `--page` 直开"还是"直接报用法错误"，docs 没有声明，
本次不擅自定。

单测：`src/view/view-report.test.ts` 的 `loadViewScan · scope-input page 的 navigation
标记`（两张 scope-input page、第二张显式 `navigation: false`，断言它带标记在列且内容照常
渲染；配一条"未声明就不带标记"的对照）。发现于测试体系重划 A3（`src/view/**` 单元测试
分拣）阅读 `data.ts`/`App.tsx` 期间的旁支观察。
