# rollup 产物 basis 从 "attempt" 翻案为 "eval"

- **裁决**（2026-07-29）：`rollup()` 产物的 MetricValue 固定 `basis: "eval"`。
  `basis` 的语义定死为「samples / total 的计数单位」：
  samples 数至少有一个非 null 题内值的 Eval，
  total 数范围内全部 Eval（含零 attempt 的 coverage 缺口）；
  `refs` 与 basis 无关，恒为 Attempt locator，是证据链不是分母。
  返回 null 的 attempt 留在 refs（被检查过，供下钻解释缺数），不进 samples。
- **曾选方案**：
  1. 旧契约 `basis: "attempt"`（architecture.md/library.md 原文）——终值明明是
     withinEval→acrossEvals 跨 Eval 统计量，samples/total 却没有任何一个
     attempt 粒度的自洽读法：3+1 个 attempt 的两道题，samples 报 4 还是 2 说不清，
     coverage 缺失的 Eval 更不可能计入 attempt 分母。
  2. 拆 `evidenceBasis: "attempt"` + `aggregationBasis: "eval"` 双字段——
     evidenceBasis 对 rollup 恒为常量，信息已由「refs 是 Attempt locator」承载，
     多一个字段只多一份口径解释成本。
- 与 calculations.md 成绩单先例一致（各格 metricValue() 本就交 `basis: "eval"`）。
- 规范算例三组落在 library.md「samples / total 的口径」小节，
  外审若质疑口径先对那张表。
