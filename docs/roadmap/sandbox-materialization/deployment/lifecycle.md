# Lifecycle

## Planning 与调度

```text
pure link
  → static deployment capability gate
  → immutable input resolution
  → DeploymentKey
  → BuildKey ready
  → deployment lookup / single-flight
  → verified source
  → per-consumer instantiate
  → provider admission queue
  → Attempt start
```

`required` 的静态 capability mismatch 在文件读取、网络、Sandbox 创建与模型调用前失败。capability 通过后，immutable input resolution 可以进行已授权的网络读取；身份查找失败属于 identity-resolution failure。

`--dry` 完成 capability gate、immutable input resolution、DeploymentKey、CaseKey 与 fingerprint 计算，因此可以访问声明过的身份查找器网络边界。它不 lookup cache、不取得 lease、不创建 staging 或 Sandbox。

Build 与 Deployment 是两级协调 DAG。Deployment query、wait 与 lease acquire 不占 Deployment 或 Attempt permit；只有实际 staging 占独立的 `maxDeploymentConcurrency`，默认 1。Library 与 CLI 分别使用 `maxDeploymentConcurrency` 和 `--max-deployment-concurrency`。长操作不持 registry transaction、Domain 全局锁或 Attempt permit。

per-consumer instantiate 进入 Provider admission queue。取得 profile reservation 前，Attempt 始终是 queued，并显示具体 queue reason；只有 reservation granted 后才发出 Attempt start 和 `creating sandbox`。这条规则也适用于普通 Docker profile 容量等待，不允许等待者占住其它 Provider 可用的 dispatch worker。

## Physical lifecycle

```text
immutable Deployment artifact
  → instantiate private physical instance
  → provider ready
  → setup / checkpoint restore
  → establish physical-lifecycle reset baseline
  → Attempt reset + prepare + Agent
  → teardown / checkpoint archive
  → destroy instance
```

Deployment publish 永远发生在任何 `.setup()` 前。`.setup()` 与 `.teardown()` 不写回共享 artifact。开启 Sandbox reuse 后，reset 恢复本物理实例自己的 post-setup baseline，或用等价机制保护 lifecycle-owned state；它不能回到共享 Deployment artifact 后抹除 checkpoint。

Deployment 没有作者 teardown 或 cleanup API。Provider 整组拥有 staging、quiesce、publish 与失败资源终结。

## 失败与 fallback

| 事实 | `preferred` | `required` |
|---|---|---|
| 静态 Unsupported | 每物理实例 uncached deploy，并明确显示 | planning fail |
| lookup/control-plane 暂时不可用 | diagnostic + uncached | fail |
| hit identity/manifest 不符 | 隔离 generation 并重新部署 | 重新部署；无法取得 verified artifact 则 fail |
| recipe/quiesce/secret isolation/ready 失败 | fail | fail |
| publish/index 失败 | 释放资源或 durable 交给 reconcile；安全重试一次，仍失败则 diagnostic + uncached | fail |
| instantiate/clone 验证失败 | 按 scope invalidate 并重新部署；再次失败则 fail | 同左，最终必须取得 verified artifact |

uncached 指在每个最终物理实例上执行 DeploymentCommand，再 ready、setup。staging Case 不能成为 Attempt 实例。publish fallback 只有在旧 staging 与资源已回收或 durable 交给 reconcile 后才开始。

## 取消与恢复

- 仍有 waiter 时，单个 waiter 取消不取消共享 operation。
- 最后一个 waiter 在 prepared resource 产生前取消时，协作取消 recipe、销毁 staging/scratch，并把 entry 标为 abandoned。
- Provider resource 已创建但未 durable 登记时，按 operation label 回收；无法证明归属则成为 `owned-claim-unverified`。
- prepared identity 已 durable commit 后，有界完成 publish/index 或交给 reconcile，不伪装成原子回滚。
- Run 取消后不放行 Attempt，也不让无界后台任务拖住进程。
- 取消、超时与崩溃不提升 generation；只有 reconcile 确认旧 holder 结束且无活跃引用后才能 takeover。

## 可观测状态

PLAN、debug、Human 与 JSON progress 区分 `resolving`、`querying`、`hit`、`queued`、`deploying`、`quiescing`、`publishing`、`instantiating`、`uncached`、`ready` 与 `failed`。cache policy、source、operation 和命中事实进入 Record/Observability provenance，但不进入 CaseKey。

等待 Deployment single-flight 或 Provider capacity 的 Attempt 保持 queued，并携带 `deployment` 或 `provider-capacity` reason。顶部 queued/running 汇总与逐 Attempt 状态来自同一 reducer 事实，不能把尚未获得 reservation 的 Attempt 计为 running。
