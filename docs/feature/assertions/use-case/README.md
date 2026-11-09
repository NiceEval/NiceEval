# Assertion 用户路径

每篇只串联一个用户目标。契约单源始终在 [Library](../library/README.md) 及其子页与 [Architecture](../architecture/README.md)，用例不重新定义 API。

## 显式值：`check` 与 `.orStop()`

- [检查输出并在前提失败时停止](check-values.md)：先确认 Turn 完成，再检查输出内容。

## 行为范围：Turn、Session 与 `t`

- [检查指定会话范围内的工具行为](check-tool-behavior.md)：分别检查单轮、跨轮与多会话工具事实。

## 分值与质量门：`.score()` 与 `.gate()`

- [计分并设置质量门](score-with-gate.md)：给完成程度计分，同时要求达到最低值。

## 观测数值：`measured` 与 `quantile`

- [检查响应耗时与分位数](check-measurements.md)：把应用观测交给数值 Match，保留未知结果。

## API → 篇目

| API 组 | 用户路径 |
|---|---|
| `check`、`equals`、`includes`、`.label`、`.orStop` | [值检查与停止](check-values.md) |
| `calledTool`、`notCalledTool`、`usedNoTools`、`toolMatch` | [工具行为范围](check-tool-behavior.md) |
| `defineScoreEval`、`defineScoreMatch`、`.score`、`.gate`、`t.score` | [计分与质量门](score-with-gate.md) |
| `measured`、`quantile`、`atMost`、`ms` | [观测数值检查](check-measurements.md) |
