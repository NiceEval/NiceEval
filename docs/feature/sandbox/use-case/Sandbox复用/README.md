# `sandboxReuse: true` —— 用例

Experiment 声明 `sandboxReuse: true` 后，指纹匹配的终态 Attempt 会照常由后续 Run 沿用，不创建 Sandbox。
未沿用的 Attempt 才共用 Sandbox，分摊创建和公共准备。
每条 Attempt 都按 occurrence schedule 满足 before action；缓存命中 restore，miss replay，Provider 不支持时真实执行。

| 目标 | 用例 |
|---|---|
| 当前 lockfile 的依赖每题都要安装 | [每个复用 Sandbox 只真实安装一次](../sandbox-reuse-shared-dependency.md) |
| 本地快速冒烟一批 Eval | [把 N 次冷启动折成一次](../sandbox-reuse-batch-smoke.md) |
| 保留有限并发 | [用多个 Sandbox 分摊一批 Attempt](../sandbox-reuse-batch-smoke.md) |
| 多开 Invocation 时决定 Sandbox 与 checkpoint 是否共享 | [并行 Invocation 与状态边界](../sandbox-reuse-parallel-invocations.md) |
| 批次超过一个 Sandbox 的寿命 | [在派发前更换 Sandbox](../sandbox-reuse-rotate.md) |
| 同一题重复运行并观察稳定性 | [昂贵安装只真实付一次](../sandbox-reuse-repeatability.md) |
| 选中的 Eval 各带不同 template | [复用池按物理身份分组](../sandbox-reuse-heterogeneous-batch.md) |
| 实验声明了原生 Plugin | [声明了原生 Plugin 的实验开复用](../sandbox-reuse-plugin-experiment.md) |
| 现有 Eval 还不能使用 Sandbox 复用 | [准备可复用的 Eval](../sandbox-reuse-preparable-evals.md) |
| Docker image 或 E2B snapshot 无法验证或恢复 | [从更短前缀或 Base 重新执行准备](../sandbox-reuse-clean-start.md) |

完整契约见 [Sandbox 复用](../../reuse.md)。
