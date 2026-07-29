# 稳定性结果

`stabilityResult(sample, options)` 是内建 stability 报告与 `show --stats`
共用的公开任务函数。它返回普通 Result，text 与 JSON 消费同一次结果。

稳定性没有跨场景统一公式，因此不进入公共计算内核。
完整边界见 [Calculations · stability](../../calculations.md#stability-不是内核)。
