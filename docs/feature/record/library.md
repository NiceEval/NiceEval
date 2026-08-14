# Record Library

本页定义内部 `niceeval/record/host` 的目标 API。它只供 Experiment、Analysis、CLI 与
maintenance host（维护宿主）使用；应用作者不读取 Record 目录，也不把这些类型当作集成协议。
五个 Attachment family 的字段形状在 [Architecture](architecture.md) 和
[Observability Attachment](architecture/observability-attachments.md) 定义。

Library 是 Effect v3 API。它不在内部调用 `Effect.runPromise`；CLI 或 application 只在最外层
组合 Node Layer 并运行一次 Effect。typed error、defect 与 interruption 在到达这个边界前保持分离。

## Runtime、root 与 identity

```ts
import { Brand, Context, Effect, Either, Scope, Stream } from "effect";

type RecordId = string & Brand.Brand<"RecordId">;
type RecordFormatId = string & Brand.Brand<"RecordFormatId">;
type RunId = string & Brand.Brand<"RunId">;
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

`RecordFileSystem` 负责 exact JSON、目录排他创建、blob I/O、flush、close 与 incomplete Run
目录删除。`RecordCoordination` 只提供具名 read、append 与 maintenance lease（许可）；它不导出通用
`lock()`。`RecordGit` 只服务 migration 的恢复预检。它们协调善意 NiceEval 进程，不宣称防御
hostile filesystem（敌对文件系统）。

## 固定 Attachment family 与 blob closure

family catalog（附件族目录）是 NiceEval 的封闭联合。没有 `defineRecordAttachment()`、
`registerRecordFamily()` 或 `registerMigration()` API。

```ts
type NiceEvalFamily =
  | "niceeval.assertions/v1"
  | "niceeval.observability/v1"
  | "niceeval.file-changes/v1"
  | "niceeval.sources/v1"
  | "niceeval.artifacts/v1";

type AttachmentOwner = "run" | "attempt";

interface AttachmentEnvelope {
  readonly family: NiceEvalFamily;
  readonly schemaId: NiceEvalFamily;
}

declare const recordBlobRefTypeId: unique symbol;
interface RecordBlobRef {
  readonly [recordBlobRefTypeId]: typeof recordBlobRefTypeId;
}

interface RecordBlobSource<E, R> {
  readonly stream: Stream.Stream<Uint8Array, E, R>;
}

type RecordAttachmentPayloadSnapshot<Payload> =
  Payload extends readonly (infer Item)[]
    ? readonly RecordAttachmentPayloadSnapshot<Item>[]
    : Payload extends object
      ? { readonly [Key in keyof Payload]: RecordAttachmentPayloadSnapshot<Payload[Key]> }
      : Payload;

type RecordBlobHandleInvalid = { readonly code: "record-blob-handle-invalid" };

interface RecordAttachmentBlobs {
  readonly refs: () => readonly RecordBlobRef[];
  readonly bytes: (
    ref: RecordBlobRef,
  ) => Either.Either<Uint8Array, RecordBlobHandleInvalid>;
}

interface RecordAttachmentValue<Payload> {
  readonly payload: RecordAttachmentPayloadSnapshot<Payload>;
  readonly blobs: RecordAttachmentBlobs;
}
```

每个 family 都是 exact JSON `payload.json`，并以自己的 `blobs/` 建立 closure。NiceEval 的固定
collector 是唯一能 mint `RecordBlobRef` 和构造写入值的代码；Adapter 只能调用相应 collector。
payload 中每个 ref 必须恰好匹配一份同 owner、同 Attachment 的 blob，且 blob 不能多出、重复或
指向 root 外。

读取在返回 `available` 前 exact decode、验证并 materialize 整个 closure。payload 递归 deep-freeze，
`refs()` 返回防御性列表，`bytes()` 每次返回防御性 copy。伪造 ref 只返回
`record-blob-handle-invalid`，不触发 I/O。I/O、permission 或 materialization failure 则仍是
`RecordReadError`。已返回的 `RecordAttachmentValue` 可在 Scope 关闭后同步消费。

```ts
type FamilyReadResult<Payload> =
  | { readonly state: "available"; readonly value: RecordAttachmentValue<Payload> }
  | { readonly state: "not-recorded" }
  | { readonly state: "unsupported"; readonly schemaId: string }
  | { readonly state: "invalid"; readonly issues: readonly RecordIssue[] };
```

`not-recorded` 表示该已封口的 owner 没有这个固定 family。它不等于空 collection。非 v1 schema
是 `unsupported`；不能 exact decode 或 closure 不完整是 `invalid`。v1 reader 不产生兼容值。

## Record Host SDK

```ts
interface RecordHostSDK {
  readonly openRead: (
    request: RecordOpenReadRequest,
  ) => Effect.Effect<RecordReadSession, RecordOpenReadError, Scope.Scope>;

  readonly createRun: (
    request: CreateRunRequest,
  ) => Effect.Effect<RunWriteSession, RecordCreateRunError, Scope.Scope>;

  readonly createReferenceRun: (
    request: CreateReferenceRunRequest,
  ) => Effect.Effect<ReferenceRunWriteSession, RecordCreateRunError, Scope.Scope>;

  readonly maintenance: (
    request: RecordMaintenanceRequest,
  ) => Effect.Effect<RecordMaintenanceSession, RecordMaintenanceOpenError, Scope.Scope>;
}
```

`openRead()` 和 `createRun()` 分别取得 shared read / append lease；二者可并存。`maintenance()`
取得 exclusive maintenance lease，因此 migration 与 clean 不会和普通读写交错。执行 claim、
`maxConcurrency` 与 Slot 去重属于 `niceeval/coordination/host`，不属于 Record 的目录所有权。

## Reader：RecordReadSession

```ts
declare const selectedRunRefTypeId: unique symbol;
declare const selectedAttemptRefTypeId: unique symbol;
declare const selectedOwnerRefTypeId: unique symbol;
declare const selectedBlobRefTypeId: unique symbol;

interface SelectedRunRef {
  readonly runId: RunId;
  readonly [selectedRunRefTypeId]: typeof selectedRunRefTypeId;
}

interface SelectedAttemptRef {
  readonly originRunId: RunId;
  readonly attemptId: AttemptId;
  readonly [selectedAttemptRefTypeId]: typeof selectedAttemptRefTypeId;
}

interface SelectedOwnerRef {
  readonly [selectedOwnerRefTypeId]: typeof selectedOwnerRefTypeId;
}

interface SelectedBlobRef {
  readonly [selectedBlobRefTypeId]: typeof selectedBlobRefTypeId;
}

interface RecordReadSession {
  readonly selectRuns: (
    request: RecordSelectionRequest,
  ) => Effect.Effect<RecordSelection, RecordSelectionError>;

  readonly readRun: (
    ref: SelectedRunRef,
  ) => Effect.Effect<ReadableRun, RecordReadError>;

  readonly readAttempt: (
    ref: SelectedAttemptRef,
  ) => Effect.Effect<ReadableAttempt, RecordReadError>;

  readonly readAttachment: <Payload>(
    ref: SelectedOwnerRef,
    family: NiceEvalFamily,
  ) => Effect.Effect<FamilyReadResult<Payload>, RecordReadError>;

  readonly readBlob: (
    ref: SelectedBlobRef,
  ) => Effect.Effect<BlobContent, RecordReadError>;
}

interface RecordSelection {
  readonly identity: RecordSelectionIdentity;
  readonly runRefs: readonly SelectedRunRef[];
  readonly expectedSlots: readonly SelectedLogicalSlot[];
  readonly problems: readonly RecordSelectionProblem[];
}
```

打开 reader 只验证 root 和 current format。`selectRuns()` 扫描 `runs/*/complete`，并读取选择所需的
最小 Core。它固定已选择 RunId、SlotId、预期分母和问题，既不携带 payload，也不冻结未来新 Run。
扫描中刚封口的 Run 可以整体进入或整体不进入本次选择；没有 `complete` 的 Run 永远不会进入。

所有 selected ref 都是当前 session 签发的 nominal handle（名义句柄）。它们不能靠对象复制、ID
拼接或跨 Scope 重用。第一次 query 需要事实时才读取对应 Core、Attachment 或 blob；verified cache
可以加速，但不能成为 absence、candidate set 或 latest 的权威依据。

## Writer：RunWriteSession

```ts
interface RunWriteSession {
  readonly runId: RunId;

  readonly createAttempt: (input: {
    readonly slotId: SlotId;
  }) => Effect.Effect<AttemptWriteSession, RecordWriteError, Scope.Scope>;

  readonly referenceAttempt: (input: {
    readonly slotId: SlotId;
    readonly attempt: SelectedAttemptRef;
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

`createRun()` 确认或一次性初始化 `record.json`，生成 collision-resistant RunId，并排他创建
`runs/<RunId>/`。冲突时重新生成；绝不接管已有目录。一个 session 只写这一个 Run。其 Attempt
也各自排他创建目录，所以多个 Attempt 与多个 Run writer 都可以并行。

`referenceAttempt()` 只接受当前 reader 选择中已封口的精确 Attempt。它不猜 latest、不引用本 Run
尚未封口的 Attempt，也不复制历史 Attachment。`AttemptWriteSession` 的固定方法把数据交给五个
family 的 collector；不会暴露 raw JSON、path、blob key 或写入 schema。

每个 Run session 状态严格为：

```text
open → sealing → sealed
               ↘ failed
```

| 状态 | 行为 |
|---|---|
| `open` | 接受本 Run 的 Attempt、reference 与固定 collector 写入。 |
| `sealing` | 拒绝新 mutation，等待既有 Attempt 和 collector 停稳。 |
| `sealed` | 已创建 `complete`；所有 writer handle 同步 consumed。 |
| `failed` | marker 前的 typed failure、defect 或 interruption 使本 session 不可重用。 |

`seal()` 在 marker 前验证 expected Slot、origin/reference、固定 family schema 与每个 closure。随后
只在短暂 `Effect.uninterruptibleMask` 中执行 final flush/close、排他创建零字节 `complete`，并把
session 置为 `sealed`。marker 前中断不发布；marker 后即使 Effect 未交付 receipt，Run 仍已发布。
Scope finalizer 只释放 lease 和 handle，绝不删除 incomplete directory。

## Maintenance 与 Git recovery

```ts
interface RecordMaintenanceSession {
  readonly inspect: () => Effect.Effect<RecordFormatInspection, RecordMaintenanceError>;
  readonly planMigrate: () => Effect.Effect<RecordMigrationPlan, RecordMaintenanceError>;
  readonly applyMigrate: (
    plan: RecordMigrationPlan,
    authorization: RecordMigrationAuthorization,
  ) => Effect.Effect<RecordMigrationReceipt, RecordMigrationError>;
}
```

`niceeval.record/v1` 和五个 `/v1` family 是首个支持格式，migration 链为空。`inspect()` 与
`planMigrate()` 对完整 v1 返回 `already-current`；非支持格式返回 `unsupported-format`。两种结果都
不写 portable byte，`applyMigrate()` 也不会运行。

发布 v2 时，NiceEval 必须同时提供固定的 v1→v2 step。每一步只从已保存 payload 和其 blob closure
形成目标字节，不能读取当前 worktree、网络、第三方 converter 或运行时算法。没有无损步骤时，
maintenance 在改盘前拒绝计划；它不伪造新事实。

计划绑定 Git repository、HEAD、Record path、`recordId`、current format、portable-byte inventory
以及 NiceEval migration implementation identity。`applyMigrate()` 重新验证这些值，避免把陈旧计划
应用到变化后的 Record。

迁移只允许 Record 已纳入 Git 且 worktree/index 干净时执行。它先创建并 sync
`migration.in-progress`，原地逐步改写，再完整校验当前 Core、固定 family 与 blob closure，最后删除并
sync marker。NiceEval 不创建 staging、backup、rollback、root replacement 或恢复日志。失败或中断保留
marker；用户通过 Git 完整恢复 `.niceeval/record`，再重新形成计划。

`clean` 同样取得 maintenance lease。它只删除取得 lease 后重验仍没有 `complete` 的目录；已封口但
Core invalid 的 Run 不是 clean 的对象。

## Typed error、Cause 与 Stream 边界

```ts
type RecordOpenError =
  | RecordIoError
  | RecordPermissionError
  | RecordMaintenanceBusy
  | RecordBootstrapInvalid
  | RecordMigrationRequired
  | RecordMigrationInterrupted
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
  | RecordMigrationPlanChanged
  | RecordMigrationStepFailed
  | RecordMigrationInterrupted;
```

每个 typed error 只有稳定 `code` 和有界安全上下文。raw filesystem error、Schema tree、stack、
secret 和任意第三方 message 不进入 portable data 或默认 CLI JSON。interruption 不属于这些 union；
finalizer 释放资源后继续保留原 Cause。内部不变量冲突和 callback throw 是 defect。

`Stream` 只用于内部扫描、写入和形成 blob snapshot。它不进入 `RecordAttachmentValue`、
`RecordSelection`、Analysis 或 Report 的公开值。
