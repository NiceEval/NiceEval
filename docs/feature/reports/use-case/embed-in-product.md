# 把报告嵌入自己的产品页

## 解决什么问题

你不想发布独立 `niceeval view` 站点,而是要把评测概览嵌入内部门户、产品后台或现有 React 应用。

## 全流程

1. 在服务端用 `openRecord()` 选 Sample,明确使用 `latestRuns()` 还是 `latestPerEval()`。
2. 用 `Promise.all` 调 `sampleSummaryData`、`metricTableData` 等 `*Data` 函数,产出可序列化 JSON。
3. 把 data 传给 `niceeval/report/react` 的纯 web 组件;该入口不读文件,也不运行 report resolve。
4. 传入产品自己的 `attemptHref`,让 locator 下钻进入你的路由。
5. 引入官方样式与渐进增强脚本,或只消费 data 类型完全自绘。

## 边界

- 不要在浏览器组件中调 `*Data`;它可能懒加载本地 artifact。
- 只需要可分享的独立报告时用 `view --out`,不需要嵌入应用。
