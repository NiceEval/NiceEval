# Architecture

## 三个身份各管一件事

Deployment identity 按固定顺序计算：

```text
resolve immutable inputs
  → DeploymentBaseKey
  → DeploymentKey + resolved manifest digest
  → CaseKey
  → Attempt fingerprint
```

`DeploymentBaseKey` 描述 staging 初态。它包含被选 template 或 build artifact identity、全部 BuildKey 与身份查找后的 published locator identity。

目标 OS/arch、运行用户、会改变可见初态的 mount/volume topology、Provider bootstrap/ready protocol revision 与 DeploymentStorageSchema revision 也进入该 key。

它不包含 instance locator、container/project name、lease、lifetime、CPU/memory 调度额度、credential value 或只影响 admission 的字段。

`DeploymentKey` 是以下 canonical manifest 的摘要：

```ts
interface DeploymentManifest {
  schemaVersion: number;
  deploymentBaseKey: string;
  commands: ReadonlyArray<{
    owner: "experiment" | "eval";
    id: string;
    behaviorRevision: string;
    recipeDigest: string;
    resolvedInputs: readonly JsonValue[];
  }>;
  provider: {
    family: string;
    materializationScopeId: string;
    target: { os: string; arch: string };
  };
  materializerRevision: string;
  storageSchemaRevision: string;
  artifactFormatRevision: string;
}
```

最终 CaseKey 与 Attempt fingerprint 包含 DeploymentKey 和经过身份查找的 manifest digest。cache policy、hit/miss/uncached、operation、entry、generation、locator 与 lease 不进入 CaseKey。carry 比较内容语义身份，不比较当前库存是否仍存在。

## Provider SPI

Provider 私有 binding 提供等价语义：

```ts
interface DeploymentMaterializer<Plan> {
  readonly capability:
    | { readonly cache: "unsupported" }
    | {
        readonly cache: "publish-and-clone";
        readonly storageSchemaRevision: string;
        readonly artifactFormatRevision: string;
      };

  lookup(plan: Plan, key: string): Effect<Hit | Miss | Unsupported, DeploymentLookupError>;
  createStaging(plan: Plan): Effect<StagingCase, DeploymentStageError, Scope>;
  quiesceAndPublish(staging: StagingCase): Effect<DeploymentArtifact, DeploymentPublishError>;
  instantiate(source: DeploymentArtifact): Effect<MaterializedSandboxCase, DeploymentInstantiateError, Scope>;
}
```

core 只看被闭包消去的 capability 与操作，不解释 Provider artifact。`Unsupported` 与 operational failure 是不同的 typed state。hit 与 miss 最终都收敛到 verified source → instantiate；只有 uncached fallback 使用 materialize final instance → deploy → ready。

没有 Deployment binding 的自定义 Provider 在 `preferred` 下走 uncached，在 `required` 下于静态 capability gate 失败。

## Storage schema 与 DinD

Provider 用版本化 `DeploymentStorageSchema` 声明 snapshot 捕获面，core 不猜目录。Docker DinD V1 把 outer writable rootfs、inner Docker data-root 和显式纳入的 volume 视为一个原子 snapshot。

发布前必须：

1. recipe 完成后进入 Provider-owned quiesce；
2. 确认没有遗留 recipe 进程或运行中的 inner container；
3. 优雅停止 inner dockerd/containerd，等待退出并 sync；
4. 原子捕获全部声明存储面；
5. 排除 socket、PID、lock、临时 secret channel、网络 namespace、locator 与实例 identity。

instantiate 为每个实例创建私有 writable descendants。只读 immutable parent 可以共享。交付前复核 manifest 与 artifact identity、可写 storage ownership、实例身份重建、网络重建、daemon ready 和一致性检查命令。只 `docker commit` outer container 或复制运行中 `/var/lib/docker` 都不满足协议。

Provider 无法原子捕获全部声明存储面时只能报告 Unsupported；不能发布近似 snapshot。artifact format、storage schema、quiesce 或 bootstrap 协议变化必须提升相应 revision。

## Cache、lease 与 invalidation

Deployment 使用 Provider cache 的 `sandbox-deployment` kind。它复用同一 registry、reservation、operation、generation fence、`published → indexed` 状态机和两阶段 GC，不建立 deployment 专用弱 registry。

```text
(domainAuthorityEpoch, entryId, operationId, entryGeneration, expectedState)
```

同一 `(domainId, DeploymentKey)` 只有一个 active slot。旧 writer 在 publish 前 CAS 失败后不得发布，其 staging 与未发布资源按 operation identity 回收。staging scratch 始终 DestroyOnly，不进入库存。

instantiate 结果声明依赖形态：

- `copied`：复制与验证期间持 read lease，独立后释放；
- `parent-backed`：先为实例建立 durable root，再释放短 lease；实例销毁并复核 Provider reference 消失后解除 root。

lease、durable root、clone、mount、snapshot parent、Provider reference 或 `unverified` 事实均否决 GC。

Provider 用结构化 scope 报告失效：

```ts
type DeploymentInvalidation =
  | { scope: "clone"; cloneId: string }
  | { scope: "generation"; entryId: string; generation: number }
  | { scope: "domain"; domainId: string };
```

完整 copy 且已经验证独立的实例不因 parent generation 失效而误退役。parent-backed 实例按 Provider 安全判断退休。任何 scope 都停止相应的新 acquire，但不永久毒化 DeploymentKey；reconcile 可以在确认旧 holder 与引用结束后创建新 generation。
