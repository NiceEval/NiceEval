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

修法：未修。要修的话，`meta.pages` 应该用 `navigablePages` 而不是 `scopePages`（或者
给 `ViewReportPageMeta` 加 `navigation` 字段、由 `App.tsx` 侧过滤）。发现于测试体系
重划 A3（`src/view/**` 单元测试分拣）阅读 `data.ts`/`App.tsx` 期间的旁支观察，不在
本次任务范围内一并修复。
