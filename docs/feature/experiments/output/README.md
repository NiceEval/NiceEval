# Experiments CLI 输出案例

本目录只保存无法归属单一用户目标的排版补充。完整 `exp`、list、`--dry`、`--json`、accept 与结束案例归各自的叶子 Use Case；字段语义、优先级和持久化边界的单源仍在 [CLI](../cli.md)。

## 计划与调试

- [dry plan](dry-plan.md) —— 指向选择器用例中的完整计划案例。
- [command plan](debug-command-plan.md) —— `debug` 展示带 Sandbox create 的生命周期树。
- [多行 Shell](debug-multiline-shell.md) —— 保留缩进、空行与末尾换行。

## 运行与结束

- [协调恢复](coordination-recovery.md) —— 指向恢复中断运行用例。
- [正常完成](completed-run.md) —— 指向 CI 用例中的终态、`RESULTS` 与 `NEXT`。
- [Attempt 失败](attempt-failures.md) —— 指向 CI 用例中的逐 Attempt 下钻。
- [共享 Sandbox 构建失败](shared-sandbox-build-failure.md) —— Attempt 创建前的真实错误与 Run 下钻。
- [NDJSON 流](json-stream.md) —— 指向 AI 修复循环的 progress、diagnostic 与最后一条 receipt。
