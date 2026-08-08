# Experiments 与 Runner：原子认领例外

选择、派发、carry、history、退出码与反馈由 [Runner E2E](../e2e/runner.md) 和 [CLI E2E](../e2e/cli.md) 从安装后的命令证明。
这些用户结果不在 Unit 重复。

## Unit 例外规范

### Entry file 原子认领

[并发 Invocation 契约](../../../feature/experiments/architecture.md#并发-invocation用例锁与共享状态租约)要求两个消费者不能同时取得同一份登记的执行权。
用两个真实 CLI 进程竞争时，调度器无法稳定安排它们落在同一个 rename 窗口；只断言最终文件消失也分不出“双赢家”错误。

稳定 seam 是共享层 `claimEntryFile()` 的 rename 墓碑动作。唯一矩阵让两个调用者同时竞争同一 id，并断言结果恰为一个 `true`、一个 `false`。
写入、读取、清理和上层 lock / lease 结果都能由真实 Journey 观察，不再保留 Unit。
