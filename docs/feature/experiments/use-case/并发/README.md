# 并发 —— 用例

先区分两个控制面：Experiment 的 `maxConcurrency` 约束一个实验并跨 Invocation 生效；CLI `--max-concurrency` 约束本次 Invocation 的全局吞吐。

| 目标 | 用例 |
|---|---|
| Eval 互相独立，追求默认吞吐 | [独立评测并行执行](独立评测并行执行.md) |
| 跨 Attempt 读写同一份状态 | [串行保护共享状态](串行保护共享状态.md) |
| 后一道 Eval 依赖前一道的结果 | [固定执行顺序](固定执行顺序.md) |
| 只有一个 Experiment 撞服务限额 | [限制单个实验](限制单个实验.md) |
| 重复运行必须按结果决定下一次 | [严格顺序重试](严格顺序重试.md) |
| 生命周期代码在并发下保存每个 Sandbox 的状态 | [隔离Hook状态](隔离Hook状态.md) |
| 本机或 Provider 容量不足 | [限制全局并发](限制全局并发.md) |
| 快慢实验混在同一批 | [让调度器混跑](快慢实验混跑.md) |
| 多开终端为同一 Experiment 加速 | [并行Invocation协作](并行Invocation协作.md) |
| 不在启动它的终端，想知道哪些 Experiment 正在跑 | [查看活跃实验](查看活跃实验.md) |

调度与名额持有期的契约单源在 [Runner](../../../../runner.md#调度有界并发)。
