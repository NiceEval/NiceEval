# 可重评分 Eval —— CLI

重评分命令选择一份 sealed execution graph 与一个明确版本的 GradingDefinition，并写入新的 immutable
grading claim。旧 Attempt 和旧 claim 保持可读；命令不改写它们。

Pass 读取面显示 Execution、Verdict 和检查项。Score 读取面显示 Execution、Score 和评分项；没有
Verdict、Pass / Fail、总分或百分比。缺失可重评分输入时显示对应 Issue，不以 `0` 补齐。

机器输出带 claim identity、execution ref、evaluationKind 和与之匹配的 pass 或 score projection，供后续
离线解释和审计。
