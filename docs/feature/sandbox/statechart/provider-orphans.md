# Provider 创建应答丢失与孤儿回收

服务端分配实例与客户端拿到实例 ID 是两件事：创建应答可能丢失，客户端进程可能在应答到达前退出，实例可能在客户端结束后才落地。这一页用模型检查器核对这些情况下实例仍能被回收，规则来自 [Sandbox 生命周期](../architecture/lifecycle.md)与 [Instabox](../architecture/providers/instabox.md)。

## 规则

### 没有找不到的孤儿 {#NoUnknownOrphan}

客户端结束后仍存活的实例，至少带可查的标签、已请求的服务端硬 TTL，或仍有针对它的 stop 在途。

### 迟到的 stop 只作用于原实例 {#StaleStopLeavesSuccessor}

原进程迟到的 stop 只影响它自己创建的实例 ID，不影响别的进程随后创建的实例。

### 服务端到期最终回收 {#ReleasedEventually}

服务端会兑现硬 TTL 时，每个实例最终经正常收尾或到期被销毁。

### 带标签的实例最终可以找到 {#DiscoverableEventually}

请求结算后，剩下的实例都能按标签查到，由有权限的操作者或 CI 用 Provider 的原生工具删除。

### 确认旧实例处置后才重建 {#RetryRequiresReconciliation}

Instabox 只有在首次创建被明确拒绝且可重试，或已确认旧 Machine 删除后，才用新的幂等键重新创建；处置不明时客户端退出这次准备，可能存在的 Machine 交给服务端到期回收。

## 模型

```statechart spec="../tla/provider-orphans/cloud-one/Provider.tla" config="../tla/provider-orphans/cloud-one/resource-cloud-one.cfg" view="../tla/provider-orphans/cloud-one/view.ts" out="../tla/provider-orphans/cloud-one/out/resource-cloud-one" digest="sha256:98a9b329b0946d86bcb3cb9e630949696c8e101ac6571b04d7c842f14b1ad756"
```

```statechart spec="../tla/provider-orphans/labelled-two/Provider.tla" config="../tla/provider-orphans/labelled-two/resource-labelled-two.cfg" view="../tla/provider-orphans/labelled-two/view.ts" out="../tla/provider-orphans/labelled-two/out/resource-labelled-two" digest="sha256:919c85e32179ab27399ee1d708dae750d1704d34e235b4b634699863050a4e7f"
```

```statechart spec="../tla/provider-orphans/instabox/InstaboxRetry.tla" config="../tla/provider-orphans/instabox/instabox-confirmed.cfg" view="../tla/provider-orphans/instabox/view.ts" out="../tla/provider-orphans/instabox/out/instabox-confirmed" digest="sha256:3326edff1299365c6b230eb8e8fe14f2e9448f9e9db4aea9364512f5f102d2d3"
```

三块依次是：带硬 TTL 与标签的云端 Provider（一个进程）、只带可查标签的本地 Provider（两个进程，含迟到 stop）、Instabox 的重建门槛。各自的规则都成立。第二块的状态数超过图的规模上限，只显示检查报告。

既没有硬 TTL、也没有可查标签的自定义 Provider 不在保证范围内：[生命周期](../architecture/lifecycle.md)把这两项能力交给 Provider 作者，Run 恢复不负责物理回收。

## 动作与代码

路径以 `packages/niceeval/src/` 为根。

| 动作 | 代码 |
| --- | --- |
| 发出创建 | `sandbox/runtime.ts` 的 Docker、E2B、Vercel 与自定义入口 |
| 服务端分配 | `sandbox/e2b.ts` 带 metadata 与寿命创建；`sandbox/docker.ts` 带标签创建 |
| 拒绝、应答丢失 | `sandbox/retry.ts` 的边界分类；`sandbox/e2b.ts` 的创建歧义 |
| 拿到实例、登记收尾 | `sandbox/runtime.ts` |
| 按标签对账删除 | `sandbox/retry.ts`；`sandbox/e2b.ts`；`sandbox/docker.ts` |

Instabox 的同键重取、确认删除后新建与处置不明时不新建由 `test/integration/instabox-provisioning.test.ts` 回放。

## 模型没有覆盖的部分

Provider 是否真的兑现 TTL、真实远端 Provider 的行为、残留实例的人工治理，以及 Docker、E2B 之外各 Provider 的细节。
