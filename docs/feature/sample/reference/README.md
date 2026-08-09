# Sample 参考方案

本目录只列出 Sample 设计的外部输入，不定义 NiceEval 契约。当前契约位于 [README](../README.md) 与 [Library](../library.md)。

## 显式选择

数据分析工具常把筛选条件藏在页面状态中。NiceEval 采用显式 `RunSelection`，让脚本、终端和 web 报告从同一组 Run 建立分母。

## 分母状态

统计系统需要区分范围外、没有 Member 和输入损坏。Sample 把这些状态保留到每个 expected slot，避免聚合时把不同缺口折成零值。

## 可编辑数据源

Sample 是一次读取产生的普通值，不承担持久化和 producer 认证。需要固定交付时，由 Reports 导出已计划页面及其实际依赖。
