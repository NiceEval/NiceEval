# 默认报告的 text 面

不带显式 target 的 `niceeval show` 运行标准 ReportDefinition。
它先生成固定 Sample，再由标准 Plan 生成摘要、质量与成本、Experiment 行和 available/unavailable notices。

text 面与 view 消费相同 ReportData。
每个 Experiment、Eval 与 Attempt 行显示完整 identity、MetricValue、coverage、membership provenance
与可用 target。available 显示 verification / issues，unavailable 显示 causes / basedOn。
显示层不通过配置摘要、时间或 UI 字段重选结果。

缺口行区分 excluded 与 unavailable，并显示 Sample 已确定的全部原因。
它们不会进入 MetricValue 的 included 成员，也不会被展示层补成失败、零或旧值。

locator 与 refs 只链接到同一标准 Plan 已枚举的详情 instance。
要更换页面定义，使用 `--report`；要改变成员，先生成或收窄不同 Sample。

## 相关阅读

- [Show](../show.md) —— 默认 target 的选择。
- [内建报告](../library/built-in.md) —— standard Plan。
- [Experiment table](../components/summaries/experiment-table.md) —— 层级 rows。
