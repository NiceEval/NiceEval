# Sample 参考方案

本目录只列出 Sample 设计的外部输入，不定义 NiceEval 契约。当前契约位于 [README](../README.md) 与 [Library](../library.md)。

## 显式选择

数据分析工具常把筛选条件藏在页面状态中。NiceEval 采用具名 analysis projector，让脚本、终端和 web 报告从同一组 Run 建立分母，并保留 projector identity 与归一化输入。

## 分母状态

统计系统需要区分范围外、没有 Member 和输入损坏。`AnalysisSample` 把这些状态保留到每个 expected slot，避免聚合时把不同问题折成零值。execution gap 属于另一条执行投影，不进入这个联合。

## 可编辑数据源

`AnalysisSample` 是一次读取产生的普通值，不承担持久化和 producer 认证。需要固定交付时，由 Reports 导出已计划页面及其实际依赖。
