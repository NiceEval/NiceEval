# 固定题集成绩单

成绩单在报告旁显式声明 rubric、权重、满分与缺题策略。
缺题仍占固定 total；已有 Attempt 进入 refs。
每格与总分通过 `metricValue()` 构造，总分复用各题格的 refs。

完整边界见 [Calculations · scoreboard](../../calculations.md#scoreboard-是模式不是-api)。
