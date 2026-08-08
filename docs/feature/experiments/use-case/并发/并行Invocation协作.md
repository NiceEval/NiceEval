# 多个 Invocation 协作执行同一 Experiment

## 解决什么问题

一批长跑 Eval 已经用两个并发开始执行，操作者随后确认本机、Sandbox Provider 和 Agent 服务还有余量。
停止重开会浪费已经完成的工作；单个 Invocation 的并发配置又不会在运行中改变。

这时直接在第二个终端运行同一条选择命令，为剩余工作增加两个并发：

```bash
# 终端 A 已经在运行
niceeval exp compare --max-concurrency 2

# 终端 B 后启动
niceeval exp compare --max-concurrency 2
```

如果有足够多尚未被领取的 Eval，两个 Invocation 合计最多同时运行四条 Attempt。
第二条命令不要求第一条支持动态配置，也不重新执行已经被第一条领取或完成的工作。

同一机制也保护无意重复运行：用户在两个终端误跑相同命令时，不会为同一条 Eval 重复支付 Sandbox 和 token 成本。

## 运行时反馈

用例锁在派发时逐 Eval 认领。
终端 B 可以领取终端 A 尚未派发的 Eval；撞上终端 A 已持有的锁时，该项进入 `elsewhere`，不占终端 B 的并发位。
其它未锁 Eval 继续派发：

```text
24 total · 2 running · 2 elsewhere · 20 queued
waiting on another run · compare/codex (2 evals, pid 41267)
```

持锁方完成并落盘后，等待方取锁、重新判断结果沿用。
已完成结果进入 `reused`，仍缺失的 Attempt 由等待方补跑；每条 Invocation 最终都形成自己的完整 Run。

## 两层并发上限

CLI `--max-concurrency` 只限制当前 Invocation，所以两个值为 2 的 Invocation 可以合计给出四个并发。
Experiment `maxConcurrency` 也只在当前 Invocation 生效：两条命令都声明 3 时，合计最多运行六条该 Experiment 的 Attempt。
需要为同一 checkpoint 串行整段生命周期时声明 `sharedState.key`，不用 `maxConcurrency` 冒充跨进程锁。

## 边界

- 锁粒度是 `(experiment, eval)`。
  同一 Eval 的多个 Attempt 由一个 Invocation 完整承接，不拆成两份不完整的通过率分母。
- 协作范围是同一工作副本与同一 `.niceeval` Record 根。
  不同机器、不同工作副本或不共享文件系统时，各自独立运行。
- Experiment `setup` / `teardown` 每个 Invocation 各执行一次。
  用例锁不把实验级 Hook 变成跨进程单例；`sharedState` 只做独占互斥，需要跨进程复用同一服务实例时仍交给外部编排。
- 两个 Invocation 的 CLI 上限会相加，但 Provider 容量不会因此增加。
  临时扩容前仍要确认本机、 Sandbox Provider 与 Agent 服务有余量。

## 相关阅读

- [并发 Invocation 架构](../../architecture.md#并发-invocation用例锁与共享状态租约) —— 用例锁、状态租约、心跳、接管与重判。
- [缓存与结果沿用](../../cache.md#并发-invocation取到锁之后重做一次规划) —— 为什么必须在取锁后重判。
- [限制全局并发](限制全局并发.md) —— 单个 Invocation 的吞吐上限。
