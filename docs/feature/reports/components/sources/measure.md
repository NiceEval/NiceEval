# 聚合结果行

`aggregate(sample, { by, values })` 产生带 MetricValue 与行级 refs 的普通只读数组。
两级聚合、null、coverage 与顺序由组合器保证。

完整签名见 [Library · aggregate](../../library.md#aggregate-sample-转结果行)；
计算边界见 [Calculations](../../calculations.md)。
