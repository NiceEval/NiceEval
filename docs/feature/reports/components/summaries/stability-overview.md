# Stability overview

stability 是标准 ReportDefinition 在 plan 中声明的一组 Calculation 与 page instance。
executor 一次生成 stability ReportData，表格与图表共用该数据。
公式属于该报告任务，不进入组件或公共计算内核；零纳入成员时由显式 unavailable policy 返回 unavailable，而不是空图或零值。
