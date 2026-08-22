# Architecture

## 前缀身份

Base 之后每个 preparation operation 产生一个链式身份：

```text
SetupPrefixKey[i] = hash(
  domain/trust and base/provider identity,
  SetupPrefixKey[i - 1],
  evaluated scope,
  owner-qualified operation id,
  optional cacheVersion,
  canonical recipe digest,
  immutable input identities after lookup,
  target platform and execution user,
  storage schema / quiesce / materializer revisions
)
```

parent key 使相同操作不能从不同 verified baseline 错误复用。操作类型、命令或目标、规范化参数和已求值 typed inputs 形成 canonical recipe digest；`cacheVersion` 只为这些输入无法表达的实现世代提供显式失效。sandbox-scope prefix 以 Provider/base 为根；attempt-scope prefix 以 verified sandbox reset baseline 为 parent。`changeFrequency`、promotion、冷热、locator、lease、credential value、Attempt UUID 和调度额度不进入 key。

只有 key、manifest 与 Provider artifact 双向验证成功的前缀可以命中。每个 scope occurrence 都产生 preparation satisfaction：hit restore verified private state，miss 从最长 verified prefix replay，unsupported 真实执行。每个逻辑前缀都有 key 和缓存资格，但 Provider 不必为每一步立刻写出物理 artifact。promotion policy 可以根据频率、成本和复用证据选择前缀，并使用有界公平排队，不能让高频工作永久饥饿。

## Provider capability

Provider binding 对 core 暴露 lookup、创建 staging/clone、quiesce、capture、verify 与 instantiate 的等价 typed capability。`Unsupported` 与 operational failure 分离；不支持 prefix cache 时可以明确重新执行 recipe，但不能伪造命中。共享 prefix 复用 cache lifecycle 的 registry、operation、generation fence、lease、durable root 与两阶段 GC，cache kind 为 `sandbox-setup-prefix`。

同一 `(domainId, SetupPrefixKey)` 只有一个 active promotion。旧 writer 在发布前失去 generation fence 后不得发布。staging scratch 始终 DestroyOnly。复制型 clone 验证独立后可释放 read lease；parent-backed clone 必须先登记 durable root，销毁并复核 Provider reference 消失后才能解除。

## DinD 捕获面

Docker DinD 的一个前缀必须原子包含 outer writable rootfs、私有 `/var/lib/docker` 和声明纳入的 volume。Provider 在捕获前完成 recipe、确认没有遗留进程或 inner container、优雅停止 inner dockerd/containerd、等待退出并 sync；随后排除 socket、PID、lock、网络 namespace、实例 identity 与 secret channel。

每个消费者取得私有 writable clone。只 `docker commit` outer container 会漏掉 inner data-root；复制运行中的 `/var/lib/docker` 会产生不一致状态；共享 writable upperdir 会破坏 Attempt 隔离。这些都不是合法前缀。Provider 无法完整、原子捕获时必须报告 Unsupported。

普通 lifecycle callback 截断整条共享捕获 lineage；后续 operation 标记 `ineligible: opaque-ancestor`。每个物理 Sandbox 可以另有私有 reset baseline，但 opaque state 不能登记为共享 prefix。sandbox reuse 下，secret setup 必须位于 Provider 声明为 snapshot-excluded 且 reset 保留的 lifecycle-owned overlay；无法证明时该组合在 planning 失败。
