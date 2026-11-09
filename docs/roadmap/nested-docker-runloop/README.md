# 托管 Nested Docker：Runloop

需要托管评估资源的作者可以让 Runloop 提供私有 Docker daemon、专用 guest kernel 与有界 Docker data capacity。
它是 [Nested Docker](../../feature/sandbox-nested-docker/README.md) 的第二 Provider 方向，当前采用的公开路径仍由 Incus Feature 拥有。

## 能力边界

Eval 沿用 provider-neutral `DockerExecutionRequirement`，声明 `docker/v1`、Compose、`dedicated-kernel/v1` 与最低 data bytes。
Experiment 选择满足相同要求的托管 Provider；Eval 不编码 Runloop、Blueprint、locator 或 storage driver。
本方向不定义新的公开 factory、字段或 CLI。

每条 Attempt 从受信任的 immutable Provider artifact 创建私有 writable allocation。
共享起点可以使用 Provider 的 Blueprint 或 snapshot，但普通 Attempt 的 Docker database、workspace 与 secret 不能晋升为共享输入。
Provider 拥有实例、存储、network 与 inventory，NiceEval 拥有 capability binding、allocation ledger、lease、generation 与 fencing。

生命周期遵守 [DestroyOnly 与恢复](../../feature/sandbox-nested-docker/architecture/lifecycle.md)。
取消、控制进程中断或 Provider client 失联后，通过 exact metadata 与 detached inspect/destroy 证明对象终止及容量释放。
不续跑遗留 Agent，不自动重发模型请求，也不回退到宿主 socket、raw DinD 或弱隔离执行。

## 准入与验收

Runloop 只有通过与 Incus reference 相同的 capability、capacity 与 recovery suite，才能成为采用的公开 Provider。
产品宣传中的 Docker、snapshot 或完整 Linux 支持不能替代以下证据：

- 专用 kernel、private daemon、Compose 与逐 allocation 的 hard capacity receipt；NiceEval-Eval 的 4 GiB 要求不是所有 Eval 的默认值。
- 四条真实并发 allocation 的容量 reservation、隔离与独立 Docker workload。
- exact metadata inventory、创建 acceptance unknown 的对账、控制进程强杀后的 fencing 与 detached destroy。
- instance、private disk、network 与 lease 的终结证据；删除请求被受理不能冒充资源已经 absent。
- trusted artifact 的 cold prepare、warm clone、局部 artifact 损坏及无共享可写状态。
- 安装候选通过公开 Experiment 执行、query/show 与只读诊断入口交付结果和回收证据。

任一能力无法证明时，配对在派发前具名拒绝，不降低 `docker/v1` 的保证。
