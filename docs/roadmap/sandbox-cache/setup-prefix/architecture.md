# Architecture

## 前缀身份

Base 之后每个 eligible before action 产生一个链式身份：

```text
SetupPrefixKey[i] = hash(
  domain/trust and base/provider identity,
  SetupPrefixKey[i - 1],
  physical sharing cohort and occurrence kind,
  owner kind + stable id + declaration order,
  linked topological order and changeFrequency,
  explicit dependency and typed capability edges,
  action id,
  optional cacheVersion,
  canonical recipe digest,
  immutable input identities after lookup,
  target platform and execution user,
  storage schema / quiesce / materializer revisions
)
```

parent key 使相同 action 不能从不同 verified baseline 错误复用。action 类型、命令或目标、规范化参数和已求值 typed inputs 形成 canonical recipe digest；`cacheVersion` 只为这些输入无法表达的实现世代提供显式失效。

physical-instance prefix 以 Provider/base 和 cohort 为根；attempt prefix 以 verified reset baseline 为 parent。`changeFrequency` 通过 linked topological order 与祖先链进入身份。promotion、冷热、locator、lease、credential value、Attempt UUID 和调度额度不进入 key。

普通 inputs 不产生 action 间的依赖边。显式 `dependsOn` 与具名 `provides` / `requires` capability 形成 DAG；每个 physical-instance occurrence 和每个 attempt occurrence 分别拓扑排序。ready set 按最小 changeFrequency、再按稳定 declaration key 取节点。跨 occurrence、跨 lane、跨 Attempt 或跨物理实例的边在 planning 阶段失败。

只有 key、manifest 与 Provider artifact 双向验证成功的前缀可以命中。每个 eligible before occurrence 都产生 satisfaction：hit restore verified private state，miss 从最长 verified prefix replay，unsupported 真实执行。每个逻辑前缀都有 key 和缓存资格，但 Provider 不必为每一步立刻写出物理 artifact。promotion policy 可以根据频率、成本和复用证据选择前缀，并使用有界公平排队，不能让高频工作永久饥饿。

## Provider capability

Provider binding 对 core 暴露 lookup、创建 staging/clone、quiesce、capture、verify 与 instantiate 的等价 typed capability。`Unsupported` 与 operational failure 分离；不支持 prefix cache 时可以明确重新执行 recipe，但不能伪造命中。共享 prefix 复用 cache lifecycle 的 registry、operation、generation fence、lease、durable root 与两阶段 GC，cache kind 为 `sandbox-setup-prefix`。

同一 `(domainId, SetupPrefixKey)` 只有一个 active promotion。旧 writer 在发布前失去 generation fence 后不得发布。staging scratch 始终 DestroyOnly。复制型 clone 验证独立后可释放 read lease；parent-backed clone 必须先登记 durable root，销毁并复核 Provider reference 消失后才能解除。

## DinD 捕获面

Docker DinD 的一个前缀必须原子包含 outer writable rootfs、私有 `/var/lib/docker` 和声明纳入的 volume。Provider 在捕获前完成 recipe、确认没有遗留进程或 inner container、优雅停止 inner dockerd/containerd、等待退出并 sync；随后排除 socket、PID、lock、网络 namespace、实例 identity 与 secret channel。

每个消费者取得私有 writable clone。只 `docker commit` outer container 会漏掉 inner data-root；复制运行中的 `/var/lib/docker` 会产生不一致状态；共享 writable upperdir 会破坏 Attempt 隔离。这些都不是合法前缀。Provider 无法完整、原子捕获时必须报告 Unsupported。

普通 callback before 截断整条共享捕获 lineage；后续 action 标记 `ineligible: opaque-ancestor`。callback、secret 与 external-I/O action 仍参与 DAG 调度。每个物理 Sandbox 可以另有私有 reset baseline，但 opaque state 不能登记为共享 prefix。sandbox reuse 下，secret overlay 由始终真实执行的 callback 注入，成功后通过 `context.onCleanup()` 登记移除；无法证明隔离时该组合在 planning 失败。

## SandboxStep 解释边界

core 统一解释封闭的 `SandboxStep` protocol，并通过私有窄目标调用标准 Sandbox operations。Action 定义者、recipe 与 step 都不能取得 Sandbox；Provider 也不解释 family 或 recipe，不得按 family name 分支。

Provider 只声明标准 operation 与 capture capability。core 从规范化 step 自动推导 operation requirements；全部 step 成功后，Provider 才负责 quiesce、capture 与 restore。Action 中途失败不发布内部半成品前缀。

step protocol 的解释语义由 `interpreterRevision` 标识，并进入 linked prefix 与 fingerprint。family `behaviorRevision` 只表达 family 自身无法从 canonical input、recipe 与身份查找结果看出的语义变化；纯重构或已经改变 emitted recipe 的修改不要求重复升级 revision。
