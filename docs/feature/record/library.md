# Record Library

Record Library 暴露四类 Effect-native 能力：打开 current reader、形成 typed Channel projection、发布完整 Run，以及显式迁移旧 major。

普通 reader 不携带跨 major Core decoder。source-major 支持只存在于 migration capability。

## Effect runtime 与 platform

平台能力拆成四个独立 `Context.Tag`，没有把它们打包成一个聚合 tag 的公开形态。reader 只依赖 FileSystem 与 MaintenanceLease，不被强迫持有 writer lock 或 entropy 能力：

```ts
class RecordFileSystem extends Context.Tag(
  "@niceeval/record/RecordFileSystem",
)<RecordFileSystem, RecordFileSystemService>() {}

class RecordMaintenanceLease extends Context.Tag(
  "@niceeval/record/RecordMaintenanceLease",
)<RecordMaintenanceLease, RecordMaintenanceLeaseService>() {}

class RecordWriterLock extends Context.Tag(
  "@niceeval/record/RecordWriterLock",
)<RecordWriterLock, RecordWriterLockService>() {}

class RecordEntropy extends Context.Tag(
  "@niceeval/record/RecordEntropy",
)<RecordEntropy, RecordEntropyService>() {}
```

`NodeRecordLive` 只把这些 Layer merge 起来，不公开任何聚合 service：

```ts
const NodeRecordLive = Layer.mergeAll(
  NodeRecordFileSystemLive,
  NodeRecordMaintenanceLeaseLive,
  NodeRecordWriterLockLive,
  NodeRecordEntropyLive,
);
```

四个 tag 都是 Effect v3 service tag，不是普通 interface。应用最外层通过 Layer 提供；动态 root 是 constructor 参数，不为每个 root 创建 Layer。

Library 内部不调用 `Effect.runPromise`。NiceEval CLI 把 Record、Sample、Reports 与 host 组合成一条 Effect，在 `main` provide `NodeNiceEvalPlatform` 后只调用一次 `Effect.runPromiseExit`。外部 Effect 应用自行 provide 与 run；独立 Promise facade 若存在，也只能在自己的最外层运行一次。

`RecordFileSystemService` 以 opened no-follow handle 与 pinned leaf 表达全部操作，不跨调用重开 absolute path：

```ts
interface RecordFileSystemService {
  readonly openDirectoryNoFollow: (input: {
    parent?: OpenedDirHandle;
    name: string;
  }) => Effect.Effect<OpenedDirHandle, RecordFileSystemFailure>;

  readonly exclusiveRenameNoReplace: (input: {
    sourceParent: OpenedDirHandle;
    sourceLeaf: PinnedLeaf;
    targetParent: OpenedDirHandle;
    targetLeaf: PinnedLeaf;
  }) => Effect.Effect<
    void,
    | AtomicPublishTargetExists
    | AtomicPublishCrossDevice
    | AtomicPublishUnsupported
    | RecordFileSystemFailure
  >;

  readonly syncFile: (handle: OpenedFileHandle) => Effect.Effect<void, RecordFileSystemFailure>;
  readonly syncDirectory: (handle: OpenedDirHandle) => Effect.Effect<void, RecordFileSystemFailure>;
  readonly syncTree: (parent: OpenedDirHandle, leaf: PinnedLeaf) => Effect.Effect<void, RecordFileSystemFailure>;
}
```

source-parent 与 target-parent 可以是不同父目录，只要求同一文件系统或 volume。发布顺序固定：`syncTree(sourceParent, sourceLeaf)`、`syncDirectory(sourceParent)`、`exclusiveRenameNoReplace`、`syncDirectory(targetParent)`。

Node 标准 `fs.rename` 不满足 no-replace contract。Node live implementation 需要调用操作系统的 exclusive rename primitive；平台或文件系统只能证明同父 rename 时返回 typed unsupported，不得 fallback 到普通 rename 或 copy。

## 打开 current Record

```ts
declare const openRecordReader: (input: {
  root: RecordRoot;
}) => Effect.Effect<
  RecordReader,
  RecordOpenError,
  Scope.Scope | RecordFileSystem | RecordMaintenanceLease
>;
```

constructor 先从唯一 lock anchor 定位 local control sidecar（canonical locator 派生，root 缺失也能定位），并取得同一 shared maintenance lease。随后检查 lineage 与 migration state，再读取固定 bootstrap。只有 current major 能返回 `RecordReader`。

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
  readonly candidates: Stream.Stream<
    RecordCoreRead<RunSummary>,
    RecordReadError
  >;

  readonly latest: (input: {
    limit: number;
  }) => Stream.Stream<RecordCoreRead<RunSummary>, RecordReadError>;

  readonly run: (
    runId: RunId,
  ) => Effect.Effect<RecordCoreRead<FrozenRun>, RecordReadError>;

  readonly freezeSelection: (
    runIds: readonly RunId[],
  ) => Effect.Effect<FrozenRecordSelection, RecordReadError>;

  readonly projectRun: <Value>(
    run: FrozenRun,
    projector: RecordChannelProjector<"run", Value>,
  ) => Effect.Effect<ChannelProjectionResult<Value>, RecordReadError>;

  readonly projectAttempt: <Value>(
    attempt: FrozenAttempt,
    projector: RecordChannelProjector<"attempt", Value>,
  ) => Effect.Effect<ChannelProjectionResult<Value>, RecordReadError>;
}
```

`candidates` 与 `latest` 是 bounded streaming，不一次性构造百万 `RecordCoreRead` 数组。`latest` 按 raw entry bytes 排序后取前 `limit` 个；内存按固定批次大小上界，时间 O(runs) 单遍。

`FrozenRun` 与 `FrozenAttempt` 是 reader 创建的 branded handle。来自另一 reader 或调用方伪造的 handle 返回 `record-selection-invalid`；来自其它 session 的 handle 返回 `record-session-mismatch`。

`freezeSelection` 只能从 candidate set 选择 Run。它可以沿 Member 的精确引用形成 dependency closure，但不能把 origin Run 加进 Sample 分母。

reader 的 Scope 持有 shared maintenance lease 与文件 handle。Scope 关闭后全部方法返回 `record-reader-closed`。

## RecordCoreRead

```ts
type RecordCoreRead<Value> =
  | { state: "read"; value: Value }
  | { state: "core-invalid"; issues: NonEmptyRecordIssues }
  | { state: "missing" };
```

Core entry 损坏是可隔离的读取结果。权限、真实 I/O 与 closed Scope 是 Effect error。

枚举（`candidates`）只产生 `read | core-invalid`；`missing` 只出现在按 identity 查找时。查找返回 `read` 表示该 entry 存在且可读，`core-invalid` 表示存在但损坏，`missing` 表示不存在。

## Channel definition

```ts
declare const defineJsonChannel: <
  Owner extends "run" | "attempt",
  S extends Schema.AnyNoContext,
>(input: {
  owner: Owner;
  name: string;
  schemaId: string;
  mediaType: "application/json" | "application/x-ndjson";
  schema: S;
}) => Either.Either<
  JsonChannelDefinition<Owner, Schema.Type<S>>,
  RecordChannelDefinitionError
>;
```

decoded `Payload` 与 schema-specific encoded `I` 都不声明递归 JSON 上限（如 `PortableJsonValue` 一类 union）。`S extends Schema.AnyNoContext` 从 exact schema 推导 `Type<S>` 与 `Encoded<S>`，固定 parse options `errors: "all"` 与 `onExcessProperty: "error"`。JSON wire 仍是 closed exact JSON，不允许原生 bytes，`Date`、`BigInt` 必须显式 transform。

`defineJsonChannel` 接收 raw string：name 与 schemaId 在内部 parse 成 brand，并完成 `niceeval.` reserved 检查。调用方不能先构造 brand 再得到 name-invalid，parse 失败返回具名错误，没有异常出口：

```ts
type RecordChannelDefinitionError =
  | { code: "niceeval-namespace-reserved"; name: string }
  | { code: "record-channel-name-invalid"; name: string }
  | { code: "record-channel-schema-id-invalid"; schemaId: string }
  | { code: "record-channel-media-type-invalid"; mediaType: string }
  | { code: "record-channel-schema-invalid"; issues: NonEmptyRecordIssues };
```

definition 同时拥有写入 encoder 与精确 decoder。它拒绝 excess property，也不自动注入 `observedAt` 或其它业务字段。官方 built-in 由包内私有 constructor 构造，不经过公开 `defineJsonChannel`。

definition 的运行时 authority 是包内 WeakMap 中的 exact object identity：复制公开字段或 `_typeId` 的对象不在 WeakMap 中，任何 API 都返回 `record-definition-forged`。

Library 不提供 raw `name + JsonValue`、`defineOpaqueJsonChannel` 或普遍的 `ctx.writeChannel`。producer 只能通过自己持有的 typed definition 写入。

## Typed Channel write

```ts
declare const recordChannelWriteTypeId: unique symbol;

type RecordChannelWrite<Owner extends "run" | "attempt"> = {
  readonly [recordChannelWriteTypeId]: { readonly owner: Owner };
};

declare const makeRecordChannelWrite: <
  Owner extends "run" | "attempt",
  Payload,
>(
  definition: JsonChannelDefinition<Owner, Payload>,
  payload: Payload,
) => Either.Either<RecordChannelWrite<Owner>, RecordChannelWriteError>;
```

`makeRecordChannelWrite` 捕获 `(definition, payload)` typed pair，并立即用 definition 的 codec 验证 payload；验证失败返回 `record-channel-write-invalid`，没有异常出口。payload 存进以 write 对象为 key 的包内 WeakMap。

```ts
type RecordChannelWriteError =
  | {
      code: "record-channel-write-invalid";
      schemaId: RecordChannelSchemaId;
      issues: NonEmptyRecordIssues;
    }
  | { code: "record-write-forged" };
```

write 公开为 opaque：没有 definition 或 payload 字段，公开字段不构成 authority。数组擦除 `Payload` 后仍保留 `Owner`：`RecordChannelWrite<"run">[]` 不能出现在 attempt 槽位，owner 混用在类型层即被拒绝，运行时 owner 检查作为最终防线。transplant 复制的对象不在 WeakMap 中，stage 时返回 `record-write-forged`。

## Channel projector

```ts
declare const defineJsonChannelProjector: <
  Owner extends "run" | "attempt",
  Value,
  Cases extends readonly [
    ProjectionCase<Owner, unknown, Value>,
    ...readonly ProjectionCase<Owner, unknown, Value>[],
  ],
>(input: {
  owner: Owner;
  channel: RecordChannelName;
  output: PortableValueCodec<Value>;
  cases: Cases;
}) => Either.Either<
  RecordChannelProjector<Owner, Value>,
  RecordProjectorDefinitionError
>;
```

case 由 builder 构造，builder 在构造点捕获 `Payload` 并存入包内 WeakMap，返回 erased base：

```ts
declare const projectionCase: <
  Owner extends "run" | "attempt",
  Payload,
  Value,
>(input: {
  schema: JsonChannelDefinition<Owner, Payload>;
  project: (
    payload: Payload,
  ) => Either.Either<Value, NonEmptyProjectionIssues>;
}) => ProjectionCase<Owner, unknown, Value>;
```

projector 接受 nonempty tuple，不用 `unknown` invariant 数组。constructor 验证：cases 非空、每个 case 的 schema owner 与 `input.owner` 相同、schema 属于 `input.channel`、schema case 不重复（按 schema 对象 identity）。验证失败返回具名 Either：

```ts
type RecordProjectorDefinitionError =
  | { code: "projector-cases-empty" }
  | { code: "projector-case-duplicate-schema"; schemaId: RecordChannelSchemaId }
  | { code: "projector-case-mismatch"; reason: string }
  | { code: "projector-output-invalid"; issues: NonEmptyRecordIssues };
```

projector 是 output codec 的唯一 owner：

```ts
interface RecordChannelProjector<Owner extends "run" | "attempt", Value> {
  readonly owner: Owner;
  readonly channel: RecordChannelName;
  readonly output: PortableValueCodec<Value>;
}
```

`Value` 按 `output` codec 的 encode + decode 真实设为 invariant，不伪称 covariant。constructor 捕获 typed codec 并私有注册；`RecordProjection` 与 `Frame` 不得再复制一份 codec。projector 的运行时 authority 是包内 WeakMap 中的 exact object identity，复制公开字段的对象返回 `record-projector-forged`。

projector 不收到 bytes、path、reader、其它 Channel 或外部 service。这个参数边界减少意外 capability，但不隔离 JavaScript 闭包；内建 callback 遵守纯函数约定，第三方 callback 属受信任代码。

```ts
Effect.gen(function* () {
  const endpointV1 = yield* defineJsonChannel({
    owner: "run",
    name: "com.example.knowledge.endpoint",
    schemaId: "com.example.knowledge.endpoint/v1",
    mediaType: "application/json",
    schema: EndpointV1Schema,
  });

  const endpointProjector = yield* defineJsonChannelProjector({
    owner: "run",
    channel: endpointV1.name,
    output: EndpointViewCodec,
    cases: [
      projectionCase({
        schema: endpointV1,
        project: (payload) => Either.right({ url: payload.url }),
      }),
    ],
  });
});
```

projector 是带包内注册的 typed adapter。一个进程内只按 exact object identity 去重，不注册跨进程公共 ID；两个独立 projector 即使读取同名 Channel，也可以形成不同 typed view。

既有 projector 可以增加能无损形成同一 `Value` 的 schema case。返回类型或解释发生破坏性变化时发布新的 projector export/API；Record bytes 不因此改变。

case 返回的 issues 形成该 `ChannelProjectionResult.invalid`。callback 意外 throw 是 defect；Report host 可以把第三方 defect 隔离成 `execution-failed`，但不能把它标为 Record input invalid，interruption 也不能被捕获成普通 failure。

Library 不导出自定义 `Result` 类型。成功值内的失败分支一律使用 Effect v3 的 `Either.Either`；I/O、权限与生命周期失败保持 typed Effect error。

## ChannelProjectionResult

`projectRun` 与 `projectAttempt` 返回 [Architecture](architecture.md#channelprojectionresult) 定义的 `ChannelProjectionResult<Value>`。

```ts
declare const requireComplete: <Value>(
  read: ChannelProjectionResult<Value>,
) => Either.Either<Value, NonEmptyProjectionIssues>;
```

`requireComplete` 只检查 collection 与 decoding。`Value` 若含 sampled、redacted 或 truncated limitation，consumer 还必须按自己的领域要求检查。

## Identity 与路径类型

```ts
type RecordRoot = AbsoluteDirectoryPath & Brand<"RecordRoot">;
type RecordId = string & Brand<"RecordId">;
type RunId = string & Brand<"RunId">;
type SlotId = string & Brand<"SlotId">;
type AttemptId = string & Brand<"AttemptId">;
type RecordChannelName = string & Brand<"RecordChannelName">;
type RecordChannelSchemaId = string & Brand<"RecordChannelSchemaId">;
type RecordChannelMediaType = string & Brand<"RecordChannelMediaType">;
type UtcMillis = string & Brand<"UtcMillis">;
```

`RecordRoot` 是 canonical absolute directory path 的 brand。constructor 按 [Architecture](architecture.md#recordkey-与-root-定位) 的 locator 规则打开或创建 root：逐段 handle-relative open、拒绝 symlink 与 reparse point，并派生 `recordKey` 映射 lock anchor 与 staging。`root` 只接受 absolute path 或 absolute `file://` URL；平台不能证明逐段 no-follow 打开语义时返回 typed unsupported。

`RecordId` 是 canonical lowercase UUID v4。复制与无损 migration 保留它。

RunId、SlotId、AttemptId、InvocationId 与 SessionId 是 128-bit opaque ID。canonical 文本使用 26 个 uppercase Crockford Base32 字符。

`RecordChannelName`、`RecordChannelSchemaId` 与 `RecordChannelMediaType` 的 exact grammar 与 UTF-8 byte limit 见 [Architecture](architecture.md#channelenvelopev1)。落盘物理 segment 是包内私有 `RecordChannelDirectorySegment`。

`UtcMillis` 是精确 RFC 3339 UTC 毫秒文本。

所有 branded constructor 都是精确 parser，不修剪、不 lower-case、不猜测旧写法。公开 constructor 接收 raw string 并返回 Either；不存在「先构造 brand 再报 invalid」的调用形状。

## Generic write session

```ts
declare const openRecordWriteSession: (input: {
  root: RecordRoot;
  createIfMissing: boolean;
}) => Effect.Effect<
  RecordWriteSession,
  RecordOpenError | RecordWriteError,
  | Scope.Scope
  | RecordFileSystem
  | RecordMaintenanceLease
  | RecordWriterLock
  | RecordEntropy
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
  ) => Effect.Effect<RecordPublishReceipt, RecordWriteError>;
}
```

write session 从唯一 anchor 取得 shared maintenance lease，再取得 exclusive writer lock。它打开一次 frozen view，reuse planning 与 reference validation 共用这份视图。preflight 同时验证 target-volume staging capability：平台只支持同父 rename 时返回 `record-atomic-publish-unsupported`。

`stageRun` 只接收 typed Core 与 typed Channel writes。Run 级槽位是 `RecordChannelWrite<"run">`，Attempt 级槽位是 `RecordChannelWrite<"attempt">`，reference Member 用 `FrozenAttempt` handle 表达。它不接受 raw JSON envelope 或任意物理 path。

`sealRun` 验证 Core、独立 Channel closure、references、sync 与 manifest。官方 producer 在调用 `stageRun` 前用内部 `EvaluationRecordContract` 验证领域 aggregate。

Scope 关闭时先拒绝新操作，再等待 in-flight local write。它只删除仍由本 session 拥有的 unsealed staging directory，不删除 sealed source、已发布 Run 或 outcome-unknown 现场。

## StagedRunInput 与 frozen view

```ts
type StagedRunInput = {
  readonly runId: RunId;
  readonly experimentId: ExperimentId;
  readonly startedAt: UtcMillis;
  readonly completedAt: UtcMillis;
  readonly expectedSlots: readonly ExpectedSlotV1[];
  readonly originAttempts: readonly StagedOriginAttempt[];
  readonly referenceMembers: readonly StagedReferenceMember[];
  readonly runChannels: readonly RecordChannelWrite<"run">[];
};

type StagedOriginAttempt = {
  readonly attemptId: AttemptId;
  readonly originSlotId: SlotId;
  readonly channels: readonly RecordChannelWrite<"attempt">[];
};

type StagedReferenceMember = {
  readonly slotId: SlotId;
  readonly attempt: FrozenAttempt;
};
```

`StagedRunInput` 穷尽表达一次发布需要的 Core 事实：expected slots 分母、新 origin Attempt、reference Member 与 Run 级 Channel。`completedAt` 必填：`stageRun` 拒绝缺少 `completedAt` 的输入，portable Record 中不存在未完成的 Run。

每个 origin Attempt 恰有一个 origin Member：`originSlotId` 必须属于 `expectedSlots`，且该 slot 的 Member 由 `stageRun` 锚定到本 Run 的 `attemptId`。两个 origin Attempt 不能共享同一 `originSlotId`，同一 `attemptId` 也不能出现两次。

reference Member 的 `attempt` 必须来自同一 session `view.attempt(...)` 返回的 `FrozenAttempt` handle。伪造 handle 返回 `record-selection-invalid`，来自其它 session 的 handle 返回 `record-session-mismatch`；reference 因此只能指向 frozen view 中已发布的精确 Attempt。

```ts
type FrozenRecordView = {
  readonly candidates: Stream.Stream<RecordCoreRead<RunSummary>, RecordReadError>;
  readonly attempt: (
    originRunId: RunId,
    attemptId: AttemptId,
  ) => RecordCoreRead<FrozenAttempt>;
  readonly projectAttempt: <Value>(
    attempt: FrozenAttempt,
    projector: RecordChannelProjector<"attempt", Value>,
  ) => Effect.Effect<ChannelProjectionResult<Value>, RecordReadError>;
  readonly projectRun: <Value>(
    run: FrozenRun,
    projector: RecordChannelProjector<"run", Value>,
  ) => Effect.Effect<ChannelProjectionResult<Value>, RecordReadError>;
};
```

`FrozenRecordView` 是 session 取得锁时冻结的候选集合与 Attempt 查找表。reuse planning 与 reference validation 共用它。`attempt` 返回三态 `RecordCoreRead`：`read`、`core-invalid` 或 `missing`。

受控 project capability 返回 Effect：按需 payload/blob I/O 与 `PortableValueCodec` 输出都可中断，closed Scope 与 session 失配进入 `RecordReadError`。reuse planning 用它读取 Verdict、score、eligibility 与 evaluations，并形成有界的 analysis selection；它不暴露 path、raw bytes 或 reader handle。

## StagedRun、SealedRun 与 receipt

```ts
declare const stagedRunTypeId: unique symbol;
declare const sealedRunTypeId: unique symbol;

type StagedRun = {
  readonly [stagedRunTypeId]: {
    readonly session: RecordWriteSession;
    readonly state: "staged";
  };
};

type SealedRun = {
  readonly [sealedRunTypeId]: {
    readonly session: RecordWriteSession;
    readonly state: "sealed";
  };
};

type RecordPublishReceipt = {
  readonly recordId: RecordId;
  readonly runId: RunId;
};
```

handle 的 TypeId 编码创建它的 session 与阶段。`StagedRun` 只能由创建它的 session 消费一次；`SealedRun` 只能由同一 session 的 `publishRun` 发布一次。

跨 session 使用 handle 返回 `record-session-mismatch`，重复消费返回 `record-handle-already-consumed`。阶段错误返回 `record-wrong-state`，例如对 `StagedRun` 调 `publishRun`，或对 `SealedRun` 再 stage。两个句柄都不能被复制、持久化或跨 session 传递。

`RecordPublishReceipt` 只证明该 Run 已以 no-replace rename 在 durable root 可见，且 parent `fsync` 完成。它只携带 `recordId` 与 `runId`，不携带时间戳：时间由 Run 文档的 `startedAt` 与 `completedAt` 承载。它也不复制 Channel payload、Verdict、score 或聚合读数。

## Evaluation aggregate validation

Generic Record Library 不拥有 Assertions、Verdict 或 Evaluation 的 required 集合。官方 Evaluation producer 在自己的边界使用内部 contract：

```ts
interface EvaluationRecordContract {
  readonly validate: (
    aggregate: EvaluationRunAggregate,
  ) => Either.Either<ValidatedEvaluationRun, NonEmptyEvaluationRecordIssues>;
}
```

contract validation 是写入前的纯边界。通过后再转换成 `StagedRunInput`；generic writer 不重复业务判断。它是 Evaluation owner 的局部实现契约，不是 Record glossary 或公共版本 identity。

custom producer 可以验证自己的 aggregate，但不能占用 Record 的 `niceeval.*` namespace 或绕开 typed Channel definition。

## Run publish recovery

```ts
declare const recoverRecordSession: (input: {
  root: RecordRoot;
  sessionId: SessionId;
}) => Effect.Effect<
  RecoveryReceipt,
  RecordRecoveryError,
  | Scope.Scope
  | RecordFileSystem
  | RecordMaintenanceLease
  | RecordWriterLock
>;

declare const abandonRecordSession: (input: {
  root: RecordRoot;
  sessionId: SessionId;
}) => Effect.Effect<
  void,
  RecordRecoveryError,
  Scope.Scope | RecordFileSystem | RecordMaintenanceLease | RecordWriterLock
>;
```

`recoverRecordSession` 只完成 sealed Run 的 commit、validation、sync 与 cleanup。它不恢复模型、Sandbox、producer 或 reuse planning。

`abandonRecordSession` 只删除一个明确 session 的 staging 与 control state。它从不修改 portable Record。

## Record major migration

```ts
class RecordMigrationConverters extends Context.Tag(
  "@niceeval/record/RecordMigrationConverters",
)<RecordMigrationConverters, RecordMigrationConverterRegistry>() {}

declare const migrateRecord: (input: {
  root: RecordRoot;
}) => Effect.Effect<
  RecordMigrationReceipt,
  RecordMigrationError,
  | Scope.Scope
  | RecordFileSystem
  | RecordMaintenanceLease
  | RecordWriterLock
  | RecordMigrationConverters
>;
```

migration 复用同一组拆分 tag：FileSystem、MaintenanceLease 与 WriterLock 与普通 writer 相同，只有 converter registry 是 migration-only tag。普通 reader 不依赖 registry，也不依赖 writer lock 与 entropy。

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
  | { code: "record-bootstrap-invalid"; issues: NonEmptyRecordIssues }
  | { code: "record-sidecar-stale" }
  | { code: "record-sidecar-recovery-required" }
  | { code: "record-sidecar-capability-unsupported" }
  | { code: "record-sidecar-permission-denied" }
  | { code: "record-maintenance-busy" }
  | { code: "record-io-failed"; operation: string; cause: unknown };

type RecordReadError =
  | { code: "record-reader-closed" }
  | { code: "record-selection-invalid"; issues: NonEmptyRecordIssues }
  | { code: "record-session-mismatch" }
  | { code: "record-handle-already-consumed" }
  | { code: "record-definition-forged" }
  | { code: "record-projector-forged" }
  | { code: "record-io-failed"; operation: string; cause: unknown };

type RecordWriteError =
  | { code: "record-writer-busy" }
  | { code: "record-session-closed" }
  | { code: "record-session-mismatch" }
  | { code: "record-handle-already-consumed" }
  | { code: "record-wrong-state" }
  | { code: "record-write-forged" }
  | { code: "record-definition-forged" }
  | { code: "record-projector-forged" }
  | { code: "record-publish-target-exists"; runId: RunId }
  | { code: "record-atomic-publish-cross-device" }
  | { code: "record-atomic-publish-unsupported"; platform: string }
  | { code: "record-limit-exceeded"; kind: "document" | "payload" | "blob" | "closure" | "count" | "ndjson" | "path" | "json-depth"; name?: string; maximum: number; observedAtLeast: number }
  | { code: "record-publish-invalid"; issues: NonEmptyRecordIssues }
  | { code: "record-publish-outcome-unknown" };

type RecordMigrationError =
  | RecordOpenError
  | { code: "record-migration-not-needed"; format: CurrentRecordFormatId }
  | { code: "record-migration-path-unavailable"; sourceFormat: RecordFormatId }
  | { code: "record-migration-not-lossless"; issues: NonEmptyMigrationIssues }
  | { code: "record-migration-scene-invalid"; issues: NonEmptyMigrationIssues };
```

`RecordReadError` 只表示 closed Scope、伪造或跨 session handle 与真实 I/O。Core entry 或 Channel 的局部损坏留在 `RecordCoreRead` / `ChannelProjectionResult` 的成功值里，不进 error channel。

`record-bootstrap-invalid` 表示 `record.json` 探测或完整文档损坏，与 Run/Member/Attempt 的 `RecordCoreRead.core-invalid` 区分：后者是 entry 级可隔离结果，前者是 open 级失败。

`record-sidecar-stale` 表示 local manifest 的 lineage 与当前 root file identity 不匹配。`record-sidecar-recovery-required` 表示 sidecar 有未收敛的 session 现场。`record-sidecar-capability-unsupported` 表示唯一 lock anchor 无法创建或无法取得。`record-sidecar-permission-denied` 表示 anchor 或 manifest 位置权限不足。anchor 规则见 [Architecture](architecture.md#local-state-与只读-root)。

`record-write-forged`、`record-definition-forged` 与 `record-projector-forged` 表示对象不在包内 WeakMap/WeakSet 注册表中，即复制或 transplant 的 brand。运行时 authority 是 exact object identity，公开字段不构成权威。

`record-limit-exceeded` 在 seal 前失败，staging 现场由 session 删除，不产生部分发布。错误携带 `maximum` 与 `observedAtLeast`，不携带精确观测值。限制值、组合 invariant 与 boundary matrix 见 [Architecture](architecture.md#record-v1-限制)。

每个 CLI error 都包含安全的下一步。path、OS cause 与可能含敏感内容的 payload 不直接进入公开 message。
