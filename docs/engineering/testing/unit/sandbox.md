# Sandbox：可控 Provider 时序例外

真实 Sandbox 的创建、执行、signal 与资源终态由 Adapter 和 Lifecycle E2E 证明。Docker-in-Docker、远端配额和真实 Provider 故障
无法满足重复运行门时不自动化，不用 Unit 冒充真实运行条件。

## Unit 例外规范

### BuildKey 构建协调

[Run 级构建协调契约](../../../feature/sandbox/case.md#run-级构建协调共享准备的预算与调度)同时约束 single-flight、逐 key 放行、
失败隔离、并发上限、timeout、Invocation abort、全局预算与重试分类。真实 Provider E2E 无法稳定安排 cache miss、挂起、限流和失败发生的次序，
也不能用真实时钟穷举互相独立的 BuildKey。

稳定 seam 是 NiceEval 自有的 `SandboxBuildProvider` port 与 Run timing recorder。矩阵只保留能区分错误调度器的状态：

- 相同 BuildKey 只执行一次，cache hit 不触发 build；
- 失败只影响依赖该 key 的工作，并共享同一个 Run origin；
- 独立构建受并发、逐 key timeout、全局预算与 abort 约束；
- 瞬时失败有限重试，确定性失败不重试，已就绪 key 不等待慢 key；
- 共享构建耗时只进入 Run timing，不复制进每条条目。

### Provision retry

[Sandbox 重试契约](../../../feature/sandbox/architecture.md)要求歧义创建先 reconcile，reconcile 失败保留原错误，退避期间释放并发位。
真实限流与“远端其实已经创建成功”的状态无法可靠安排；fake timer 和 `ProvisionSlot` 是唯一可控入口。

最小矩阵区分：没有 reconcile 通道时不盲重试、每次重试前先 reconcile、reconcile 失败终止、退避前后按序 release / reacquire。

其它 Sandbox 行为不保留 Unit。真实运行条件能观察的结果归 E2E；无法可靠运行的 Docker-in-Docker 行为按不自动化处置。
