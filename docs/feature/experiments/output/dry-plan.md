# dry plan：reuse 与 gap

同一目标里既有可采用的历史结果，也有配置变化后需要重新运行的 Attempt 时，`--dry` 把两种决策并列展示：

```text
PLAN
compare/codex  memory/commit0  Attempt #1  using result @1K1P0VJAPVJ12
compare/codex  memory/commit0  Attempt #2  will run — configuration changed
```

该输出只说明本次计划，不创建 Invocation 或 Run。完整机器语义见
[CLI · `--dry`](../cli.md#--dry)。
