# 先证明数据范围值得相信

## 解决什么问题

一张图可以计算正确,却因为 Run 未收尾、覆盖缺题、携带历史结果或落盘不可读而被误解。

## 全流程

1. 报告页首放 `SampleWarnings`,先呈现 Run 选择与读取问题。
2. 放置 `RunDiagnostics`,把每条 `run.diagnostics` 与该 Run 的 experimentId、startedAt 和时效一起呈现;不合并成 Sample 事实。
3. 用 `SampleSummary` 交代 Experiment / Eval / Attempt 数、时间范围与成本覆盖。
4. 用 `ExperimentList` 的占位行展示选中配置下没有结果的 Eval;不把它们冒充失败。
5. 携带或跨 Run 拼接的 Attempt 用行上时效标记交代,不升格成页面警告。
6. 只有这些事实都可见时,才让读者解读排名和趋势。

## 边界

- `SampleWarnings` 不代替 Run diagnostics、覆盖占位行或 Attempt 时效标记;四者归属不同。
- Run diagnostics 不复制进 `SampleWarnings` 或 Attempt;来源身份随呈现一起保留。
- 手工传 `Run[]` 会放弃 Sample 的选择过程与 warnings;只在明确需要自定义历史口径时这样做。
