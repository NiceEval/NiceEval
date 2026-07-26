# 多个 Invocation 协作执行同一 Experiment

需要临时加速长跑 Experiment 时，可以在多个终端运行相同命令。用例锁在派发时逐 Eval 认领，
不同 Invocation 自动执行不同 Eval；撞锁的条目显示为 `elsewhere`，完成后按缓存规则沿用。

每个终端的 `--max-concurrency` 各自生效，总吞吐是各 Invocation 之和；Experiment
`maxConcurrency` 则跨 Invocation 共用，仍能保护共享状态和服务限额。
