# Docker 执行配置 —— Lifecycle

旧 profile 的 watchdog、loop attach、raw copy 与跨 Attempt slot 复用不是 DestroyOnly Incus 生命周期。

adopted 时序见 [Nested Docker Lifecycle](../nested-docker/lifecycle.md)。
V1 每条 Attempt 克隆一台一次性 VM，成功、失败与强杀后都销毁 instance、disk、network 与 lease。

旧 `/data/niceeval-dind-pool.img` 对 Incus storage 与 SandboxAllocation ledger 都不可见。
doctor、activation、reconciler 与 GC 都不得自动打开、挂载、fsck、adopt、rename 或 delete 它。
