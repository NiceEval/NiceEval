# Record Library

本页定义 `niceeval/record` 与 `niceeval/record/host` 共用的 `recordHost` 契约。两个导入面都导出这个
公开、受支持的高级 Host composition SDK，供 NiceEval CLI、替代 CLI / Web host 或深度应用集成使用。
普通 Eval、Analysis 与 Report 作者不导入它，不读取 Record directory，也不把这些类型当作作者协议。

Record definition 的两个 package-private 作者入口是 `defineRecordCore` 与 `defineRecordAttachment`。它们、
固定 family declaration 与 migration steps 都不向外部导出；外部没有 generic family、definition 或 migration
registration。`compileRecordSchemaCodec` 是消费已声明 Schema 的实现叶子，不是作者入口、扩展点或 barrel 导出。

Library 是 Effect v3 API。它不在内部调用 `Effect.runPromise`；CLI 或 Host 边界只在最外层组合 Node
Layer 并运行一次 Effect。typed error、defect 与 interruption 在到达这个边界前保持分离。

## Host、root 与 identity

```ts
import { Brand, Context, Effect, Either, Scope, Stream } from "effect";

type RecordId = string & Brand.Brand<"RecordId">;
type RunId = string & Brand.Brand<"RunId">;
type ExperimentId = string & Brand.Brand<"ExperimentId">;
type SlotId = string & Brand.Brand<"SlotId">;
type AttemptId = string & Brand.Brand<"AttemptId">;
type UtcMillis = number & Brand.Brand<"UtcMillis">;

type SourceItemId = string & Brand.Brand<"SourceItemId">;
type CanonicalProjectRelativePath = string & Brand.Brand<
  "CanonicalProjectRelativePath"
>;
type Sha256Digest = string & Brand.Brand<"Sha256Digest">;

declare const recordRootTypeId: unique symbol;
interface RecordRoot {
  readonly [recordRootTypeId]: typeof recordRootTypeId;
}

type RecordRootConstructionError =
  | { readonly code: "record-root-empty" }
  | { readonly code: "record-root-relative" }
  | { readonly code: "record-root-non-file-url"; readonly protocol: string }
  | { readonly code: "record-root-file-url-invalid" };

declare const makeRecordRoot: (
  input: string | URL,
) => Either.Either<RecordRoot, RecordRootConstructionError>;
```

`RecordRoot` 接受 lexical-normalized（词法规范化）的绝对 host path 或 `file:` URL。构造不做 I/O、
不 realpath，也不把 host path 放进 portable Record。所有落盘路径都是受控的 root-relative segment。

```ts
class RecordFileSystem extends Context.Tag("@niceeval/record/RecordFileSystem")<
  RecordFileSystem,
  RecordFileSystemService
>() {}

class RecordCoordination extends Context.Tag("@niceeval/record/RecordCoordination")<
  RecordCoordination,
  RecordCoordinationService
>() {}

class RecordEntropy extends Context.Tag("@niceeval/record/RecordEntropy")<
  RecordEntropy,
  RecordEntropyService
>() {}

class RecordGit extends Context.Tag("@niceeval/record/RecordGit")<
  RecordGit,
  RecordGitService
>() {}
```

`RecordFileSystem` 负责 definition 驱动的 exact JSON、目录排他创建、blob I/O、flush、close 与
incomplete Run directory 删除。`RecordCoordination` 只提供具名 read、append 与 maintenance lease；
它不导出通用 `lock()`。`RecordGit` 只服务 maintenance 的恢复预检。

## current 与 maintenance facet

Host 只有两个 facet。它们的划分阻止 ordinary reader 取得迁移能力：

```ts
interface RecordHostSDK {
  readonly current: {
    readonly openRead: (
      request: RecordOpenReadRequest,
    ) => Effect.Effect<RecordReadSession, RecordOpenReadError, Scope.Scope>;

    readonly createRun: (
      request: CreateRunRequest,
    ) => Effect.Effect<RunWriteSession, RecordCreateRunError, Scope.Scope>;

    readonly createReferenceRun: (
      request: CreateReferenceRunRequest,
    ) => Effect.Effect<ReferenceRunWriteSession, RecordCreateRunError, Scope.Scope>;
  };

  readonly maintenance: {
    readonly open: (
      request: RecordMaintenanceRequest,
    ) => Effect.Effect<RecordMaintenanceSession, RecordMaintenanceOpenError, Scope.Scope>;
  };
}
```

```ts
interface RunContext {
  readonly experimentId: ExperimentId;
  readonly execution: {
    readonly agentId: string;
    readonly model: string | null;
    readonly reasoningEffort: string | null;
    readonly flags: RecordJsonObject;
  };
  readonly labels: Readonly<Record<string, string>>;
}

interface CreateRunRequest {
  readonly root: RecordRoot;
  readonly experimentId: ExperimentId;
  /** Required Core history; it is persisted once as RunDocument.context. */
  readonly context: RunContext;
  readonly startedAt: UtcMillis;
  readonly expectedSlots: readonly RecordSlotIdentity[];
}

interface CreateReferenceRunRequest extends CreateRunRequest {}
```

`current.openRead()` 与 `current.createRun()` 分别取得 shared read / append lease；两者可以并存。
`maintenance.open()` 取得 exclusive maintenance lease，因此 format inspection、migration 与 clean
不会和 ordinary read/write 交错。execution claim、`maxConcurrency` 与 Slot 去重属于
`niceeval/coordination/host`，不属于 Record directory 的所有权。

`CreateRunRequest` 与 `CreateReferenceRunRequest` 都必须带入完整 `context`。writer 在创建目录前验证 exact
RunContext，并 refine `context.experimentId === experimentId`；它把这个已验证值带入 draft，只有 `seal()` 时
将它作为 `RunDocument.context` 写入 `run.json`。不能在 session 创建后以当前配置或补丁重新设定 context。

`current` 只接受 package-private definition 中的 root `{ format: "niceeval.record", schemaVersion: 1 }` 与匹配的 Core。
root / Core 不兼容时，若 maintenance 有固定相邻步骤则返回 `migration-required`，否则
`unsupported-format`；session 根本不会形成。带 `/vN` 后缀的未发布 family 草案也是
`unsupported-format`，不能伪装成独立 future family。

## fixed family 与内部读取

current catalog 的五个 fixed family 由 definition 关闭：

| family | current | `owners` |
|---|---:|---|
| `niceeval.assertions` | 1 | `{ attempt }` |
| `niceeval.observability` | 2 | `{ attempt, run }` |
| `niceeval.file-changes` | 1 | `{ attempt }` |
| `niceeval.source-navigation` | 1 | `{ attempt }` |
| `niceeval.sources` | 1 | `{ run }` |
| `niceeval.artifacts` | 1 | `{ attempt, run }` |

Attachment envelope 的 shape 是 `{ family, schemaVersion }`。family 是稳定 identity，schemaVersion 是数值。
Observability 与 Artifacts 各自只有一个 package-private definition；其 owner-specific payload 位于同一
`owners` map，不是公开的 attempt / run family pair。

future NiceEval catalog 可在不改变 Core 的情况下加入 `niceeval.energy` 等独立 fixed family。它具有自己的
static definition 与 `owners` map；应用作者仍不能定义 family。较早 reader 发现未知 stable family 时保留
该目录的所有 bytes，跳过 payload / blob 解码，继续读取 Core 与认识的 family。

每个 fixed collector 通过 private definition mint `RecordBlobRef`。它写出的 payload 是 deep-frozen JSON
snapshot；全部 own blob 通过 closure 验证后才可从内存获得 defensive copy。没有可从
`niceeval/record/host` 交给 Report 的公开 generic Attachment value 类型。

`not-recorded` 表示已封口 owner 没有 current catalog 中被请求的 fixed family。它不等于空 collection。
缺 key、多 key、重复 key、手写 key、跨 owner ref 或 root 外路径使请求的 Attachment 为 `invalid`。I/O、
permission 或 materialize failure 仍是 `RecordReadError`。

对 `niceeval.file-changes`，`not-recorded` 只表示 Sandbox 归因采集器不适用于该 Attempt。适用的 collector
开始后，即使导出失败、中断或达到限额，也会写入带 limitation 的 `collection.state: "partial"` Attachment；完整空轨迹、
partial 空前缀和 `not-recorded` 因而保持可区分。内部 reader 只把归因策略、collection 与 ordered send 区间
trajectory（轨迹）交给 Analysis，绝不提供按 path 汇总的 `changes` 或 durable `net`。

已知 family 的旧 schemaVersion 是 `migration-required`，ordinary reader 不做局部兼容读。未知 independent
future family 则局部容忍：reader 保留它，且继续读取其它事实；依赖它的 input / view 是 `unsupported`。
它不同于 `not-recorded` 与 `migration-required`。

## Reader：RecordReadSession

```ts
declare const selectedRunRefTypeId: unique symbol;
declare const selectedAttemptRefTypeId: unique symbol;

interface SelectedRunRef {
  readonly runId: RunId;
  readonly [selectedRunRefTypeId]: typeof selectedRunRefTypeId;
}

interface SelectedAttemptRef {
  readonly originRunId: RunId;
  readonly attemptId: AttemptId;
  readonly [selectedAttemptRefTypeId]: typeof selectedAttemptRefTypeId;
}

interface RecordReadSession {
  readonly selectRuns: (
    request: RecordSelectionRequest,
  ) => Effect.Effect<RecordSelection, RecordSelectionError>;
}

interface RecordSelection {
  readonly identity: RecordSelectionIdentity;
  readonly runRefs: readonly SelectedRunRef[];
  readonly expectedSlots: readonly SelectedLogicalSlot[];
  readonly problems: readonly RecordSelectionProblem[];
}
```

Host composition caller 使用 `selectRuns()`；它不会传入 family 名、file path、raw JSON、schema object 或
blob ref。`RecordReadSession` 的 definition-driven Core / Attachment access capability 只交给 Analysis Host
的 package-private adapter。普通应用代码与 Report author 不存在通用 `readAttachment()` 或 `readFamily()` API。

打开 reader 只验证 root 与 current definition。`selectRuns()` 扫描 `runs/*/complete`，并读取选择所需的
最小 Core。它固定 RunId、SlotId、预期分母和问题，既不携带 payload，也不冻结未来新 Run。扫描中刚封口的
Run 可以整体进入或整体不进入本次选择；没有 `complete` 的 Run 永远不会进入。

selected ref 都是当前 session 签发的 nominal handle（名义句柄）。它们不能靠对象复制、ID 拼接或跨 Scope
重用。Analysis 的 `AnalysisInput` 或 `DomainViewRequest` 真正需要事实时，package-private adapter 才以
`{ owner, fixed definition }` 读取并缓存对应 Attachment。请求未知 future family 时，它缓存
`unsupported`，但不解码磁盘 bytes。verified cache 可以省 I/O，不能成为 absence、
candidate set 或 latest 的权威依据。

## Writer：RunWriteSession

```ts
interface RunWriteSession {
  readonly runId: RunId;

  readonly createAttempt: (input: {
    readonly slotId: SlotId;
  }) => Effect.Effect<AttemptWriteSession, RecordWriteError, Scope.Scope>;

  readonly referenceAttempt: (input: {
    readonly slotId: SlotId;
    readonly action: "carried" | "accepted";
    readonly attempt: SelectedAttemptRef;
  }) => Effect.Effect<void, RecordWriteError>;

  readonly recordAcceptedMembership: (input: {
    readonly slotId: SlotId;
    readonly attempt: SelectedAttemptRef;
  }) => Effect.Effect<void, RecordWriteError>;

  readonly recordTerminalMember: (input: {
    readonly slotId: SlotId;
    readonly action: "not-dispatched" | "interrupted";
  }) => Effect.Effect<void, RecordWriteError>;

  readonly writeSources: (
    value: SourcesWrite,
  ) => Effect.Effect<void, RecordWriteError>;

  readonly writeRunObservability: (
    value: RunObservabilityWrite,
  ) => Effect.Effect<void, RecordWriteError>;

  readonly attachArtifact: (
    value: ArtifactWrite,
  ) => Effect.Effect<ArtifactRef, RecordWriteError>;

  readonly seal: (
    completion: RunCompletion,
  ) => Effect.Effect<RecordSealReceipt, RecordWriteError>;
}

interface ReferenceRunWriteSession {
  readonly runId: RunId;
  readonly referenceAttempt: RunWriteSession["referenceAttempt"];
  readonly recordAcceptedMembership: RunWriteSession["recordAcceptedMembership"];
  readonly recordTerminalMember: RunWriteSession["recordTerminalMember"];
  readonly writeRunObservability: RunWriteSession["writeRunObservability"];
  readonly attachArtifact: RunWriteSession["attachArtifact"];
  readonly seal: RunWriteSession["seal"];
}

interface AttemptWriteSession {
  readonly attemptId: AttemptId;
  readonly slotId: SlotId;

  readonly appendAssertion: (
    value: AssertionResult,
  ) => Effect.Effect<AssertionEntryRef, AttemptWriteError>;

  readonly appendOtel: (
    value: OTelBatch,
  ) => Effect.Effect<void, AttemptWriteError>;

  readonly appendEvent: (
    value: NiceEvalEvent,
  ) => Effect.Effect<void, AttemptWriteError>;

  readonly recordFileChanges: (
    value: FileChanges,
  ) => Effect.Effect<void, AttemptWriteError>;

  readonly attachArtifact: (
    value: ArtifactWrite,
  ) => Effect.Effect<ArtifactRef, AttemptWriteError>;

  readonly complete: (
    outcome: AttemptOutcome,
  ) => Effect.Effect<AttemptCompletionReceipt, AttemptWriteError>;
}
```

`createRun()` 与 `createReferenceRun()` 都把 request 的 `experimentId`、必填 `context`、`startedAt` 和
`expectedSlots` 交给同一 writer 路径。创建目录前，它会：

- canonicalize / exact-validate context，并执行 experimentId refine；
- 验证 SlotId canonical order、SlotId 唯一及 `(evalId, attemptOrdinal)` 唯一。ordinal 不要求连续，也不从
  数组位置推断。

随后该路径确认或一次性初始化 `record.json`，生成 collision-resistant RunId，并排他创建
`runs/<RunId>/`。冲突时重新生成，绝不接管已有目录。一个 session 只写这一个 Run；其 Attempt 也各自排他
创建目录，所以多个 Attempt 与多个 Run writer 都可以并行。

这些是 fixed collector 的窄入口，不是 generic Attachment writer。它们把输入交给内部 definition，
不会暴露 raw JSON、path、blob key、`family`、schemaVersion 或写入 schema。`writeRunObservability()` 与
`attachArtifact()` 分别写入同一个 Observability 或 Artifacts definition 的 `owners.run` branch。

`referenceAttempt()` 只接受当前 reader selection 中已封口的精确 Attempt。它不猜 latest、不引用本 Run
尚未封口的 Attempt，也不复制历史 Attachment。`recordAcceptedMembership()` 是 explicit adoption 的具名写入：
当前 target Slot identity 可以不同于 origin Attempt，Member 仍引用 `{ originRunId, attemptId }`。

每个 Run session 状态严格为：

```text
open → sealing → sealed
               ↘ failed
```

| 状态 | 行为 |
|---|---|
| `open` | 接受本 Run 的 Attempt、reference 与 fixed collector 写入。 |
| `sealing` | 拒绝新 mutation，等待既有 Attempt 和 collector 停稳。 |
| `sealed` | 已创建 `complete`；所有 writer handle 同步 consumed。 |
| `failed` | marker 前的 typed failure、defect 或 interruption 使本 session 不可重用。 |

`recordTerminalMember()` 为没有 Attempt 的 expected Slot 写入 `not-dispatched` 或 `interrupted`，并把
`attempt` 固定为 `null`。

`seal()` 在 marker 前验证每个 expected Slot 都有 Member，并按 current definition 验证含必填
`RunDocument.context` 的 Core、references、family schema 与每个 closure。它将已验证 context 随 run document
一起写入 `run.json`。

随后 `seal()` 只在短暂 `Effect.uninterruptibleMask` 中执行 final flush/close、排他创建零字节 `complete`，并把
session 置为 `sealed`。

marker 前中断不发布；marker 后即使 Effect 未交付 receipt，Run 仍已发布。Scope finalizer 只释放 lease 和
handle，绝不删除 incomplete directory。

## Maintenance 与 Git recovery

```ts
interface RecordMaintenanceSession {
  readonly inspect: () => Effect.Effect<RecordFormatInspection, RecordMaintenanceError>;
  readonly planMigrate: () => Effect.Effect<RecordMigrationPlan, RecordMaintenanceError>;
  readonly applyMigrate: (
    plan: RecordMigrationPlan,
  ) => Effect.Effect<RecordMigrationReceipt, RecordMigrationError>;
}
```

schemaVersion `1` 的 current root / Core 没有已发布 predecessor。所有 fixed family 也处于 current 时，
`inspect()` 与 `planMigrate()` 返回 `already-current`；`applyMigrate()` 不运行，也不写 portable byte。

root / Core 不相容时，`inspect()` 返回 `migration-required` 或 `unsupported-format`。已知 family 的旧
schemaVersion 同样需要显式 migration。

未知 independent future family 保持 bytes 不动，不进入 migration plan。known family 的 future/无链版本和
未发布的斜杠版本草案返回 `unsupported-format`，不会被猜测成损坏数据或 migration source。

Observability schemaVersion `2` 同批在 maintenance facet 内提供固定 `1 → 2` step。它只从已保存的两个
owner payload 和 own blob closure 形成目标 bytes，不能读取当前 worktree、网络、第三方 converter 或运行时
算法。没有无损步骤时，maintenance 在改盘前拒绝计划；它不伪造新事实。

计划绑定 Git repository、HEAD、Record path、`recordId`、current format、portable-byte inventory 与
NiceEval migration implementation identity。`applyMigrate()` 重新验证这些值，避免把陈旧计划应用到变化后的
Record。

迁移只允许 Record 已纳入 Git 且 worktree/index 干净时执行。它在 exclusive maintenance lease 下原地
逐步改写，并完整校验 current Core、认识的 fixed family 与 blob closure。未知 independent future family
保持原有 directory 与 bytes。NiceEval 不创建 staging、backup、rollback 或 root replacement。

首次改写前的 `migration.in-progress` 只保存已验证的 restore commit。失败或中断后，CLI 给出限定到 Record
root 的精确 Git restore 与 tracked-byte 验证命令；验证 worktree/index 都等于该 commit 后才清除 sentinel，
再重新形成计划。

这里的“失败”只指 sentinel 已成功创建后的失败；apply 前的计划指纹变化、preflight 或 create-sentinel 错误
不携带恢复动作，并保留造成计划变化的编辑。post-sentinel 错误闭合为
`RecordMigrationRecoveryRequired`，携带 `restoreCommit` 与原始 `causeCode`。恢复完成前
`current.openRead()` 不产生 session。

`clean` 同样取得 maintenance lease。它只删除取得 lease 后重验仍没有 `complete` 的目录；
已封口但 Core invalid 的 Run 不是 clean 的对象。

## Typed error、Cause 与 Stream 边界

```ts
type RecordOpenError =
  | RecordIoError
  | RecordPermissionError
  | RecordMaintenanceBusy
  | RecordBootstrapInvalid
  | RecordFormatUnsupported;

type RecordReadError =
  | RecordIoError
  | RecordPermissionError
  | RecordReaderClosed
  | RecordHandleInvalid;

type RecordWriteError =
  | RecordIoError
  | RecordPermissionError
  | RecordAppendBusy
  | RecordWriterClosed
  | RecordWriteStateInvalid
  | RecordReferenceInvalid
  | RecordCoreInvalid
  | RecordAttachmentClosureInvalid;

type RecordMigrationError =
  | RecordIoError
  | RecordPermissionError
  | RecordGitCommandError
  | RecordMigrationGitRestoreRequired
  | RecordMigrationPlanStale
  | RecordMigrationInvalid
  | RecordMigrationInterruptedState;
```

每个 typed error 只有稳定 `code` 和有界安全上下文。raw filesystem error、Schema tree、stack、secret 和
任意第三方 message 不进入 portable data 或默认 CLI JSON。interruption 不属于这些 union；finalizer 释放
资源后继续保留原 Cause。内部不变量冲突与 callback throw 是 defect。

`Stream` 只用于内部扫描、写入和形成 blob snapshot。它不进入 Selection、Analysis 或 Report 的闭合值。
