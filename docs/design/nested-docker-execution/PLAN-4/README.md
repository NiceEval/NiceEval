# PLAN-4 —— 直接绑定托管 Sandbox Provider

## 调用面

Experiment 直接选择一个经过认证的托管 Provider。Runloop 是首个 PoC 对象：

```ts
const GiB = 1024 ** 3;

runloopSandbox({
  blueprint: "niceeval/docker-execution-v1",
  resources: {
    cpus: 4,
    memoryBytes: 6 * GiB,
    dockerDataBytes: 4 * GiB,
  },
  networkPolicy: "eval-default",
});
```

Provider factory 同时绑定远端账号、region、Blueprint/snapshot 与 Sandbox origin。Eval 作者不操作
宿主 storage，但 Experiment 仍绑定产品名。

## 架构

托管服务拥有 VM/Devbox、disk snapshot、mount、daemon runtime、network 与 physical recovery。
NiceEval adapter 拥有 API credential binding、capability negotiation、durable remote locator、lease、
fencing、retry 和 detached destroy。Agent 只在远端 Sandbox 内看到 Docker socket。

Provider 必须提供 list/inspect/destroy 或等价 inventory。只提供“create 后拿到临时 client”的 SDK
不合格，因为 CLI 强杀后 NiceEval 无法从 metadata 找回 orphan。

## 缓存

Blueprint 保存可重复构建的基础工具；Provider disk snapshot 捕获 verified SetupPrefix；每条 Attempt 从
snapshot 创建私有 Devbox。OCI/BuildKit cache使用项目隔离的远端 registry。snapshot 是否包含 inner
Docker data、怎样 quiesce 和怎样限制 4 GiB，全部必须由 adapter PoC 取得 receipt，不能由产品名推断。

## 生命周期与恢复

NiceEval 在远端 create 前写 allocation intent，把 allocation id、Attempt id、generation 与 artifact
identity写入 Provider metadata。ready 必须验证专用 daemon、Compose、容量和 isolation。cleanup 先 fence
command channel，再调用 detached destroy并等待 Provider 确认资源不存在。

网络错误发生在 create 受理边界时，adapter 先按 idempotency key 和 inventory 查询，不能直接重发 create。
CLI 强杀后 reconciler 重新取得远端 client并按 metadata 枚举。旧 Attempt 标记 environment incomplete；
新 Invocation 不接管同一 Devbox继续跑 Agent。

错误至少区分 `provider-auth-failed`、`provider-capacity-unavailable` 与
`create-acceptance-unknown`。还要区分 `remote-artifact-unverified`、`remote-allocation-lost` 与
`destroy-incomplete`。Provider 无法证明 inventory 时停止该 Provider 的新 admission，
不回退本地 Docker。

## Cases

C1、C3、C5 与 C11 需要真实付费 PoC；不能只用 SDK fake。C2 要验证 remote disk hard limit，而不是
NiceEval 本地计数。C4 要创建 A/B 并从 B 主动枚举 Docker 和 workspace。C6 主要是 NiceEval control
process recovery，不依赖 NixOS mount。C10 天然满足，因为 Provider 不读取本地旧 pool。

## 评价

托管方向删除最多 host 复杂度，并把 capacity 扩展交给供应商。代价是凭据、费用、数据驻留、网络可用性、
API lock-in 和外部服务故障。它适合作为正式 Provider，但不应成为唯一产品语义，也不能替代 NixOS 自托管
验收。
