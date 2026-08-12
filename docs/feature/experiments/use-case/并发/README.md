# 并发 —— 用例

先区分三个控制面：CLI `--max-concurrency` 约束本 Invocation 的全局吞吐，Experiment `maxConcurrency` 约束本 Invocation 内该实验的宽度。同一 Record root 不支持并发 Invocation；不同 root 若共享外部状态，再用 `sharedState.key` 保护状态区间。

| 目标 | 用例 |
|---|---|
| Eval 互相独立，追求默认吞吐 | [独立评测并行执行](独立评测并行执行.md) |
| 跨 Attempt 读写同一份状态 | [串行保护共享状态](串行保护共享状态.md) |
| 多开终端时隔离 Record，并保护共享 checkpoint | [并行 Invocation 与状态边界](../../../sandbox/use-case/Sandbox复用/并行Invocation与状态边界.md) |
| 后一道 Eval 依赖前一道的结果 | [固定执行顺序](固定执行顺序.md) |
| 只有一个 Experiment 撞服务限额 | [限制单个实验](限制单个实验.md) |
| 重复运行必须按结果决定下一次 | [严格顺序重试](严格顺序重试.md) |
| 生命周期代码在并发下保存每个 Sandbox 的状态 | [隔离Hook状态](隔离Hook状态.md) |
| 本机或 Provider 容量不足 | [限制全局并发](限制全局并发.md) |
| 快慢实验混在同一批 | [让调度器混跑](快慢实验混跑.md) |
| 多开终端运行同一 Experiment | [并行 Invocation](并行Invocation协作.md) |

调度与名额持有期的契约单源在 [Runner](../../../../runner.md#调度有界并发)。
