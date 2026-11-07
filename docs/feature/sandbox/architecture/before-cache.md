# Before cache —— 身份、Provider 能力与降级

Before cache 让声明式 before action 形成内容寻址的前缀：命中时恢复经过验证的状态，不调用 action；未命中或不支持时真实执行同一 action。作者侧声明见 [Sandbox Layer](../library/layers.md)，运行时序见 [三方准备时序](lifecycle.md#before-缓存的运行时序)。

本页定义所有 Provider 共用的规则：BeforeCacheKey 与 `verified` 的含义、Provider 能力分类、失败时如何降级，以及运行事实归谁。E2B、OpenSandbox 与 Instabox 的远端 snapshot 契约见 [远端 snapshot Before cache](remote-snapshot-cache.md)，持久账本见 [Data Model](../data-model.md)。

## 它解决什么

一段 before 准备（拉取仓库、安装依赖）每次都真实执行，昂贵又重复。Before cache 把它的结果保存成不可变 artifact，下次直接从这里开始：

| 故事 | 要求 |
|---|---|
| [RUN-9](../../../user-story.md) | 一批并发 Attempt 第一次运行就只准备一次 |
| [RUN-10](../../../user-story.md) | 改了一步，只重做这一步及之后 |
| [OPS-6](../../../user-story.md) | 缓存出问题只变慢，不出错（[T-5](../../../taste.md#t-5)） |
| [OPS-7](../../../user-story.md) | NiceEval 创建的 artifact 都有登记、可回收 |
| [OPS-8](../../../user-story.md) | 同一份 before 声明在所有 Provider 上运行，运行前看得到能加速到什么程度 |

## 整体结构

自上而下分四层，每层只依赖下一层的契约：

```text
Runner         按 BeforeCacheKey 编排：准备图 / Attempt 内 restore·capture / 真实执行
  │  只看能力标签，不按 Provider 名称分支
Provider 能力  SandboxBeforeCacheSupport
  ├─ RunPrepared      ── BeforeCachePreparer ──┬─ Incus：自己实现，自己的账本
  │                                            └─ remoteSnapshotPreparer（core）
  │                                                  账本 · lease · hold · 标记 · 降级 · 回收
  │                                                  │
  │                                                  └─ BeforeCacheSnapshotDriver：E2B / OpenSandbox / Instabox
  ├─ AttemptCaptured  ── AttemptBeforeCache（由实例交出）：Docker / Docker Profile
  └─ Unsupported      ── 真实执行：Vercel / defineSandbox()
Provider API   template、image、snapshot、实例
```

一次 Run 的路径：

1. link 把每个配对的 before 编译成 occurrence，并为 eligible action 计算链式 BeforeCacheKey（见[身份与验证边界](#身份与验证边界)）。
2. `RunPrepared` 配对合并成准备图，在派发 Attempt 前逐节点 lookup 或准备；`AttemptCaptured` 与 `Unsupported` 配对跳过这一步。
3. 派发后，每个 Attempt 从自己链上最深的可用 artifact 创建实例，或在实例里 restore；没有命中的 action 真实执行。
4. 每个 eligible action 的反馈是 `hit`、`replay`、`unsupported` 或 `degraded` 之一；任何缓存故障都落在 `degraded`，不让 Attempt 失败。

## Provider 能力

Provider 按能力而非名称进入准备路径。三种能力按“谁负责准备”区分：

- `RunPrepared`：Run 负责准备。派发任何 Attempt 前，Run 按完整 BeforeCacheKey 建立准备图，相同 key 在一个 Run 内只准备一次；每个 consumer 从不可变 artifact 创建独立 writable state。
- `AttemptCaptured`：每个 Attempt 在自己的实例里 restore 或 capture，artifact 跨 Invocation 持久。同一 Run 内相同 key 的并发 Attempt 不合并，没拿到 publication 的 Attempt 继续 uncached。
- `Unsupported`：真实执行。

不存在“只在本 Invocation 内有效”的第四类：这种恢复不能证明跨 Planned attempt 的 artifact 身份，Provider 只能做到这一点时声明 `Unsupported`。

远端 Provider 按实例时长和配额计费，第一次运行的并发 Attempt 各自执行，正好错过使用云 Provider 的主要理由，所以声明 `RunPrepared`。本地 Docker 的 capture 只花本机资源，声明 `AttemptCaptured`，免去派发前的等待。

### 声明即实现

Provider module 用一个带判别标签的值声明能力，声明某种能力时必须同时交出它需要的实现（[T-6](../../../taste.md#t-6)）：

```typescript
type SandboxBeforeCacheSupport<Plan> =
  | {
      readonly _tag: "RunPrepared";
      readonly coverage: SandboxActionState;
      readonly preparer: BeforeCachePreparer<Plan>;
    }
  | { readonly _tag: "AttemptCaptured"; readonly coverage: SandboxActionState }
  | { readonly _tag: "Unsupported"; readonly reason: string };

interface SandboxProviderModule<Plan> {
  // 其余成员见 [Case](case.md)
  readonly beforeCache: SandboxBeforeCacheSupport<Plan>;
}
```

- `AttemptCaptured` 的实现作用于已创建的实例，所以由实例交出：声明 `AttemptCaptured` 的 module 的 `materialize` 返回类型带必填的 `attemptBeforeCache: AttemptBeforeCache`，其它 module 不带。缺失时无法通过类型检查，Runner 不在运行时跳过。
- 发布出去的 plan 只带静态投影 `SandboxBeforeCacheCapability`：`RunPrepared` 与 `AttemptCaptured` 保留 `coverage`，`Unsupported` 保留 `reason`，不带实现。投影由 core 从 module 派生，Provider 不另写一份。
- `niceeval debug` 的 `capability` 取 `run-prepared | attempt-captured | unsupported`，与三种能力一一对应。

`AttemptCaptured` 的实现作用于当前 Attempt 的实例：

```typescript
interface AttemptBeforeCache {
  /** 运行期资格；例如 Docker Profile 的共享 allocation 在这里报 Unsupported。 */
  eligibility(): BeforeCacheEligibility;
  /** 命中时把本实例换成从 artifact 恢复的私有实例。 */
  lookupAndRestore(step: BeforeCacheStep): Effect.Effect<AttemptBeforeCacheLookup, BeforeCacheError>;
  /** action 成功后捕获；失败时返回 ContinuedUncached，绝不重放已成功的 action。 */
  capture(step: BeforeCacheStep): Effect.Effect<AttemptBeforeCacheCapture, BeforeCacheError>;
  /** 只在本 Attempt 还没有任何 action 成功时可用：丢弃恢复失败的实例，最多一次回到 Base。 */
  fallBackToBase(): Effect.Effect<AttemptBeforeCacheFallback, BeforeCacheError>;
}
```

`RunPrepared` 的实现是 Run 级 preparer：

```typescript
interface BeforeCachePreparer<Plan> {
  /** 节点发布后 staging 是否还能接着执行下一个 action；为 true 时 Runner 把它交给一个子节点，不新建实例。 */
  readonly continuesStaging: boolean;
  /** 只读；可以为解析不可变 Base 做认证后的网络请求，不得创建或修改资源。 */
  readonly eligibility: (
    plan: Plan,
    context: BeforeCachePreparationContext,
  ) => Effect.Effect<BeforeCacheEligibility, BeforeCacheError>;
  /** 命中时在调用方 Scope（Run）上持有 artifact，Scope 关闭时释放。 */
  readonly lookup: (
    plan: Plan,
    context: BeforeCachePreparationContext,
    stepsDeepestFirst: readonly BeforeCacheStep[],
  ) => Effect.Effect<BeforeCacheLookup, BeforeCacheError, Scope.Scope>;
  /** 创建 staging 或 consumer。staging 从 Base 创建时也经过这里；artifact 不可用时最多回退一次到 Base。 */
  readonly materializeFrom: (
    plan: Plan,
    context: BeforeCachePreparationContext,
    /** staging 由 Run 的准备图创建；consumer 由 Attempt 或复用池创建。 */
    purpose: "staging" | "consumer",
    source: BeforeCacheSource,
    materialize: SandboxRuntimeMaterializeContext,
  ) => Effect.Effect<BeforeCacheMaterialized, SandboxRuntimeMaterializationError, Scope.Scope>;
  readonly capture: (
    plan: Plan,
    context: BeforeCachePreparationContext,
    staging: MaterializedSandboxCase,
    step: BeforeCacheStep,
  ) => Effect.Effect<BeforeCacheCapture, BeforeCacheError, Scope.Scope>;
}

/** core 在调用时传入；Provider 不自报身份。 */
interface BeforeCachePreparationContext {
  /** Provider module 的 `id`。 */
  readonly providerId: string;
  readonly runId: string;
  /** 由 core 从 module 的 `materialize` 绑定：从 Base 创建实例。 */
  readonly materializeBase: (
    materialize: SandboxRuntimeMaterializeContext,
  ) => Effect.Effect<MaterializedSandboxCase, SandboxRuntimeMaterializationError, Scope.Scope>;
}

type BeforeCacheSource =
  | { readonly _tag: "Base" }
  | { readonly _tag: "Artifact"; readonly artifact: BeforeCacheArtifact };

interface BeforeCacheStep {
  readonly operationId: string;
  readonly declaration: BeforeCacheDeclaration;
  /** Base 之后到本节点每一层的 action id，按顺序排列；只用于远端 snapshot 的 replacement scope。 */
  readonly positions: readonly string[];
  /** 纵深防御用；只在发布前比较，从不持久化。 */
  readonly knownSensitiveValues?: readonly string[];
}

type BeforeCacheLookup =
  | { readonly _tag: "Miss" }
  | { readonly _tag: "Hit"; readonly artifact: BeforeCacheArtifact }
  /** 缓存帮不上忙，例如账本不可用；节点结算为 degraded。 */
  | { readonly _tag: "Degraded"; readonly reason: BeforeCacheDegradedReason; readonly detail: string };

type BeforeCacheMaterialized =
  | { readonly _tag: "Materialized"; readonly sandbox: MaterializedSandboxCase; readonly start: BeforeCacheStart }
  /** 只在 `purpose` 为 `staging` 时返回：缓存帮不上忙，节点结算为 degraded。 */
  | { readonly _tag: "Degraded"; readonly reason: BeforeCacheDegradedReason; readonly detail: string };

type BeforeCacheCapture =
  | { readonly _tag: "Published"; readonly artifact: BeforeCacheArtifact }
  | { readonly _tag: "Degraded"; readonly reason: BeforeCacheDegradedReason; readonly detail: string };

type BeforeCacheDegradedReason =
  | "eligibility-failed" | "ledger-unavailable" | "staging-failed" | "parent-unavailable"
  | "base-image-unverified" | "mounted-state" | "sensitive-state"
  | "snapshot-rejected" | "snapshot-uncertain" | "lease-lost";
```

`lookup`、`materializeFrom` 与 `capture` 返回 `Degraded` 时节点结算为 `degraded`；返回错误时节点结算为 `failed`。Runner 只看这个结果，不按 Provider 名称或错误的 cause 区分。consumer 的 `materializeFrom` 自己处理回退，Base 也创建失败时返回错误，Attempt 按普通实例创建失败处理。远端 snapshot preparer 把它能识别的全部缓存故障映射为 `Degraded`；Incus 按自己的 fail-closed 边界返回错误。原因的含义见[远端 snapshot 的节点结算](remote-snapshot-cache.md#run-级节点结算)。

Incus 直接实现这个接口并保留自己的账本。E2B、OpenSandbox 与 Instabox 只交出 `BeforeCacheSnapshotDriver`，由 core 的 `remoteSnapshotPreparer(driver)` 实现，见 [远端 snapshot Before cache](remote-snapshot-cache.md#协议归-coreprovider-只交原语)。

| Provider / case | capability | 前缀路径与边界 |
|---|---|---|
| 普通单容器 Docker，全部可变状态在 outer writable rootfs | `AttemptCaptured` | 每 Attempt 使用已验证 exact image 的私有 writable container；不进入准备图。 |
| Docker Profile，具备已验证的独立 fixed-image allocation | `AttemptCaptured` | 只能保存 capability receipt 声明的状态面（例如 `dockerData`）；shared loop/project-quota allocation 在运行期报 `Unsupported`。 |
| `incusSandbox()` nested Docker | `RunPrepared` | 发布完整、quiesced 的 prepared artifact；每个 Attempt clone 私有 writable root 与 Docker data disk。 |
| E2B | `RunPrepared` | Base 是 template 引用当前指向的 build；full snapshot。见 [远端 snapshot Before cache](remote-snapshot-cache.md#e2b)。 |
| OpenSandbox | `RunPrepared` | digest-pinned Base 的 rootfs snapshot；不包含进程、卷或 tmpfs。见 [远端 snapshot Before cache](remote-snapshot-cache.md#opensandbox)。 |
| Instabox | `RunPrepared` | 固定 Base snapshot 之上的 root 与 `/data` 磁盘 snapshot。见 [远端 snapshot Before cache](remote-snapshot-cache.md#instabox)。 |
| Vercel Sandbox | `Unsupported` | 不声明可验证的 before-cache capture/restore coverage，真实执行。 |
| `defineSandbox()` custom provider | `Unsupported` | NiceEval 不以结构探测推断能力。 |

bind mount、tmpfs、Compose sidecar、host socket、raw / managed DinD、privileged outer container与无法完整捕获的 inner data-root 都不能冒充上述 capability。secret、runtime overlay、workspace、Attempt locator 与外部会话不进入可发布 artifact。

## 身份与验证边界

Base 之后每个 eligible before action 都产生链式内容身份：

```text
BeforeCacheKey[i] = hash(
  provider + planner revision + exact Base image identity,
  BeforeCacheKey[i - 1],
  action id + family,
  declared state + cumulative state,
  canonical input + automatic fingerprint + optional supplemental fingerprint,
  canonical steps digest + immutable input identities,
  typed capability edges (requires / provides),
  target platform + execution user,
  preparation identity + format revisions
)
```

声明方、声明方内序号、拓扑顺序、`changeFrequency` 与显式依赖只决定 action 的排列，不进入 key：内容相同的准备层在不同 Experiment、Eval 或 Plugin 之间共用同一份 artifact，不因出处被拆成多份。

action fingerprint 固定为 `hash(auto, supplemental)`。`auto` 包含 family id、canonical input、规范化 `sandboxStep`、声明 state 与 immutable content identity；`cache.fingerprint` 只提供 `supplemental`。parent key 防止相同 action 从不同 Base 或祖先状态错误复用。

exact Base image identity 必须是 Provider 承诺不可变的内容身份：Docker image ID、digest-pinned OCI image、Incus image fingerprint、Instabox snapshot ID 或 E2B template build ID。声明只给出可移动引用（tag、template 名、未 pin 的 image）时，Provider 必须在计算 key 前查出它当前指向的不可变身份，并在实例 ready 后确认实例来自同一身份。查不到时报 `base-image-unverified`，该配对真实 replay；前后不一致时不发布。不能用引用字符串代替内容身份：同名引用指向新内容后，旧前缀会在新 Base 上错误命中。

BeforeCacheKey 不包含 cache lookup 结果、本地 image/container locator、Attempt UUID、调度额度或运行时 secret。Eval `test`、Assertion 和 Agent/test 阶段的输入变化也不进入未改变的 BeforeCacheKey。它们仍按各自 owner 改变 Attempt 与结果 identity；BuildKey 只由构建输入决定。

`verified` 只有三项含义：

1. 声明（`BeforeCacheDeclaration`）、BeforeCacheKey 与 provider artifact identity 双向一致；artifact receipt 使用 provider-neutral id，不把 provider locator 当 portable identity。
2. Provider artifact 包含 action 声明 state 的全部结果；普通 Docker 是 outer writable rootfs，Incus 是完整、quiesced 的 prepared Sandbox artifact。
3. 每个消费者从 immutable artifact 创建独立 writable state，不共享 writable layer 或 Docker data allocation。

`verified` 不证明 action 业务语义正确，也不证明任意 shell、网络、时钟或随机读取具有确定性。`defineSandboxAction()` 是作者对确定性的承诺。普通 JSON 与文本由作者声明为非敏感；已知 `Secret`、credential handle 与 runtime binding 在 planning 拒绝。发布前对框架已知 secret bytes 的扫描只做纵深防御。

## 失败与降级

lookup 或 restore 在 action 执行前失败时，Runner 忽略不可验证的候选，并最多一次从更短的 verified prefix 或 Base 创建干净容器。该 Attempt 的剩余 action 真实 replay，运行反馈为 `degraded`。无法建立干净容器时，Attempt 失败。

action 成功后 capture 失败时不得再执行该 action。当前容器仍完整时，它可以继续 uncached；已无法证明完整时，Attempt 失败。任何部分恢复或部分 capture 都不会冒充 hit，也不会形成循环 cache retry。

远端 snapshot Provider 的 Run 级节点遵守同一原则（[T-5](../../../taste.md#t-5)）：只有 author action 在 staging 中失败时节点才是 `failed`，依赖它的配对在派发前失败。其余不能发布的情形都让节点 `degraded`：目标配对从链上最深的可用祖先开始，其余 eligible action 在 Attempt 内真实执行。远端 Provider 的结算表见 [远端 snapshot Before cache](remote-snapshot-cache.md#run-级节点结算)。Incus 保留 [Nested Docker Architecture](../../sandbox-nested-docker/architecture/README.md) 规定的 fail-closed 边界：它的 VM、disk 与 artifact 归属由 Incus repository 判定，账本或 publication 不能证明一致时节点 `failed`。

取消只回收当前 private staging 与 Attempt 资源，不回滚已经完成验证并发布的 immutable Before cache artifact。下一次 Invocation 仍从最深 verified prefix 继续：取消时正在执行或尚未发布的 action 必须重新执行；已经发布的祖先 action 不得因取消而从 Base 重新执行。某个中间 action 的 canonical input、fingerprint、依赖或顺序变化时，它之前未变化的最长 verified prefix 继续命中，从该 action 起的变化层与全部后缀重新执行和发布。

opaque callback、`defineSandboxCommand()`、runtime secret overlay、租约、外部会话与当前 Attempt locator 都是 barrier。barrier 之前的最长 verified prefix 仍可命中；barrier 之后的 action 真实执行，但不能发布共享前缀。

每个 Before cache artifact 还保存 replacement scope：除 parent key 与 revision 之外的完整累计声明。不同 canonical input、fingerprint、steps、依赖、能力或顺序形成不同 replacement scope，对应 artifact 可同时命中。

同一 replacement scope 的新 generation 发布后，NiceEval 才淘汰已被替代的 Docker image 或远端 snapshot。仍被 private clone、hold、lease 或未完成 capture 使用的旧 generation 不会删除。最后一个 hold 释放后再次尝试淘汰。

generation 是 cache repository 内全局递增的整数，含义保持「已分配的最大值 + 1」。分配与 reserve 在同一个 immediate 写事务中完成。
repository schema 为 generation 建立索引，分配只读索引端点，成本不随已保留或已 tombstone 的 entry 数增长。
索引随 UserDatabase 的应用级相邻迁移进入，不在已存在的库上临时创建。

删除失败保留登记并重试，不按年龄、名称或“不在当前 Run”猜测垃圾。用户声明的 image、template 与 snapshot 永不由 NiceEval 自动删除。作者可见的运行开关只有 `sandboxCache.before: "use" | "bypass"` 和对应 CLI flag。

## 运行事实归属

`RunPrepared` 的准备图按完整 `BeforeCacheKey` 合并节点，每个节点在一个 Run 内只准备一次。相同 key 的多个 Eval×Experiment 配对共享这次准备；节点的 activity、staging、publication 与 Scope 归 Run，不归任何 Attempt。

不同 key 可在 `maxBeforeCacheConcurrency ∩ provider scheduling.lane.limit` 内并行。相同 `(executionDomainId, BeforeCacheKey)` 仍通过跨进程 publication lease 串行发布，等待者消费同一 committed `ArtifactIntent`。

Run 保留全局 pre-dispatch barrier：准备图的所有节点结算后才派发 Attempt。一个 `failed` 节点只阻断其 descendants 和依赖该 terminal prefix 的 Planned attempts：它们记为 `not-dispatched`，原因由关联其 slot 的 `sandbox-before-cache-failed` Run 级诊断说明，不伪造 `errored` Attempt（见[执行失败分类 · 止损语义](../../error-classification/README.md#止损语义)）；`degraded` 节点不阻断，目标配对改从更浅的可用前缀开始。其余分支照常结算。取消停止并回收未结算节点的 staging 与 publication，但不回滚已验证发布的 immutable artifact。

`AttemptCaptured` 与 `Unsupported` 的 lookup、restore、replay、satisfaction 与 cleanup 归各自 Attempt，不因 key 相同共享 activity、locator 或可写状态。

无论能力类别，持久 artifact receipt 都只保存 provider-neutral artifact id、BeforeCacheKey、声明、execution domain 与必要的验证 revision。它不保存本地 image/container/snapshot locator、credential value、secret bytes 或 Attempt locator。

Attempt locator 只在全局 barrier 后实际 dispatch 时由当前 `RecordWriteSession` 分配；从调度、收尾反馈到 Record 提交始终使用同一个值。未派发 Planned attempt、queued prefix node 与 Run activity 都不制造 locator。

静态 `niceeval debug` 不读取 cache，固定输出 `cacheLookup: "not-probed"`。运行反馈的闭合结果只有 `hit`、`replay`、`unsupported` 与 `degraded`；`replay` 另带 `miss | bypass` reason。Record 不保存本地 image/container locator、credential value 或 secret bytes。

nested Docker 的 artifact、domain 与 fail-closed 边界见 [Nested Docker Architecture](../../sandbox-nested-docker/architecture/README.md)。原 Docker Profile 路径的最终迁移边界见 [Docker 执行配置](../../sandbox-docker-profiles/README.md)。
## 名字与哈希内容

代码与文档使用同一组名字：概念是 Before cache，类型、字段、表、诊断值与活动名都从它派生，例如 `BeforeCacheKey`、`BeforeCacheStep`、`BeforeCacheDeclaration`、`before_cache_key`、`before-cache.restore` 与 `sandbox.before-cache.prepare`。

协议串、`declarationMetadata` 的 JSON 字段与 Provider 对象上的标记同样使用这组名字，例如 `niceeval.before-cache-key/v1`、`niceeval.before-cache-declaration/v1`、`niceeval.before-cache-replacement/v1` 与 Docker image label `user.niceeval.beforeCacheKey`。

这些内容只决定缓存能否命中。它们变化时，已有 Before cache 全部 miss，下次运行时重新准备一次。

Provider plan 的 execution identity 不包含 `beforeCache` 能力：缓存只让运行变快，不改变结果（[T-5](../../../taste.md#t-5)），换一种准备路径不应让已有结果失效。把它移出 identity 改变了 digest，按 [NiceEval 身份域变更](../../experiments/architecture/cache.md#niceeval-身份域变更) 登记为 `encoding-only`，下游无需重跑。

