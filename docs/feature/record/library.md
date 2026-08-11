# Record Library

Record Library 暴露五类 Effect-native 能力：打开 current reader、定义 typed RecordAttachment、写完并发布 Run、删除未完成 Run，以及显式迁移旧版本。

普通 reader 不包含跨 major Core decoder。旧 Core decoder 与 converter 只由 migration registry 提供。

## Effect runtime 与 platform

```ts
import { Brand, Context, Effect, Either, Layer, Schema, Scope } from "effect";

class RecordFileSystem extends Context.Tag("@niceeval/record/RecordFileSystem")<RecordFileSystem, RecordFileSystemService>() {}
class RecordMaintenanceLock extends Context.Tag("@niceeval/record/RecordMaintenanceLock")<RecordMaintenanceLock, RecordMaintenanceLockService>() {}
class RecordWriterLock extends Context.Tag("@niceeval/record/RecordWriterLock")<RecordWriterLock, RecordWriterLockService>() {}
class RecordEntropy extends Context.Tag("@niceeval/record/RecordEntropy")<RecordEntropy, RecordEntropyService>() {}
class RecordGit extends Context.Tag("@niceeval/record/RecordGit")<RecordGit, RecordGitService>() {}
class RecordMigrationRegistry extends Context.Tag("@niceeval/record/RecordMigrationRegistry")<RecordMigrationRegistry, RecordMigrationRegistryService>() {}
```

这些都是 Effect v3 `Context.Tag`，不是普通 interface 被写进 `R`。Node 层用 `Layer.mergeAll` 组合 live services；动态 `root` 是 constructor 参数，不为每个 root 创建 Layer。

| 能力 | Effect 依赖 |
|---|---|
| reader | `Scope.Scope | RecordFileSystem | RecordMaintenanceLock` |
| writer | reader 所需 Tag + `RecordWriterLock | RecordEntropy` |
| clean | `RecordFileSystem | RecordMaintenanceLock | RecordWriterLock` |
| migration plan/run | `RecordFileSystem | RecordMaintenanceLock | RecordGit | RecordMigrationRegistry` |

Library 内部不调用 `Effect.runPromise`。CLI/application 在最外层 provide Node Layer，并只运行一次 Effect。failure、defect 与 interruption 在拥有结果语义的边界之前保持分离。

`RecordFileSystem` 负责 direct directory/file create、exact JSON 与 blob I/O、flush 和删除未完成目录。Run 的提交点始终是最后创建的 `complete`。

## Identity

```ts
type RecordId = string & Brand.Brand<"RecordId">;
type RunId = string & Brand.Brand<"RunId">;
type SlotId = string & Brand.Brand<"SlotId">;
type AttemptId = string & Brand.Brand<"AttemptId">;
type UtcMillis = number & Brand.Brand<"UtcMillis">;

type RecordAttachmentName = string & Brand.Brand<"RecordAttachmentName">;
type RecordAttachmentSchemaId = string & Brand.Brand<"RecordAttachmentSchemaId">;
type RecordFormatId = string & Brand.Brand<"RecordFormatId">;
```

ID、时间、RecordAttachment name 和 schema ID 都由 exact Schema constructor 创建。调用方不能用普通 `string`、类型断言或 path 拼接绕过 constructor。

`RecordAttachmentName` 使用 reverse-domain lowercase ASCII namespace。`RecordAttachmentSchemaId` 是 `<name>/vN`。`niceeval.*` 只由包内 built-in constructor 创建；第三方使用自己的 namespace。

## 打开 current Record

```ts
declare const openRecordReader: (input: { readonly root: RecordRoot }) => Effect.Effect<
  RecordReader, RecordOpenError, Scope.Scope | RecordFileSystem | RecordMaintenanceLock
>;
```

constructor 取得 shared maintenance lock，读取 exact `record.json`，并冻结本次可见的已完成 Run 集合。以后并发完成的新 Run 不进入这个 reader；重新打开才形成新 snapshot。

已知旧 major 返回：

```ts
type RecordMigrationRequired = { readonly code: "record-migration-required"; readonly source: RecordFormatId; readonly target: CurrentRecordFormatId; readonly command: "niceeval migrate" };
```

future 或 foreign format 返回 `record-format-unsupported`。Library 不提供 compat reader，也不在 open 时自动修改磁盘。

## Reader

```ts
interface RecordReader {
  readonly warnings: readonly RecordWarning[];
  readonly runs: readonly RecordCoreRead<RecordRunSummary>[];

  readonly run: (runId: RunId) => Effect.Effect<RecordCoreRead<FrozenRecordRun>, RecordReadError>;
  readonly attempt: (ref: RecordAttemptRef) => Effect.Effect<RecordCoreRead<FrozenRecordAttempt>, RecordReadError>;
  readonly readRunAttachment: <Payload>(owner: FrozenRecordRun, family: RecordAttachmentFamily<"run", Payload>) => Effect.Effect<RecordAttachmentRead<Payload>, RecordReadError>;
  readonly readAttemptAttachment: <Payload>(owner: FrozenRecordAttempt, family: RecordAttachmentFamily<"attempt", Payload>) => Effect.Effect<RecordAttachmentRead<Payload>, RecordReadError>;
}
```

`FrozenRecordRun` 与 `FrozenRecordAttempt` 是 package-created opaque handles。它们绑定 reader snapshot；另一个 reader 的 handle、伪造对象或关闭 Scope 后的调用返回 typed read error。

`warnings` 是 snapshot 的一部分。未完成 Run 不进入 `runs`，只产生：

```ts
type RecordIncompleteRunWarning = { readonly code: "incomplete-run"; readonly runId: RunId; readonly cleanupCommand: "niceeval clean" };
```

### RecordCoreRead

```ts
type RecordCoreRead<Value> =
  | { readonly state: "available"; readonly value: Value }
  | { readonly state: "missing" }
  | { readonly state: "core-invalid"; readonly issues: NonEmptyReadonlyArray<RecordIssue> };
```

Core 损坏是成功 ADT；权限、I/O、closed Scope 和 wrong-reader handle 是 Effect error。`missing` 不把未完成 Run 提升为业务对象。

## RecordAttachment definition

decoded Payload 与 schema-specific encoded type 不使用递归 JSON union 作为泛型上界。普通 named interface 可以直接由 Effect Schema 推导。

```ts
declare const recordAttachmentDefinitionTypeId: unique symbol;

interface JsonRecordAttachmentDefinition<
  Owner extends "run" | "attempt",
  Payload,
> {
  readonly owner: Owner;
  readonly name: RecordAttachmentName;
  readonly schemaId: RecordAttachmentSchemaId;
  readonly [recordAttachmentDefinitionTypeId]: {
    readonly owner: (_: Owner) => Owner;
    readonly payload: (_: Payload) => Payload;
  };
}

declare const defineJsonRecordAttachment: <
  const Owner extends "run" | "attempt",
  S extends Schema.AnyNoContext,
>(input: {
  readonly owner: Owner;
  readonly name: string;
  readonly schemaId: string;
  readonly schema: S;
}) => Either.Either<
  JsonRecordAttachmentDefinition<Owner, Schema.Type<S>>,
  RecordAttachmentDefinitionError
>;
```

definition 固定使用 `{ errors: "all", onExcessProperty: "error" }`。Schema 负责 decoded type 与 exact JSON encoded value 的转换；JSON boundary 拒绝 function、symbol、native bytes 和任意 prototype。Date、BigInt 等值必须由作者 schema 显式转换。

definition 的运行时 authority 来自 package-private registry 与 exact object identity。复制字段或移植 phantom symbol 不能形成可写 capability。

```ts
type RecordAttachmentDefinitionError =
  | { readonly code: "record-attachment-name-invalid"; readonly name: string }
  | { readonly code: "record-attachment-schema-id-invalid"; readonly schemaId: string }
  | { readonly code: "niceeval-namespace-reserved"; readonly name: string }
  | { readonly code: "record-attachment-definition-invalid"; readonly issues: NonEmptyRecordIssues };
```

RecordAttachment payload 是 exact JSON。payload 中的 blob ref 只可指向同一 RecordAttachment directory 的 `blobs/**`；generic writer 在写入时验证这份 closure。

## 相邻 RecordAttachment migration

一个 schema version 是一个 definition。generic builder 捕获相邻版本的具体 payload types：

```ts
declare const defineRecordAttachmentMigration: <
  Owner extends "run" | "attempt",
  From,
  To,
>(input: {
  readonly from: JsonRecordAttachmentDefinition<Owner, From>;
  readonly to: JsonRecordAttachmentDefinition<Owner, To>;
  readonly convert: (
    value: From,
  ) => Effect.Effect<To, RecordAttachmentMigrationFailure>;
}) => Either.Either<
  RecordAttachmentMigration<Owner>,
  RecordAttachmentMigrationDefinitionError
>;

declare const declareRecordAttachmentMigrationUnavailable: <
  Owner extends "run" | "attempt",
  From,
  To,
>(input: {
  readonly from: JsonRecordAttachmentDefinition<Owner, From>;
  readonly to: JsonRecordAttachmentDefinition<Owner, To>;
  readonly reason: string;
}) => RecordAttachmentMigrationUnavailable<Owner>;
```

builder 要求相同 owner、相同 name，以及精确 `vN → vN+1`。不接受跳过、倒序或跨 RecordAttachment converter。

converter 的 Effect requirement 是 `never`。它可以被中断，也可以报告 typed conversion failure，但不能读取文件、网络、当前 Eval 或进程变量。

一个 family 声明 current definition 与它识别的全部相邻边：

```ts
declare const defineRecordAttachmentFamily: <
  Owner extends "run" | "attempt",
  Current,
>(input: {
  readonly current: JsonRecordAttachmentDefinition<Owner, Current>;
  readonly migrations: readonly RecordAttachmentMigrationEdge<Owner>[];
}) => Either.Either<
  RecordAttachmentFamily<Owner, Current>,
  RecordAttachmentFamilyError
>;
```

每个已声明版本到下一版本必须恰有一个 edge：converter 或 `not-losslessly-migratable`。family 拒绝缺边、重复边、分叉和跳过版本。

`not-losslessly-migratable` 是显式 edge。它让 `niceeval migrate` 保留旧 RecordAttachment bytes，reader 对 current family 返回 `migration-unavailable`，而不是伪造 current value。

## RecordAttachment 写入与读取

```ts
declare const makeRecordAttachmentWrite: <
  Owner extends "run" | "attempt",
  Payload,
>(
  family: RecordAttachmentFamily<Owner, Payload>,
  payload: Payload,
) => RecordAttachmentWrite<Owner>;
```

builder 捕获 definition 与 payload 的 typed pair。实际 encode 在写入 Effect 中执行，codec failure 进入 `RecordWriteError`；调用方不能传 raw name、path 或 `unknown` payload。

读取 current family 后形成：

```ts
type RecordAttachmentRead<Payload> =
  | { readonly state: "available"; readonly value: Payload }
  | { readonly state: "unavailable" }
  | {
      readonly state: "migration-required";
      readonly from: RecordAttachmentSchemaId;
      readonly to: RecordAttachmentSchemaId;
      readonly command: "niceeval migrate";
    }
  | {
      readonly state: "migration-unavailable";
      readonly from: RecordAttachmentSchemaId;
      readonly to: RecordAttachmentSchemaId;
      readonly reason: string;
    }
  | {
      readonly state: "unsupported";
      readonly schemaId: RecordAttachmentSchemaId;
    }
  | {
      readonly state: "invalid";
      readonly issues: NonEmptyReadonlyArray<RecordIssue>;
    };
```

旧 schema 的完整 converter 链对应 `migration-required`。已知路径碰到 `not-losslessly-migratable` 对应 `migration-unavailable`。未注册的 family 或 schema 始终对应 `unsupported`。

这些都是 Projection 可消费的数据状态。真实 I/O、permission 和 closed reader 留在 Effect typed error。

## Write session

```ts
declare const openRecordWriteSession: (input: { readonly root: RecordRoot }) => Effect.Effect<
  RecordWriteSession,
  RecordOpenError | RecordWriteError,
  | Scope.Scope
  | RecordFileSystem
  | RecordMaintenanceLock
  | RecordWriterLock
  | RecordEntropy
>;

interface RecordWriteSession {
  readonly view: FrozenRecordView;

  readonly createRun: (input: { readonly startedAt: UtcMillis; readonly expectedSlots: readonly SlotId[] }) => Effect.Effect<RecordRunDraft, RecordWriteError>;
}

interface RecordRunDraft {
  readonly runId: RunId;

  readonly record: (attachment: RecordAttachmentWrite<"run">) => Effect.Effect<void, RecordWriteError>;
  readonly createAttempt: (input: { readonly slotId: SlotId }) => Effect.Effect<RecordAttemptDraft, RecordWriteError>;
  readonly reference: (input: { readonly slotId: SlotId; readonly attempt: FrozenRecordAttempt }) => Effect.Effect<void, RecordWriteError>;
  readonly publish: (input: { readonly completedAt: UtcMillis }) => Effect.Effect<RecordPublishReceipt, RecordWriteError>;
}

interface RecordAttemptDraft {
  readonly attemptId: AttemptId;

  readonly record: (attachment: RecordAttachmentWrite<"attempt">) => Effect.Effect<void, RecordWriteError>;
}
```

draft 与 attempt 是 session-bound opaque capability。另一个 session 的 draft、已经 publish 的 draft、伪造对象或关闭 Scope 后的调用返回 typed state error。

`reference` 只接受 `session.view` 中的 frozen Attempt。它不能按 ID 猜 latest，也不能引用本 session 尚未完成的 Run。

Evaluation producer 必须先通过 `EvaluationRecordContract`，再调用这些 writer capability。`publish` 只验证 expected slots、Member、origin Attempt、typed RecordAttachment 与 owner-local closure；它 flush 后最后创建零字节 `complete`。完成标识创建后 draft 永久 consumed。

中断发生在完成标识前时，不发布 receipt，也不自动伪造 errored Attempt。未完成目录由 reader warning 与 `niceeval clean` 处理。

```ts
type RecordPublishReceipt = {
  readonly runId: RunId;
  readonly attempts: readonly { readonly slotId: SlotId; readonly ref: RecordAttemptRef }[];
};
```

receipt 不保存 `publishedAt`；durable completion time 是 Run Core 的 `completedAt`。

## 删除未完成 Run

```ts
declare const inspectIncompleteRuns: (input: { readonly root: RecordRoot }) => Effect.Effect<
  readonly RecordIncompleteRun[],
  RecordCleanError,
  RecordFileSystem | RecordMaintenanceLock
>;

declare const cleanIncompleteRuns: (input: { readonly root: RecordRoot; readonly runIds: readonly RunId[] }) => Effect.Effect<
  RecordCleanReceipt,
  RecordCleanError,
  RecordFileSystem | RecordMaintenanceLock | RecordWriterLock
>;
```

clean 取得 writer lock，并在删除前重新检查完成标识。并发 writer 正在工作时返回 busy；已经出现完成标识的目录跳过且不删除。

## Migration plan 与执行

```ts
declare const planRecordMigration: (input: { readonly root: RecordRoot }) => Effect.Effect<
  RecordMigrationPlan,
  RecordMigrationPlanError,
  RecordFileSystem | RecordMaintenanceLock | RecordGit | RecordMigrationRegistry
>;

declare const migrateRecord: (input: {
  readonly plan: RecordMigrationPlan;
  readonly authorization:
    | { readonly state: "git-restore-point" }
    | { readonly state: "accept-data-loss" };
}) => Effect.Effect<
  RecordMigrationReceipt,
  RecordMigrationError,
  RecordFileSystem | RecordMaintenanceLock | RecordGit | RecordMigrationRegistry
>;
```

`RecordMigrationPlan` 是 package-created opaque value，绑定 root snapshot、source identities、installed converter registry 与 Git inspection。输入变化后执行返回 `record-migration-plan-stale`，不能继续使用旧 plan。

公开摘要包含：

```ts
interface RecordMigrationPlanSummary {
  readonly coreSteps: readonly RecordMigrationStep[];
  readonly attachmentSteps: readonly RecordAttachmentMigrationStep[];
  readonly migrationUnavailable: readonly RecordAttachmentMigrationUnavailableSummary[];
  readonly unsupported: readonly UnsupportedRecordAttachmentSummary[];
  readonly warnings: readonly RecordMigrationWarning[];
  readonly git:
    | { readonly state: "restore-point"; readonly commit: string }
    | { readonly state: "unverified"; readonly reason: string };
}
```

preflight 在 plan 返回前验证 source decode、目标 identity、owner preservation、路径冲突与完整 converter 链。Core 缺 converter、family edge 不连续或 Core 无法保留 unknown RecordAttachment owner 时，plan 失败且不写文件。

`migrationUnavailable` 不是 plan failure。执行时保留它的原 bytes，并在摘要与 receipt 中逐项报告。`unsupported` 同样保留原 bytes；两者不可混同。

`migrateRecord` 取得 exclusive maintenance lock，重新验证 plan snapshot，再按相邻步骤执行。每步完成后写入该步 target identity；完整中间版本可以成为下一次 plan 的 source。

步骤内部中断不自动回滚。后续普通 open 拒绝解释混合 root，并提示从 Git 或用户备份恢复。

## Typed errors

```ts
type RecordOpenError = RecordIoError | RecordPermissionError | RecordBusyError | RecordBootstrapInvalid | RecordMigrationRequired | RecordFormatUnsupported;
type RecordReadError = RecordIoError | RecordPermissionError | RecordReaderClosed | RecordHandleInvalid;
type RecordWriteError = RecordIoError | RecordPermissionError | RecordBusyError | RecordWriterClosed | RecordDraftStateError | RecordReferenceInvalid | RecordCoreInvalid | RecordAttachmentEncodeError | RecordAttachmentClosureInvalid;
type RecordMigrationError = RecordIoError | RecordPermissionError | RecordBusyError | RecordMigrationPlanStale | RecordMigrationStepFailed | RecordMigrationInterruptedState;
```

所有错误都有稳定 `code` 与 bounded safe context。原始 filesystem error、Schema tree、stack 和任意第三方 message 不进入 portable data 或默认 CLI JSON；它们只留在受控 diagnostic cause。

interruption 不是这些联合中的一项。Effect finalizer 释放锁和句柄后继续传播 Cause。

## 最小调用形状

```ts
const program = Effect.scoped(
  Effect.gen(function* () {
    const reader = yield* openRecordReader({ root });
    return reader.runs.filter((entry) => entry.state === "available");
  }),
).pipe(Effect.provide(NodeRecordLive));
```

Effect 应用直接组合并运行 `program`。Promise compatibility facade 如果存在，只能包在这条最外层 Effect 外面。

Library 不公开用于 RecordAttachment payload 的 Stream。内部 Stream 只服务 Run 扫描和 blob I/O。
