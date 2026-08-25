# Experiments CLI 输出案例

本目录保存 `niceeval exp` 与 `niceeval debug` 的完整输出案例，一篇只展示一个场景。
字段语义、优先级和持久化边界的契约单源仍在 [CLI](../cli.md)；这里负责让实现者和评审者能核对完整排版。

## 计划与调试

- [dry plan](dry-plan.md) —— 已有结果与需要重新运行的 Attempt 同时出现。
- [command plan](debug-command-plan.md) —— `debug` 展示带 Sandbox create 的生命周期树。
- [多行 Shell](debug-multiline-shell.md) —— 保留缩进、空行与末尾换行。

## 运行与结束

- [协调恢复](coordination-recovery.md) —— 用用户语言说明恢复完成并继续运行。
- [正常完成](completed-run.md) —— 终态、`RESULTS` 与 `NEXT`。
- [Attempt 失败](attempt-failures.md) —— 断言可概括共同形态，每条 execution error 原样展示并经 locator 下钻。
- [共享 Sandbox 构建失败](shared-sandbox-build-failure.md) —— Attempt 创建前的真实错误与 Run 下钻。
- [NDJSON 流](json-stream.md) —— progress、diagnostic 与最后一条 receipt。
