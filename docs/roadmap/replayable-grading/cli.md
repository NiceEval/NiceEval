# 可重评分 Eval —— CLI

## 命令

```sh
niceeval judge replay --run <run-id> --judge <judge-id> [--json]
niceeval judge calibrate --judge <judge-id> --run <run-id> [--labels <file>] [--json]
```

重评分命令选择一份 sealed execution graph 与一个明确版本的 GradingDefinition，并写入新的 immutable
grading claim。旧 Attempt 和旧 claim 保持可读；命令不改写它们。

Pass 读取面显示 Execution、Verdict 和检查项。Score 读取面显示 Execution、Score 和评分项；没有
Verdict、Pass / Fail、总分或百分比。缺失可重评分输入时显示对应 Issue，不以 `0` 补齐。

`judge calibrate` 面向裁判标准校准（见 [TUT-7](../../user-story.md#唐诗涵在发布前确认助教-agent-符合标准)）。它在指定 Run 的历史执行材料上独立运行新裁判，并与标注标签比对。
输出混淆矩阵、过严与过宽偏差，以及裁判与人工标注的一致率，用于在发布门禁前评估裁判有效性。

机器输出带 claim identity、execution ref、evaluationKind 和与之匹配的 pass 或 score projection，供后续
离线解释和审计。
