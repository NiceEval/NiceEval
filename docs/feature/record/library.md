# Record Library

Record Library 暴露四类 Effect-native 能力：打开 current reader、形成 typed Channel projection、发布完整 Run，以及显式迁移旧 major。

普通 reader 不携带跨 major Core decoder。source-major 支持只存在于 migration capability。

## Effect runtime 与 platform

```ts
interface RecordPlatformService {
  readonly fileSystem: RecordFileSystem;
  readonly maintenanceLock: RecordMaintenanceLock;
  readonly writerLock: RecordWriterLock;
  readonly entropy: RecordEntropy;
}

class RecordPlatform extends Context.Tag(
  "@niceeval/record/RecordPlatform",
)<RecordPlatform, RecordPlatformService>() {}

const NodeRecordPlatform = Layer.succeed(
  RecordPlatform,
  nodeRecordPlatformService,
);
```

`RecordPlatform` 是 Effect v3 service tag，不是普通 interface。应用最外层通过 Layer 提供 service；动态 root 是 constructor 参数，不为每个 root 创建 Layer。

Library 内部不调用 `Effect.runPromise`。NiceEval CLI 把 Record、Sample、Reports 与 host 组合成一条 Effect，在 `main` provide `NodeNiceEvalPlatform` 后只调用一次 `Effect.runPromiseExit`。外部 Effect 应用自行 provide 与 run；独立 Promise facade 若存在，也只能在自己的最外层运行一次。

`RecordFileSystem` 必须直接暴露平台级 atomic publish，而不是让 writer 用 `exists + rename` 拼装：

```ts
interface RecordFileSystem {
  readonly atomicPublishDirectoryNoReplace: (input: {
    staging: AbsoluteDirectoryPath;
    target: AbsoluteDirectoryPath;
  }) => Effect.Effect<
    void,
    | AtomicPublishTargetExists
    | AtomicPublishCrossDevice
    | AtomicPublishUnsupported
    | RecordFileSystemFailure
  >;

  readonly syncFile: (path: AbsoluteFilePath) => Effect.Effect<void, RecordFileSystemFailure>;
  readonly syncDirectory: (path: AbsoluteDirectoryPath) => Effect.Effect<void, RecordFileSystemFailure>;
}
```

Node 标准 `fs.rename` 不满足 no-replace contract。Node live implementation 需要调用操作系统的 exclusive rename primitive；当前平台或文件系统不能证明该能力时返回 typed unsupported，不得 fallback 到普通 rename 或 copy。

## 打开 current Record

```ts
declare const openRecordReader: (input: {
  root: RecordRoot;
}) => Effect.Effect<
  RecordReader,
  RecordOpenError,
  Scope.Scope | RecordPlatform
>;
```

constructor 先检查 local migration state，再读取固定 bootstrap。只有 current major 能返回 `RecordReader`。

已知旧 major 返回 `record-migration-required`：

```ts
type RecordMigrationRequired = {
  readonly code: "record-migration-required";
  readonly sourceFormat: RecordFormatId;
  readonly targetFormat: CurrentRecordFormatId;
  readonly command: "niceeval migrate";
};
```

future 与 foreign format 返回 `record-format-unsupported`。Library 不提供 compat mode 或自动 in-memory adapter。

## Reader 与 frozen handles

```ts
interface RecordReader {
  readonly candidates: Effect.Effect<
    readonly CoreRead<RunSummary>[],
    RecordReadError
  >;

  readonly run: (
    runId: RunId,
  ) => Effect.Effect<CoreRead<FrozenRun>, RecordReadError>;

  readonly freezeSelection: (
    runIds: readonly RunId[],
  ) => Effect.Effect<FrozenRecordSelection, RecordReadError>;

  readonly projectRun: <Value>(
    run: FrozenRun,
    projector: ChannelProjector<"run", Value>,
  ) => Effect.Effect<ChannelProjectionResult<Value>, RecordReadError>;

  readonly projectAttempt: <Value>(
    attempt: FrozenAttempt,
    projector: ChannelProjector<"attempt", Value>,
  ) => Effect.Effect<ChannelProjectionResult<Value>, RecordReadError>;
}
```

`FrozenRun` 与 `FrozenAttempt` 是 reader 创建的 branded handle。来自另一 reader 或调用方伪造的 handle 返回 `record-selection-invalid`。

`freezeSelection` 只能从 candidate set 选择 Run。它可以沿 Member 的精确引用形成 dependency closure，但不能把 origin Run 加进 Sample 分母。

reader 的 Scope 持有 shared maintenance lease 与文件 handle。Scope 关闭后全部方法返回 `record-reader-closed`。

## CoreRead

```ts
type CoreRead<Value> =
  | { state: "read"; value: Value }
  | { state: "invalid"; issues: NonEmptyRecordIssues };
```

Core entry 损坏是可隔离的读取结果。权限、真实 I/O 与 closed Scope 是 Effect error。

## Channel definition

```ts
declare const defineJsonChannel: <
  Owner extends "run" | "attempt",
  Payload extends PortableJsonValue,
>(input: {
  owner: Owner;
  name: ChannelName;
  schemaId: ChannelSchemaId;
  schema: ClosedPortableJsonSchema<Payload>;
}) => JsonChannelDefinition<Owner, Payload>;
```

`defineJsonChannel` 同时拥有写入 encoder 与精确 decoder。它拒绝 excess property，也不自动注入 `observedAt` 或其它业务字段。

第三方 name 必须使用自己的 reverse-domain namespace。`niceeval.*` 只能由官方 feature owner 定义。

Library 不提供 raw `name + JsonValue`、`defineOpaqueJsonChannel` 或普遍的 `ctx.writeChannel`。producer 只能通过自己持有的 typed definition 写入。

## Channel projector

```ts
declare const defineJsonChannelProjector: <
  Owner extends "run" | "attempt",
  Value,
>(input: {
  owner: Owner;
  channel: ChannelName;
  cases: readonly JsonProjectionCase<Owner, unknown, Value>[];
}) => ChannelProjector<Owner, Value>;
```

一个 case 绑定一个 `JsonChannelDefinition`，并把已解码 payload 投影成 `Value` 或显式 issues：

```ts
interface JsonProjectionCase<Owner, Payload, Value> {
  readonly schema: JsonChannelDefinition<Owner, Payload>;
  readonly project: (
    payload: Payload,
  ) => Result<Value, NonEmptyProjectionIssues>;
}
```

projector 不收到 bytes、path、reader、其它 Channel 或外部 service。这个参数边界减少意外 capability，但不隔离 JavaScript 闭包；内建 callback 遵守纯函数约定，第三方 callback 属受信任代码。

```ts
const endpointV1 = defineJsonChannel({
  owner: "run",
  name: "com.example.nowledge.endpoint",
  schemaId: "com.example.nowledge.endpoint/v1",
  schema: EndpointV1Schema,
});

const endpointProjector = defineJsonChannelProjector({
  owner: "run",
  channel: endpointV1.name,
  cases: [
    {
      schema: endpointV1,
      project: (payload) => Result.succeed({ url: payload.url }),
    },
  ],
});
```

projector 是带 private token 的 branded definition。一个进程内只按该 token 或对象 identity 去重，不注册跨进程公共 ID；两个独立 projector 即使读取同名 Channel，也可以形成不同 typed view。

既有 projector 可以增加能无损形成同一 `Value` 的 schema case。返回类型或解释发生破坏性变化时发布新的 projector export/API；Record bytes 不因此改变。

case 返回的 issues 形成该 `ChannelProjectionResult.invalid`。callback 意外 throw 是 defect；Report host 可以把第三方 defect 隔离成 `execution-failed`，但不能把它标为 Record input invalid，interruption 也不能被捕获成普通 failure。

## ChannelProjectionResult

`projectRun` 与 `projectAttempt` 返回 [Architecture](architecture.md#channelprojectionresult) 定义的 `ChannelProjectionResult<Value>`。

```ts
declare const requireComplete: <Value>(
  read: ChannelProjectionResult<Value>,
) => Result<Value, NonEmptyProjectionIssues>;
```

`requireComplete` 只检查 collection 与 decoding。`Value` 若含 sampled、redacted 或 truncated limitation，consumer 还必须按自己的领域要求检查。

## Identity 与路径类型

```ts
type RecordId = string & Brand<"RecordId">;
type RunId = string & Brand<"RunId">;
type SlotId = string & Brand<"SlotId">;
type AttemptId = string & Brand<"AttemptId">;
type ChannelName = string & Brand<"ChannelName">;
type ChannelSchemaId = string & Brand<"ChannelSchemaId">;
type UtcMillis = string & Brand<"UtcMillis">;
```

`RecordId` 是 canonical lowercase UUID v4。复制与无损 migration 保留它。

RunId、SlotId、AttemptId、InvocationId 与 SessionId 是 128-bit opaque ID。canonical 文本使用 26 个 uppercase Crockford Base32 字符。

`UtcMillis` 是精确 RFC 3339 UTC 毫秒文本。Channel name、schema identity 与固定目录规则由 [Architecture](architecture.md#channelenvelopev1) 定义。

所有 branded constructor 都是精确 parser，不修剪、不 lower-case、不猜测旧写法。

## Generic write session

```ts
declare const openRecordWriteSession: (input: {
  root: RecordRoot;
  createIfMissing: boolean;
}) => Effect.Effect<
  RecordWriteSession,
  RecordOpenError | RecordWriteError,
  Scope.Scope | RecordPlatform
>;

interface RecordWriteSession {
  readonly view: FrozenRecordView;

  readonly stageRun: (
    input: StagedRunInput,
  ) => Effect.Effect<StagedRun, RecordWriteError>;

  readonly sealRun: (
    run: StagedRun,
  ) => Effect.Effect<SealedRun, RecordWriteError>;

  readonly publishRun: (
    run: SealedRun,
  ) => Effect.Effect<PublishReceipt, RecordWriteError>;
}
```

write session 取得 shared maintenance lease，再取得 exclusive writer lock。它打开一次 frozen view，reuse planning 与 reference validation 共用这份视图。

`stageRun` 只接收 typed Core 与 typed Channel writes。它不接受 raw JSON envelope 或任意物理 path。

`sealRun` 验证 Core、独立 Channel closure、references、sync 与 manifest。官方 producer 在调用 `stageRun` 前用内部 `EvaluationRecordContract` 验证领域 aggregate。

Scope 关闭时先拒绝新操作，再等待 in-flight local write。它只删除仍由本 session 拥有的 unsealed staging directory，不删除 sealed source、已发布 Run 或 outcome-unknown 现场。

## Evaluation aggregate validation

Generic Record Library 不拥有 Assertions、Verdict 或 Evaluation 的 required 集合。官方 Evaluation producer 在自己的边界使用内部 contract：

```ts
interface EvaluationRecordContract {
  readonly validate: (
    aggregate: EvaluationRunAggregate,
  ) => Result<ValidatedEvaluationRun, NonEmptyEvaluationRecordIssues>;
}
```

contract validation 是写入前的纯边界。通过后再转换成 `StagedRunInput`；generic writer 不重复业务判断。它是 Evaluation owner 的局部实现契约，不是 Record glossary 或公共版本 identity。

custom producer 可以验证自己的 aggregate，但不能占用 Record 的 `niceeval.*` namespace 或绕开 typed Channel definition。

## Run publish recovery

```ts
declare const recoverRecordSession: (input: {
  root: RecordRoot;
  sessionId: SessionId;
}) => Effect.Effect<RecoveryReceipt, RecordRecoveryError, RecordPlatform>;

declare const abandonRecordSession: (input: {
  root: RecordRoot;
  sessionId: SessionId;
}) => Effect.Effect<void, RecordRecoveryError, RecordPlatform>;
```

`recoverRecordSession` 只完成 sealed Run 的 commit、validation、sync 与 cleanup。它不恢复模型、Sandbox、producer 或 reuse planning。

`abandonRecordSession` 只删除一个明确 session 的 local state。它从不修改 portable Record。

## Record major migration

```ts
interface RecordMigrationPlatformService {
  readonly current: RecordPlatformService;
  readonly converters: RecordMigrationConverterRegistry;
}

class RecordMigrationPlatform extends Context.Tag(
  "@niceeval/record/RecordMigrationPlatform",
)<RecordMigrationPlatform, RecordMigrationPlatformService>() {}

declare const migrateRecord: (input: {
  root: RecordRoot;
}) => Effect.Effect<
  RecordMigrationReceipt,
  RecordMigrationError,
  RecordMigrationPlatform
>;
```

`RecordMigrationPlatform` 是 migration-only service tag，包含 current platform 与 source-major decoder/converter registry。普通 reader 不依赖这份 registry。

`migrateRecord` 取得 exclusive maintenance lease，再按 source version 取得 writer lock。它沿相邻 converter chain materialize、validate、比较 inventory，最后原地 cutover。

返回的 receipt 只存在于当前进程：

```ts
type RecordMigrationReceipt = {
  readonly recordId: RecordId;
  readonly sourceFormat: RecordFormatId;
  readonly targetFormat: CurrentRecordFormatId;
};
```

receipt 不写入 Record。Library 不提供 output root、rollback、dry migration 或 keep-backup 参数。

已有 migration state 时，同一个调用先按 recovery matrix 收敛现场，再继续或完成 cleanup。

## Typed errors

```ts
type RecordOpenError =
  | { code: "record-root-missing"; root: string }
  | RecordMigrationRequired
  | { code: "record-migration-recovery-required"; command: "niceeval migrate" }
  | { code: "record-format-unsupported"; format?: string }
  | { code: "record-core-invalid"; issues: NonEmptyRecordIssues }
  | { code: "record-maintenance-busy" }
  | { code: "record-io-failed"; operation: string; cause: unknown };

type RecordWriteError =
  | { code: "record-writer-busy" }
  | { code: "record-session-closed" }
  | { code: "record-publish-target-exists"; runId: RunId }
  | { code: "record-atomic-publish-cross-device" }
  | { code: "record-atomic-publish-unsupported"; platform: string }
  | { code: "record-publish-invalid"; issues: NonEmptyRecordIssues }
  | { code: "record-publish-outcome-unknown" };

type RecordMigrationError =
  | RecordOpenError
  | { code: "record-migration-not-needed"; format: CurrentRecordFormatId }
  | { code: "record-migration-path-unavailable"; sourceFormat: RecordFormatId }
  | { code: "record-migration-not-lossless"; issues: NonEmptyMigrationIssues }
  | { code: "record-migration-scene-invalid"; issues: NonEmptyMigrationIssues };
```

每个 CLI error 都包含安全的下一步。path、OS cause 与可能含敏感内容的 payload 不直接进入公开 message。
