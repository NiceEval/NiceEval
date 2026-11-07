# 远端 snapshot Before cache

E2B、OpenSandbox 与 Instabox 把 before 前缀发布为远端 snapshot，以 `RunPrepared` 能力进入 Run 级准备图。
本页定义 core 拥有的远端 snapshot 协议、Provider 交出的原语、Run 级节点结算，以及各 Provider 的身份与捕获差异。
BeforeCacheKey、能力分类与降级的通用规则在 [Before cache](before-cache.md)；准备图的时序在 [三方准备时序](lifecycle.md#before-缓存的运行时序)；账本的表结构在 [Data Model](../data-model.md#远端-snapshot-账本)。

## 服务的用户故事

| 故事 | 本页的回答 |
|---|---|
| [RUN-9](../../../user-story.md) 第一次运行就只准备一次 | 准备归 Run：相同 BeforeCacheKey 在一个 Run 内只准备一次，Attempt 派发后都从同一份 snapshot 创建实例 |
| [RUN-10](../../../user-story.md) 改了一步准备，只重做这一步及之后 | 每个 action 一个节点、一份 snapshot；未变化的最长前缀继续命中 |
| [OPS-6](../../../user-story.md) 准备结果出问题只变慢，不出错 | 只有 author action 失败让配对失败；其余故障都让节点降级，配对在 Attempt 内真实执行 |
| [OPS-7](../../../user-story.md) 云账号里不留来历不明的快照 | 每份 NiceEval 发起的 snapshot 在请求前登记；结果不确定的请求按名字回收；按 domain 隔离；从不删除用户声明的 Base |
| [OPS-8](../../../user-story.md) 换云服务不用改准备写法 | 同一份 before 声明在所有 Provider 上运行；`niceeval debug` 显示 `run-prepared` |

## 为什么由 Run 准备

远端 Provider 按实例时长和配额计费。若准备归各自 Attempt，第一次运行的 N 个并发 Attempt 都会 miss 并真实执行同一段 before：一个发布，其余因 publication 竞争继续 uncached。命中只发生在下一次 Invocation，正好错过 RUN-9。

三个 Provider 都满足 `RunPrepared` 的条件：snapshot 一经 Ready 即不随源实例变化；staging 可以从 exact Base 或父 snapshot 创建；每个 consumer 从 snapshot 创建独立实例，不共享可写状态。

## 协议归 core，Provider 只交原语

账本、lease 与接管、artifact 标记的写入与校验、挂载与敏感字节检查、quiesce、consumer 回退和回收对三个 Provider 完全相同，由 core 实现一次（[T-6](../../../taste.md#t-6)）。Provider 只交出 `BeforeCacheSnapshotDriver`。driver 不声明自己是谁：账本的 `provider` 列取 Provider module 的 `id`，新增一个远端 Provider 不需要改 core 的类型或账本 schema（[T-3](../../../taste.md#t-3)）。core 用 `remoteSnapshotPreparer(driver)` 把它变成（`continuesStaging` 取 driver 的 `sourceUsableAfterSnapshot`） [`BeforeCachePreparer`](before-cache.md#provider-能力)：

```typescript
interface BeforeCacheSnapshotDriver<Plan> {
  /** snapshot 保存的内容。core 据此检查挂载并决定是否执行 sync。 */
  readonly preserves: {
    /** 会被完整保存的可写挂载点，至少包含 `/`。 */
    readonly disks: readonly string[];
    /** 是否同时保存内存与进程。 */
    readonly memory: boolean;
  };
  /** snapshot Ready 后源实例是否仍可继续执行命令。为 true 时一条 miss 链可在同一个 staging 上连续推进。 */
  readonly sourceUsableAfterSnapshot: boolean;
  /** 只读：把声明解析成不可变 Base 与账号域。不得创建或修改远端资源。 */
  readonly resolveBase: (
    plan: Plan,
  ) => Effect.Effect<BeforeCacheSnapshotTarget | BeforeCacheIneligible, BeforeCacheSnapshotError>;
  /** 从 snapshot 创建实例。实例归调用方 Scope，Scope 关闭时删除。 */
  readonly createFromSnapshot: (
    plan: Plan,
    snapshotId: string,
    context: SandboxRuntimeMaterializeContext,
  ) => Effect.Effect<MaterializedSandboxCase, BeforeCacheSnapshotError, Scope.Scope>;
  /** 以给定名称发起 snapshot 并等待 Ready。 */
  readonly createSnapshot: (
    plan: Plan,
    source: MaterializedSandboxCase,
    name: string,
  ) => Effect.Effect<BeforeCacheSnapshotCreated, BeforeCacheSnapshotError>;
  /** 按名称精确查询，不按前缀扫描。 */
  readonly findSnapshot: (
    plan: Plan,
    name: string,
  ) => Effect.Effect<BeforeCacheSnapshotFound, BeforeCacheSnapshotError>;
  readonly deleteSnapshot: (
    plan: Plan,
    snapshotId: string,
  ) => Effect.Effect<"deleted" | "absent", BeforeCacheSnapshotError>;
}

interface BeforeCacheSnapshotTarget {
  readonly _tag: "Resolved";
  /** 服务与账号的不可逆摘要，算法见各 Provider 一节。 */
  readonly executionDomainId: string;
  /** 不可变 Base 身份，进入 BeforeCacheKey。 */
  readonly baseIdentity: string;
  readonly keyScope: BeforeCacheKeyScope;
}

type BeforeCacheIneligible = {
  readonly _tag: "Ineligible";
  readonly code: BeforeCacheUnsupportedCode;
  readonly reason: string;
};

type BeforeCacheSnapshotCreated =
  | { readonly _tag: "Ready"; readonly snapshotId: string }
  /** 服务在受理前明确拒绝（例如配额）且没有创建任何对象。 */
  | { readonly _tag: "Rejected"; readonly reason: string };

type BeforeCacheSnapshotFound =
  | { readonly _tag: "Ready"; readonly snapshotId: string }
  | { readonly _tag: "Pending" }
  | { readonly _tag: "Absent" };
```

`createSnapshot` 只有在服务明确拒绝、确定没有创建对象时才返回 `Rejected`。请求一旦可能已被受理，后续失败、超时或响应歧义都是 `BeforeCacheSnapshotError`，core 按[结果不确定的请求](#结果不确定的请求)回收。

Provider module 声明能力时同时交出 driver，二者不能分开出现：

```typescript
beforeCache: {
  _tag: "RunPrepared",
  coverage: "sandbox",
  preparer: remoteSnapshotPreparer(e2bSnapshotDriver),
}
```

## core 的捕获步骤

一个节点从 miss 到发布：

```text
lookup miss
  -> reserve: preparing 行 + 自己的 lease
  -> staging: 父节点连续推进的 staging，或从 Base / 父 snapshot 新建
  -> staging ready 后再次 resolveBase，确认 Base 未变
  -> 执行本节点的一个 before action
  -> 写 artifact 标记 -> 挂载与敏感字节检查 -> quiesce
  -> createSnapshot(name = niceeval-<artifactId>)
  -> publish：ready 行 + Run 持有的 hold
  -> 有一个子节点要继续时交给它，否则删除 staging
```

- **artifact 标记**：core 以 root 写入 `/var/lib/niceeval/before-cache-artifact.json`，内容只有 `artifactId` 与 `beforeCacheKey`。每个从 snapshot 创建的实例先读取它，与账本登记比较，证明实例来自预期的 artifact。完整声明只保存在账本的 `declaration_json`，不再复制进 snapshot。
- **挂载**：staging 初始化时 core 读取 `/proc/self/mountinfo` 记录可写挂载集合；capture 前再次读取。新增的可写挂载不在 `preserves.disks` 内时，节点结算为 `degraded`，原因 `mounted-state`。
- **敏感字节**：已知敏感字节在 staging 中非空时不发布，原因 `sensitive-state`；credential overlay、外部会话与 command barrier 之后的状态不进入 snapshot。
- **quiesce**：当前 action 的前台进程都已退出；`preserves.memory` 为 false 时以 root 执行 `sync`；从 `sync` 到 snapshot Ready，core 不向 staging 发送命令。NiceEval 只承诺 crash consistency。仍在写盘、或依赖进程内存才能保持结果的后台服务，必须在 command barrier 之后启动。
- **Base 确认**：staging ready 后 core 再调用一次 `resolveBase`。结果与计算 key 时不同，节点结算为 `degraded`，原因 `base-image-unverified`。
- **Docker images**：确定性 before action 可以把要复用的 images 导出成磁盘上的归档，并停止自己的 daemon、卸载私有临时 data-root；恢复后由不缓存的 command 启动独立 daemon 并导入。core 不复制正在写入的 data-root，也不替作者推断 registry、tag 或启动逻辑。
- staging 使用 Provider 声明的寿命，不套用 Attempt 剩余时限。同一节点的 staging 与 consumer 不同时存在。

### 同一个 staging 连续推进

`sourceUsableAfterSnapshot` 为 true 的 Provider（E2B、Instabox）在一个节点发布后，把 staging 交给它的一个子节点继续执行下一个 action，不新建实例。子节点按规范化 BeforeCacheKey 排序后取第一个；其余子节点从刚发布的 snapshot 新建 staging。继续推进的 staging 占用同一个准备并发额度。

冷启动 `Base → 1 → 2`：E2B 与 Instabox 创建一个 staging、发布两份 snapshot；OpenSandbox 创建两个 staging。之后任一深度都可单独命中。

节点在发布前降级或失败时，staging 不再继续推进，后代节点按[节点结算](#run-级节点结算)处理。

## 消费：从 snapshot 创建实例

core 的 `materializeFrom` 在创建 consumer 或子节点 staging 时执行：

1. 在账本登记 `sandbox` hold，然后调用 `createFromSnapshot`。
2. 实例 ready 后校验 artifact 标记与账本登记一致。
3. snapshot 已不存在、实例不能 Ready 或标记不一致时，删除该实例、释放 hold，用 Provider 的 Base `materialize` 最多创建一次干净实例。标记不一致说明 artifact 已损坏，core 把它改为 `deleting`；只是取不到时不改登记，只在本 Run 内标记为不可用。

返回值携带这次恢复的结果：

```typescript
type BeforeCacheStart =
  | { readonly _tag: "Restored" }
  | { readonly _tag: "FellBackToBase"; readonly reason: string };
```

- consumer 收到 `FellBackToBase` 后，Attempt 真实执行全部 before，eligible action 的反馈为 `degraded`，并带 `cache-degraded` diagnostic。
- 子节点的 staging 收到 `FellBackToBase` 时，干净实例缺少父前缀的结果，core 不执行当前 action、不发布，删除该 staging，节点结算为 `degraded`。

## Run 级节点结算

| 终态 | 触发 | 对后代与目标配对 |
|---|---|---|
| `hit` | lookup 找到 ready artifact | 子节点可从它创建 staging |
| `prepared` | snapshot Ready 并发布 | 同上 |
| `degraded` | 其余所有不能发布的情形，见下表 | 后代不做远端 I/O，直接 `degraded` |
| `failed` | author action 在 staging 中失败 | 后代 `failed`；依赖它的配对在派发前失败 |

`degraded` 的原因：

| 原因 | 说明 |
|---|---|
| `eligibility-failed` | `resolveBase` 失败 |
| `ledger-unavailable` | 账本读写失败。本 Run 对该 `(provider, execution_domain_id)` 不再做任何远端缓存操作 |
| `staging-failed` | staging 创建失败 |
| `parent-unavailable` | 子节点的 staging 回退到 Base |
| `base-image-unverified` | staging 的 Base 与计算 key 时不同 |
| `mounted-state` / `sensitive-state` | 不能发布的状态 |
| `snapshot-rejected` | 服务在受理前拒绝 |
| `snapshot-uncertain` | snapshot 请求可能已被受理但没有得到 Ready |
| `lease-lost` | 失去 `preparing` 行的 lease |

只有 author action 失败才让配对失败：同一 action 在 Attempt 内也会以同样方式失败，提前结算省掉一批注定失败的实例（[T-5](../../../taste.md#t-5)）。其余原因都只说明缓存这次帮不上忙；Provider 若真的不可用，Attempt 会在创建自己的实例时以自己的错误失败。

目标配对按自己的链结算：

- 链上全部节点 `hit` 或 `prepared` 时，消费终端节点的 artifact，`satisfiedActionCount` 等于链深度。
- 链上出现 `degraded` 时，消费它之前最深、在本 Run 内仍可用的 `hit` / `prepared` 节点；之后的 eligible action 在 Attempt 内真实执行，反馈为 `degraded`。没有可用祖先时，从 Base 开始。
- 降级配对不在 Attempt 内做 lookup 或 capture，避免变成 N 个 Attempt 各自竞争。

`resolveBase` 返回 `Ineligible` 的配对不进入准备图，Attempt 按 `unsupported` 真实执行。

## Sandbox 复用

声明 `sandboxReuse: true` 的配对照常进入准备图，artifact 只在复用池创建实例时消费一次。复用实例承接的第一条 Attempt 报告 `hit`；同一实例上的后续 Attempt 真实执行全部 before，由作者写下的探测保持便宜（见 [Sandbox 复用](../library/reuse.md)）。实例不会因为缓存命中被替换，workdir 之外的状态与有意保留的后台服务按复用契约延续。三个 Provider 中只有 E2B 支持 Sandbox 复用；OpenSandbox 与 Instabox 在规划时拒绝 `sandboxReuse: true`。

## 发布与竞争

lookup 与 reserve 在同一个写事务中完成，结果有三种：

- 已有 ready artifact：插入 `run` hold，按 `hit` 结算。
- 可以写入：分配 generation 并插入 `preparing` 行。
- 同一 `(provider, execution_domain_id, before_cache_key)` 已被其它进程以活跃 lease 持有：返回 busy。

busy 的节点等待对方结算，不在等待期间创建 staging；对方发布后按 `hit` 消费，对方放弃或 lease 过期后重新 reserve。等待受 Run 取消约束；期间 Run 反馈显示该节点正在等待其它运行。

**lease。** `preparing` 行的 lease 单次有效 2 分钟，持有者每 30 秒续期。续期以 `artifact_id`、`lease_token`、`state = 'preparing'` 与 `lease_until >= now` 为条件；条件不满足即失去 lease。失去 lease 的进程只删除自己的 staging，不发布、不删除 snapshot，也不再操作该行，节点结算为 `degraded(lease-lost)`。

**接管。** 发现过期的 `preparing` 行时，接管者先在一个写事务中比较旧 `lease_token` 与 `lease_until`，原子换上自己的 token 与新 lease，再调用 `findSnapshot(snapshot_name)`：

- `Ready`：以新 token 发布。
- `Pending`：续期并等待它结束。
- `Absent`：把该行改为 `deleting`（`snapshot_id` 为空），再重新 reserve。

**发布。** publish 要求同一 artifact、当前 lease token、lease 未过期且 snapshot ID 已确认，并在同一事务插入 `run` hold。同一 replacement scope 已有更大 generation 发布时，较小 generation 改为 `deleting`，不发布。新 generation 发布时，同 scope 中较小的 ready 改为 `deleting`；lookup 只返回 ready。

### 结果不确定的请求

`createSnapshot` 返回错误时，远端可能已经创建、或稍后才创建一份名为 `niceeval-<artifactId>` 的 snapshot。core 在同一事务把该行改为 `deleting`、`snapshot_id` 留空，节点结算为 `degraded(snapshot-uncertain)`。这份登记让它不会变成来历不明的快照（OPS-7）：回收时按名称查询再删除。

## 回收

**hold 的两种持有者。**

| 持有者 | 何时插入 | 何时释放 | 过期 |
|---|---|---|---|
| `run` | Run 级 lookup 命中或发布 | 依赖它的 Planned attempts 全部派发并登记 `sandbox` hold，或 Run 结束、取消 | `expires_at` 随 Run 心跳延后；过期即无效，任何进程可删除 |
| `sandbox` | staging 或 consumer 从 snapshot 创建实例之前 | Provider 确认该实例删除之后 | 不凭时钟过期；未确认释放时保守保留 artifact |

`run` hold 保护派发前的等待期，使外部新 generation 无法在派发前删除即将使用的 artifact；它不保护活实例，所以可以过期。`sandbox` hold 保护可能仍在运行的实例，只能由确认删除来释放。

**删除。** 每个使用某 `(provider, execution_domain_id)` 的 Run 在结束时清理一次该 domain 的 `deleting` 行，总数受 Run 取消约束。删除者先在一个写事务中领取：lease 为空或已过期、且没有 `sandbox` hold 与未过期的 `run` hold 时，写入自己的 token 与 lease。领取后：

- 有 `snapshot_id`：`deleteSnapshot`；`deleted` 或 `absent` 都以同一 token 改为 `deleted`。
- 没有 `snapshot_id`：先 `findSnapshot(snapshot_name)`。`Ready` 时删除；`Absent` 时改为 `deleted`；`Pending` 时放弃 lease，留到下次。

删除失败时只放弃 lease，下次再领取。用户声明的 Base template 与 snapshot 永不由 NiceEval 删除。

取消、失败与正常结束后，本 Run 不留下活跃的 staging 或 consumer 实例，也不留下自己持有且未过期的 `preparing` lease 或 `run` hold。回收失败保留登记并呈现错误，不改成静默成功。

## E2B

- **driver**：`preserves = { disks: ["/"], memory: true }`；`sourceUsableAfterSnapshot = true`。
- **Base 身份**：`template` 引用解析为 build。`name` 取 `default` tag，`name:tag` 取对应 tag，经 `Template.getTags(name)` 得到 `buildId`；`baseIdentity` 是 `e2b-build:<buildId>`。template 或 tag 不存在时返回 `Ineligible(base-image-unverified)`；网络或服务错误是 `BeforeCacheSnapshotError`。
- **Base 确认的局限**：E2B 不在实例信息里返回 buildId，也不能按 buildId 创建实例，core 只能靠 staging ready 后的第二次解析确认。tag 在两次解析之间被改走又改回时无法发现。前提是作者在 Run 期间不移动所用 tag；需要更强保证时，template 引用应指向只构建一次的专用 tag。
- **Base 回退**：回退实例从声明的 template 引用创建，可能落在更新的 build 上；回退后 Attempt 真实执行全部 before，结果与不使用缓存相同。
- **execution domain**：`hash(规范化 API domain, sha256(E2B_API_KEY))`。换 key 等同于换 domain。
- **createSnapshot**：`Sandbox.createSnapshot(sandboxId, { name, mode: "full" })`，`mode` 进入 artifact format identity。
- **findSnapshot**：`Sandbox.listSnapshots({ sandboxId })` 后按名称精确匹配。
- **createFromSnapshot**：`Sandbox.create(snapshotId)`。

## OpenSandbox

- **driver**：`preserves = { disks: ["/"], memory: false }`；`sourceUsableAfterSnapshot = false`。不保存进程、卷或 tmpfs。
- **Base 身份**：必须是 digest-pinned image，否则 `Ineligible(base-image-unverified)`。
- **execution domain**：规范化服务 URL 与凭据的不可逆摘要；URL 路径、目标平台与 Provider format revision 进入 key scope。
- **createSnapshot / findSnapshot / deleteSnapshot**：公开 Snapshot API，按 `name` 创建与精确查询。
- **createFromSnapshot**：从 snapshotId 创建实例；remote handle 原子替换 backend，清空用户身份与 PATH 等实例缓存后重新执行宿主初始化，不保留旧实例引用。
- **回收边界**：Snapshot 删除不保证回收 Kubernetes registry blobs。registry retention 与容量监控属于部署方，NiceEval 不持有 registry 写凭据。

## Instabox

- **driver**：`preserves = { disks: ["/", "/data"], memory: false }`（默认 workdir 在 `/data/home/workspace`）；`sourceUsableAfterSnapshot = true`。retention 与 Nested Docker 仍为 Unsupported，不支持 Sandbox 复用。
- **Base 身份**：声明的 `snapshotId`（`sn_` 开头）；Instabox snapshot 的内容按 ID 不可变。
- **execution domain**：`hash("https://api.instabox.sh", sha256(API key))`。
- **createSnapshot**：对 staging Machine 发起包含 root 与 `/data` 的 snapshot 保存请求，等待 status 变为 `ready`；`failed` 是错误。服务以明确错误码拒绝且未返回 operation 时为 `Rejected`。具体 HTTP 路径以 Instabox API 为准，像现有 Machine 接口一样在边界用 Schema 解码。
- **一致性**：Instabox 的 live snapshot 等同于断电时的磁盘内容；两个盘是否在同一时刻捕获没有服务端证据。quiesce 保证 snapshot 期间没有 NiceEval 发起的写入，因此 core 不依赖跨盘原子性。
- **createFromSnapshot**：以 snapshot ID 创建 Machine，沿用现有创建、探测与删除契约；Vault 与 Org Secrets 自动注入保持关闭。
- **deleteSnapshot**：`DELETE /snapshots/{id}`，404 返回 `absent`。

## 验收

用户路径由 [云 Sandbox 的一批 Attempt 只准备一次](../use-case/sandbox-cloud-before-cache.md) 从安装后的 CLI 验收，E2B 与 Instabox 各跑一次真实服务。下列窗口无法靠普通运行稳定触发，在 driver 边界或账本边界按 [Testing](../../../engineering/testing/README.md) 选择最小的可控 owner，以 driver 调用记录和最终资源状态作为证据：

- 连续推进：E2B 与 Instabox 冷启动 `Base → 1 → 2` 只创建一个 staging；OpenSandbox 创建两个。
- staging 创建前父 snapshot 被删除或 artifact 标记损坏：节点 `degraded(parent-unavailable)`，不发布，目标配对从更浅的可用祖先或 Base 开始。
- snapshot 请求超时：节点 `degraded(snapshot-uncertain)`，配对照常完成；Run 结束的清理按名称查到并删除该 snapshot。
- author action 失败：节点与后代 `failed`，依赖它的配对在派发前失败，其它分支照常。
- 复用池：第二条 Attempt 在同一实例上执行 before，并看见第一条在 workdir 外写下的标记与仍在运行的服务。
- 两个 Invocation 同时冷启动同一 key：只发出一次 snapshot 请求，后者以 `hit` 消费。
- 旧持有者暂停超过 lease、接管者发布后旧持有者恢复：旧持有者不发布、不删除，节点 `degraded(lease-lost)`。
- 删除领取与消费互斥：有 `sandbox` hold 或未过期 `run` hold 时不调用删除。
- 新增不在 `preserves.disks` 内的可写挂载：`degraded(mounted-state)`；Instabox `/data` 中的 action 结果正常恢复。
- 换 domain：不命中，也不删除另一 domain 的 artifact。
- 取消：保留已发布的祖先，不留活跃 staging、自有 `preparing` lease 或 `run` hold。
