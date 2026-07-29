# 成对差异结果

成对差异由公开 `comparisonResult()` 或报告旁 `pairedDelta()` 计算。
算法显式声明 baseline、candidate、配对键与缺失策略，
并通过 `metricValue()` / `evidenceRow()` 交出 `basis: "pair"` 的结果。

两个总平均数直接相减不等价。完整边界见
[Calculations · delta](../../calculations.md#delta-不是内核)。
