# Experiment rows

`toExperimentRows(sample)` 产生 Experiment → Eval → Attempt 的层级 rows。
有效题集由 Sample coverage 决定；缺口成为占位行，不进入读数分母。
携带或跨 Run 贡献保留时效与来源，不伪装成本次新执行。

结果直接交给 `Table`，不等待 renderer 触发计算。
