# Sample 参考方案

本目录只列出 Sample 设计的外部输入，不定义 NiceEval 契约。当前契约位于 [README](../README.md) 与 [Library](../library.md)。

## 显式选择

数据分析工具常把筛选条件藏在页面状态中。NiceEval 采用具名 analysis selection，让脚本、终端和 web 报告从同一组 Run 建立分母，并保留 selection policy identity 与归一化输入。

## 分母状态

统计系统需要区分范围外、没有 Member 和输入损坏。`AnalysisSample` 把这些状态保留到每个 expected slot，避免聚合时把不同问题折成零值。execution gap 属于 reuse planning，不进入这个联合。

## Frozen 数据源

`AnalysisSample` 是一次 frozen reader selection 产生的纯值，不承担持久化和 producer 认证。reader 关闭后它仍可显示或纯收窄，但不能重新读取 Attachment。需要固定交付时，由 Reports 导出一个 immutable `ReportExecution` 的页面及其实际依赖。
