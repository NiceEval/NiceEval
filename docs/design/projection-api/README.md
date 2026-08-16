# Projection API

本决策比较 Report 或分析脚本怎样声明从 Sample owner package 到 local typed views 的读取。两项候选拥有
相同输入输出；区别是 host 是否在 I/O 前知道完整依赖图。参数化的 layout state 让本决策不依赖
[Observability package layout](../observability-package-layout/README.md) 的最终裁决。

- [Goals](GOALS.md)
- [Limits](LIMITS.md)
- [Cases](CASES.md)
- [PLAN-1（推荐）：runtime direct calls](PLAN-1/README.md)
- [PLAN-2：static finite graph](PLAN-2/README.md)
- [Decision](DECISION.md)
