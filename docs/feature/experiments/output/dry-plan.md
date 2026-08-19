# dry plan：reuse 与 gap

同一目标里既有可采用 Attempt，也有身份不匹配的 slot 时，`--dry` 把两种决策并列展示：

```text
PLAN
compare/codex  memory/commit0  ordinal 0  reuse/carried @1K1P0VJAPVJ12
compare/codex  memory/commit0  ordinal 1  gap: identity-mismatch
```

该输出只说明本次 reuse planning 的决定，不创建 Invocation 或 Run。完整语义见
[CLI · `--dry`](../cli.md#--dry)。
