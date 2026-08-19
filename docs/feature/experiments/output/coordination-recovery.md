# 协调状态恢复

NiceEval 恢复中断运行留下的协调状态后，用一句话说明已经继续执行：

```text
i Recovered interrupted-run state for compare/codex; this run continues.
```

Human 不展示 lease、lock、slot 或协调器内部计数。恢复成功不会把 Invocation 判为 warning 或 failure；机器流仍保留
结构化恢复事件。完整语义见
[CLI · 协调等待与恢复](../cli.md#协调等待与恢复)。
