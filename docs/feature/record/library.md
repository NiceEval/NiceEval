# Record Library

Record Library 提供五类 Effect-native 能力：打开 current reader、定义并读取 typed
RecordAttachment、在 Scope 内写完并发布 Run、删除未完成 Run，以及显式迁移旧格式。

普通 reader 不包含跨 Core major decoder。旧 Core decoder、Core converter 与
RecordAttachment migration 只由 migration registry 提供。

## Effect runtime 与 platform

```ts
import { Brand, Context, Effect, Either, Schema, Scope, Stream } from "effect";

class RecordFileSystem extends Context.Tag("@niceeval/record/RecordFileSystem")<
  RecordFileSystem,
  RecordFileSystemService
>() {}

class RecordMaintenanceLock extends Context.Tag(
  "@niceeval/record/RecordMaintenanceLock",
)<RecordMaintenanceLock, RecordMaintenanceLockService>() {}

class RecordWriterLock extends Context.Tag("@niceeval/record/RecordWriterLock")<
  RecordWriterLock,
  RecordWriterLockService
>() {}

class RecordEntropy extends Context.Tag("@niceeval/record/RecordEntropy")<
  RecordEntropy,
  RecordEntropyService
>() {}

class RecordGit extends Context.Tag("@niceeval/record/RecordGit")<
  RecordGit,
  RecordGitService
>() {}

class RecordMigrationRegistry extends Context.Tag(
  "@niceeval/record/RecordMigrationRegistry",
)<RecordMigrationRegistry, RecordMigrationRegistryService>() {}
```

这些是 Effect v3 `Context.Tag`。Node Layer 在 application 边界组合 live services；
动态 `root` 是 constructor 参数，不为每个 root 创建 Layer。

| 能力 | Effect 依赖 |
|---|---|
| reader | `Scope.Scope | RecordFileSystem | RecordMaintenanceLock` |
| writer | reader 所需 Tag，加 `RecordWriterLock | RecordEntropy` |
| clean | `RecordFileSystem | RecordMaintenanceLock | RecordWriterLock` |
| migration plan/run | `RecordFileSystem | RecordMaintenanceLock | RecordGit | RecordMigrationRegistry` |

Library 内部不调用 `Effect.runPromise`。CLI 或 application 在最外层 provide Node
Layer，并只运行一次 Effect。typed failure、defect 与 interruption 在拥有结果语义的
边界之前保持分离。

`RecordFileSystem` 负责 directory/file create、exact JSON、blob I/O、flush、close
与删除未完成目录。Run 的提交点始终是最后创建的 `complete`。

## Identity 与 Attachment definition

```ts
type RecordId = string & Brand.Brand<"RecordId">;
type RunId = string & Brand.Brand<"RunId">;
type SlotId = string & Brand.Brand<"SlotId">;
type AttemptId = string & Brand.Brand<"AttemptId">;
type UtcMillis = number & Brand.Brand<"UtcMillis">;

type RecordAttachmentName = string & Brand.Brand<"RecordAttachmentName">;
type RecordAttachmentSchemaId = string & Brand.Brand<"RecordAttachmentSchemaId">;
type RecordFormatId = string & Brand.Brand<"RecordFormatId">;
type RecordAttachmentOwner = "run" | "attempt";

type SourceItemId = string & Brand.Brand<"SourceItemId">;
type CanonicalProjectRelativePath = string & Brand.Brand<
  "CanonicalProjectRelativePath"
>;
type Sha256Digest = string & Brand.Brand<"Sha256Digest">;

declare const recordRootTypeId: unique symbol;

interface RecordRoot {
  readonly [recordRootTypeId]: typeof recordRootTypeId;
}

type RecordRootInput = string | URL;

type RecordRootConstructionError =
  | { readonly code: "record-root-empty" }
  | { readonly code: "record-root-relative" }
  | {
      readonly code: "record-root-non-file-url";
      readonly protocol: string;
    }
  | { readonly code: "record-root-file-url-invalid" };

declare const makeRecordRoot: (
  input: RecordRootInput,
) => Either.Either<RecordRoot, RecordRootConstructionError>;

declare const recordBlobRefTypeId: unique symbol;

interface RecordBlobRef {
  readonly [recordBlobRefTypeId]: typeof recordBlobRefTypeId;
}
```

ID、时间、Attachment name 与 schema ID 都由 exact Schema constructor 创建。

`RecordBlobRef` 也只能由包创建。它没有可拼接的 path、可编辑 key 或公开 constructor。
持久化 codec 只在所属 Attachment 内解释它的 opaque key。

`SourceItemId`、`CanonicalProjectRelativePath` 与 `Sha256Digest` 同样只经 package 的 exact
Schema constructor 建立。Sources manifest 拥有它们的取值约束与组合语义。

`RecordRoot` 同样只能由 package constructor 创建。`makeRecordRoot` 接受非空的 host
absolute-path string，或 protocol 为 `file:` 的 `URL`。

它只做 host path 的 lexical normalization，不检查存在性、不做 I/O，也不 realpath。
relative string、非-file URL 与无法表示为 host absolute path 的 file URL 分别返回上述
稳定 code。它不承诺 hostile symlink defense。

portable Record 只持久化 root-relative portable segments。host absolute path 与
`RecordRoot` 的输入形式都不进入 `record.json`、Attachment、blob ref 或任何磁盘 identity。

`RecordAttachmentName` 使用 reverse-domain lowercase ASCII namespace。
`RecordAttachmentSchemaId` 是 `<name>/vN`。`niceeval.*` 只由包内 built-in constructor
创建；第三方使用自己的 namespace。

一个 definition 同时拥有 exact JSON encoder、decoder 与完整的 blob-reference
projection。`blobRefs` 必须按 payload 中的出现顺序穷尽所有 `RecordBlobRef`；它不是
可选提示。

```ts
declare const recordAttachmentDefinitionTypeId: unique symbol;

interface JsonRecordAttachmentDefinition<
  Owner extends RecordAttachmentOwner,
  Payload,
> {
  readonly owner: Owner;
  readonly name: RecordAttachmentName;
  readonly schemaId: RecordAttachmentSchemaId;
  readonly blobRefs: (payload: Payload) => readonly RecordBlobRef[];
  readonly [recordAttachmentDefinitionTypeId]: {
    readonly owner: Owner;
    readonly payload: Payload;
  };
}

declare const defineJsonRecordAttachment: <
  const Owner extends RecordAttachmentOwner,
  S extends Schema.Schema.AnyNoContext,
>(input: {
  readonly owner: Owner;
  readonly name: string;
  readonly schemaId: string;
  readonly schema: S;
  readonly blobRefs: (
    payload: Schema.Schema.Type<S>,
  ) => readonly RecordBlobRef[];
}) => Either.Either<
  JsonRecordAttachmentDefinition<Owner, Schema.Schema.Type<S>>,
  RecordAttachmentDefinitionError
>;
```

本仓库的 Effect 3.22.1 把这两个公共类型放在 `Schema.Schema` namespace：
`Schema.Schema.AnyNoContext` 与 `Schema.Schema.Type<S>`。definition 固定使用
`{ errors: "all", onExcessProperty: "error" }`。

Schema 负责 decoded type 与 exact JSON encoded value 的转换。JSON boundary 拒绝
function、symbol、native bytes 与任意 prototype。Date、BigInt 等值必须由作者 schema
显式转换。definition callback 意外 throw 是 defect；definition 是受信任扩展。

definition 的运行时 authority 来自 package-private registry 与 exact object identity。
复制字段、移植 phantom symbol 或类型断言不能形成可写 capability。

```ts
type RecordAttachmentDefinitionError =
  | { readonly code: "record-attachment-name-invalid"; readonly name: string }
  | {
      readonly code: "record-attachment-schema-id-invalid";
      readonly schemaId: string;
    }
  | { readonly code: "niceeval-namespace-reserved"; readonly name: string }
  | {
      readonly code: "record-attachment-definition-invalid";
      readonly issues: NonEmptyRecordIssues;
    };
```

## Blob closure、写入 builder 与读取 value

Attachment 的 payload 是 exact JSON。它可以包含 `RecordBlobRef`，但 ref 只能指向
同一个 Attachment directory 的 `blobs/**`。一个 Attachment 没有跨 owner、跨
Attachment 或 root 外的 blob path。

```ts
interface RecordBlobSource<E, R> {
  readonly stream: Stream.Stream<Uint8Array, E, R>;
}

declare const recordAttachmentBlobDraftTypeId: unique symbol;

interface RecordAttachmentBlobDraft<E, R> {
  readonly ref: RecordBlobRef;
  readonly [recordAttachmentBlobDraftTypeId]: {
    readonly error: E;
    readonly requirements: R;
  };
}

type RecordBlobDrafts = readonly RecordAttachmentBlobDraft<unknown, unknown>[];

type RecordBlobErrors<Blobs extends RecordBlobDrafts> =
  Blobs[number] extends RecordAttachmentBlobDraft<infer E, unknown> ? E : never;

type RecordBlobRequirements<Blobs extends RecordBlobDrafts> =
  Blobs[number] extends RecordAttachmentBlobDraft<unknown, infer R> ? R : never;

interface RecordAttachmentBlobBuilder {
  readonly add: <E, R>(
    source: RecordBlobSource<E, R>,
  ) => RecordAttachmentBlobDraft<E, R>;
}

interface RecordAttachmentBlobBuild<
  Payload,
  Blobs extends RecordBlobDrafts,
> {
  readonly payload: Payload;
  readonly blobs: Blobs;
}

declare const recordAttachmentWriteTypeId: unique symbol;

interface RecordAttachmentWrite<
  Owner extends RecordAttachmentOwner,
  E,
  R,
> {
  readonly [recordAttachmentWriteTypeId]: {
    readonly owner: Owner;
    readonly error: E;
    readonly requirements: R;
  };
}

declare const makeRecordAttachmentWrite: <
  Owner extends RecordAttachmentOwner,
  Payload,
  const Blobs extends RecordBlobDrafts,
>(
  family: RecordAttachmentFamily<Owner, Payload>,
  build: (
    blobs: RecordAttachmentBlobBuilder,
  ) => RecordAttachmentBlobBuild<Payload, Blobs>,
) => RecordAttachmentWrite<
  Owner,
  RecordBlobErrors<Blobs>,
  RecordBlobRequirements<Blobs>
>;
```

`makeRecordAttachmentWrite` 是唯一的 generic write builder。它捕获 family、payload、
每个新 ref 与对应 blob Stream。`add` 为每份 source mint 一个新的 ref；payload 使用
`draft.ref`，并把同一个 opaque draft 放进 `blobs`。调用方不能提交 raw name、raw path、
raw bytes 或手写 ref。

generic writer 用 family 的 `blobRefs` 与 builder 捕获的 drafts 做双向精确比较：

- payload 引用而没有 source 是 missing key；
- source 没有被 payload 引用是 extra key；
- 同一 key 出现不止一次是 duplicate key；
- ref 不属于本次 builder、编码非法或越出 owner-local directory 是 illegal ref；
- key、bytes 与 payload projection 不能形成同一完整 closure 是 closure mismatch。

写入时的上述问题是 `RecordAttachmentClosureInvalid`。从磁盘读取时，任一种问题都使
该 Attachment 成为 `invalid`；reader 不返回一个不完整的 `available` value。

```ts
type RecordBlobHandleInvalid = {
  readonly code: "record-blob-handle-invalid";
};

type RecordAttachmentPayloadSnapshot<Payload> =
  Payload extends readonly (infer Item)[]
    ? readonly RecordAttachmentPayloadSnapshot<Item>[]
    : Payload extends object
      ? {
          readonly [Key in keyof Payload]: RecordAttachmentPayloadSnapshot<
            Payload[Key]
          >;
        }
      : Payload;

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

`RecordAttachmentBlobs` 是同步、只读的内存 snapshot capability。`refs()` 返回 payload
完整 closure 的 frozen defensive list。

`bytes(ref)` 只从该 snapshot 取值。它不读取磁盘、不创建 Stream，也不能借用另一个
Attachment 的 ref。

成功时每次返回 exact-length `Uint8Array` defensive copy。调用方 mutation 不影响
package-owned snapshot。

错误或伪造 ref 返回 `Either.left(record-blob-handle-invalid)`。这只是一项同步 capability
结果；`RecordBlobHandleInvalid` 不属于 `RecordReadError`。

`readRunAttachment` 与 `readAttemptAttachment` 在返回 `available` 前，读取、exact
decode、验证并 materialize 整个 blob closure 到内存。permission、EIO 或 materialization
failure 是它们的 `RecordReadError`；它们不降格为 `invalid`。fiber interruption 也不变成
data state；它继续以 Effect Cause 传播。

`RecordAttachmentValue` 是 package-created、完整且自包含的值。

package 在 decode 时把 payload 的 JSON object 与 array 递归 deep-freeze 成
`RecordAttachmentPayloadSnapshot`。

JSON boundary 不接纳 native bytes，所有 binary 只由 `blobs.bytes(ref)` 提供。调用方不能
通过 mutation 改变另一个 projector 或 consumer 所见的 payload。

reader Scope 关闭后，`payload`、`refs()` 与 `bytes()` 仍可同步消费。它们不再依赖
filesystem、lock、reader registry 或 Effect environment。

每个 `available` value 只在 read Effect 内构成一次；projector 只同步读取这个固定
snapshot，既不触发第二次 blob I/O，也不获得 Stream。

## RecordAttachment family 与读取状态

```ts
declare const recordAttachmentFamilyTypeId: unique symbol;

interface RecordAttachmentFamily<
  Owner extends RecordAttachmentOwner,
  Payload,
> {
  readonly [recordAttachmentFamilyTypeId]: {
    readonly owner: Owner;
    readonly payload: Payload;
  };
}

type RecordAttachmentRead<Payload> =
  | {
      readonly state: "available";
      readonly value: RecordAttachmentValue<Payload>;
    }
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

`available` 同时表示 exact decoded、deep-frozen payload 与完整 blob closure 已验证并
materialize。
missing directory 是 `unavailable`。known old schema 在完整 converter 链上是
`migration-required`。known path 命中不可无损边时是 `migration-unavailable`；
它是已知的终态，不含 migration command，也不提示再次运行 migrate。

unknown family 或 schema 始终是 `unsupported`。envelope、payload、blob、ref 或 closure
验证失败优先是 `invalid`。这些都是 Projection 可消费的成功数据；真实 I/O、permission、
closed reader 与错误 handle 留在 Effect typed error。

## Official Observability family、capture 与 projector

官方 Observability durable shape 由
[Observability Attachments](architecture/observability-attachments.md) 唯一拥有。本节只定义公开
family、capture constructor、typed error、Effect 边界与 neutral projector；不复制 payload schema。

```ts
import type { RecordAttachmentProjector } from "niceeval/projection";

declare const attemptConversationAttachmentV1: RecordAttachmentFamily<
  "attempt",
  ConversationAttachmentV1
>;

declare const attemptCommandsAttachmentV1: RecordAttachmentFamily<
  "attempt",
  CommandsAttachmentV1
>;

declare const attemptUsageAttachmentV1: RecordAttachmentFamily<
  "attempt",
  UsageAttachmentV1
>;

declare const attemptTimingAttachmentV1: RecordAttachmentFamily<
  "attempt",
  AttemptTimingAttachmentV1
>;

declare const attemptDiagnosticsAttachmentV1: RecordAttachmentFamily<
  "attempt",
  AttemptDiagnosticsAttachmentV1
>;

declare const runTimingAttachmentV1: RecordAttachmentFamily<
  "run",
  RunTimingAttachmentV1
>;

declare const runDiagnosticsAttachmentV1: RecordAttachmentFamily<
  "run",
  RunDiagnosticsAttachmentV1
>;
```

这七个 family 是 package-owned builtin。第三方不能以 niceeval namespace 重定义、替换或扩展它们；
第三方长期事实使用自己的 versioned Attachment 与 projector。

### capture constructor

capture 是 official producer 的结构化入口，不是作者向 Record 追加万能 JSON 的入口。各方法的 input
都是对应 durable schema 的闭合语义输入：collector mint identity、执行已登记的 redaction、检查每项
上限，并把 opaque entity handle 转成 durable ref。input 不能携带 raw provider frame、raw error、
path、blob key 或任意扩展 object。

```ts
declare const attemptObservabilityCaptureTypeId: unique symbol;
declare const runObservabilityCaptureTypeId: unique symbol;
declare const observabilityEntityRefTypeId: unique symbol;
declare const runObservabilityEntityRefTypeId: unique symbol;
declare const registeredCommandCaptureTypeId: unique symbol;

interface AttemptObservabilityEntityRefV1 {
  readonly [observabilityEntityRefTypeId]: typeof observabilityEntityRefTypeId;
}

interface RunObservabilityEntityRefV1 {
  readonly [runObservabilityEntityRefTypeId]: typeof runObservabilityEntityRefTypeId;
}

interface RegisteredCommandCaptureV1 extends AttemptObservabilityEntityRefV1 {
  readonly [registeredCommandCaptureTypeId]: typeof registeredCommandCaptureTypeId;
}

interface ObservabilityRedactorV1 {
  readonly redact: (input: string) => {
    readonly text: string;
    readonly replacements: number;
  };
}

interface ObservabilityAttemptCapture {
  readonly [attemptObservabilityCaptureTypeId]: typeof attemptObservabilityCaptureTypeId;

  readonly recordConversation: (
    input: ConversationCaptureInputV1,
  ) => Effect.Effect<
    AttemptObservabilityEntityRefV1,
    ObservabilityCaptureError
  >;

  readonly registerCommand: (
    input: CommandManifestCaptureInputV1,
  ) => Effect.Effect<
    RegisteredCommandCaptureV1,
    ObservabilityCaptureError
  >;

  readonly recordCommandResult: (
    command: RegisteredCommandCaptureV1,
    input: CommandResultCaptureInputV1,
  ) => Effect.Effect<void, ObservabilityCaptureError>;

  readonly recordUsage: (
    input: UsageCaptureInputV1,
  ) => Effect.Effect<
    AttemptObservabilityEntityRefV1,
    ObservabilityCaptureError
  >;

  readonly recordTiming: (
    input: AttemptTimingCaptureInputV1,
  ) => Effect.Effect<
    AttemptObservabilityEntityRefV1,
    ObservabilityCaptureError
  >;

  readonly recordDiagnostic: (
    input: AttemptDiagnosticCaptureInputV1,
  ) => Effect.Effect<
    AttemptObservabilityEntityRefV1,
    ObservabilityCaptureError
  >;
}

interface ObservabilityRunCapture {
  readonly [runObservabilityCaptureTypeId]: typeof runObservabilityCaptureTypeId;

  readonly recordTiming: (
    input: RunTimingCaptureInputV1,
  ) => Effect.Effect<RunObservabilityEntityRefV1, ObservabilityCaptureError>;

  readonly recordDiagnostic: (
    input: RunDiagnosticCaptureInputV1,
  ) => Effect.Effect<RunObservabilityEntityRefV1, ObservabilityCaptureError>;
}

declare const makeObservabilityAttemptCaptureV1: (input: {
  readonly draft: RecordAttemptDraft;
  readonly redactor: ObservabilityRedactorV1;
}) => Effect.Effect<ObservabilityAttemptCapture, never>;

declare const makeObservabilityRunCaptureV1: (input: {
  readonly draft: RecordRunDraft;
  readonly redactor: ObservabilityRedactorV1;
}) => Effect.Effect<ObservabilityRunCapture, never>;
```

下列 input 都是 package-exported closed union：

- ConversationCaptureInputV1、CommandManifestCaptureInputV1 与 CommandResultCaptureInputV1；
- UsageCaptureInputV1、AttemptTimingCaptureInputV1 与 RunTimingCaptureInputV1；
- AttemptDiagnosticCaptureInputV1 与 RunDiagnosticCaptureInputV1。

每一种 input 都省略 durable entity identity。Attempt input 只能用 AttemptObservabilityEntityRefV1，
Run input 只能用 RunObservabilityEntityRefV1，表达可选 direct cross-family ref。它们的 field、variant、
limit 与 redaction 规则完全对应 Observability Attachments。实现不得用 index signature、unknown、
JSON record 或 cast 扩张它们。

capture 的 state 与 handles 是 package-branded。伪造 ref、来自另一 capture 的 ref、sealed capture 或
对已完成 command 再写 result 都返回 ObservabilityCaptureError。redactor callback throw 是 defect；
interruption 不变成 capture error，继续保留 Effect Cause。

### whole-Run contract

Attempt finalizer 全部停稳后才可 seal Attempt capture。Run teardown 停稳后才可 seal Run capture。
constructor 将 capture 与一个 draft 绑定，只建立内存 collector，不写 filesystem。whole-Run contract
先冻结并联合验证每个 Attempt 的五份与 Run 的两份 official Attachment，再调用绑定 draft 的
generic writer 路径。

```ts
interface ObservabilityRecordContractV1 {
  readonly write: () => Effect.Effect<void, RecordWriteError>;
}

declare const sealObservabilityRecordContractV1: (input: {
  readonly run: ObservabilityRunCapture;
  readonly attempts: readonly ObservabilityAttemptCapture[];
}) => Effect.Effect<
  ObservabilityRecordContractV1,
  ObservabilityCaptureError | ObservabilityRecordContractError
>;
```

sealObservabilityRecordContractV1 拒绝没有五份 Attempt family 或两份 Run family 的输入。它也验证
collection、owner-local identity、command register/result 对、closure、timing tree、SourceItem frame
与同 owner 的 direct cross-family ref。成功后 contract.write 只使用 generic writer 的 typed write
路径。writer failure 保持 RecordWriteError；在它成功且其它 Run 事实也已写入前，不得创建 complete
marker。

### typed error

```ts
type ObservabilityCaptureError =
  | {
      readonly code: "observability-capture-sealed";
      readonly owner: "run" | "attempt";
    }
  | {
      readonly code: "observability-command-not-registered";
      readonly commandId: CommandIdV1;
    }
  | {
      readonly code: "observability-command-result-already-recorded";
      readonly commandId: CommandIdV1;
    }
  | {
      readonly code: "observability-input-not-safe";
      readonly field: "text" | "manifest" | "diagnostic";
    };

type ObservabilityRecordContractError =
  | {
      readonly code: "observability-required-attachment-missing";
      readonly owner: "run" | "attempt";
      readonly schemaId: string;
    }
  | {
      readonly code: "observability-owner-or-schema-invalid";
      readonly owner: "run" | "attempt";
      readonly schemaId: string;
    }
  | {
      readonly code: "observability-identity-invalid";
      readonly schemaId: string;
      readonly entity: string;
    }
  | {
      readonly code: "observability-cross-reference-invalid";
      readonly schemaId: string;
      readonly sourceId: string;
    }
  | {
      readonly code: "observability-timing-tree-invalid";
      readonly intervalId: IntervalIdV1;
    }
  | {
      readonly code: "observability-source-frame-invalid";
      readonly diagnosticId: DiagnosticIdV1;
    };
```

这两个 union 只暴露 bounded safe code 与 identity。collector 采集不足应 seal safe partial value；
不能安全形成 input 或整个 Run 联合验证失败才走 typed error。原始 exception、secret、path、stack 与
payload 不进入 error value。

### neutral projector

RecordAttachmentProjector 和 defineRecordAttachmentProjector 仍由 Projection Library 公开。以下
prebuilt projector 与其它第三方 projector 同样接受一份 available Attachment，且只读其自包含 value：

版本仅属于 durable Attachment family/schema identity；projector 与 semantic view 的 ABI 不按磁盘版本命名。

```ts
type ConversationView = ConversationAttachmentV1;
type UsageView = UsageAttachmentV1;
type AttemptTimingView = AttemptTimingAttachmentV1;
type RunTimingView = RunTimingAttachmentV1;
type AttemptDiagnosticsView = AttemptDiagnosticsAttachmentV1;
type RunDiagnosticsView = RunDiagnosticsAttachmentV1;

type CommandStreamView = {
  readonly text: string;
  readonly retainedBytes: NonNegativeSafeInteger;
  readonly totalSafeUtf8Bytes: NonNegativeSafeInteger;
};

type CommandsView = {
  readonly collection: CommandsAttachmentV1["collection"];
  readonly commands: readonly {
    readonly commandId: CommandIdV1;
    readonly manifest: CommandManifestV1;
    readonly result: {
      readonly outcome: CommandResultV1["outcome"];
      readonly stdout: CommandStreamView;
      readonly stderr: CommandStreamView;
    };
    readonly refs: readonly CommandsReferencesV1[];
  }[];
};

declare const attemptConversationProjector: RecordAttachmentProjector<
  "attempt",
  ConversationView
>;

declare const attemptCommandsProjector: RecordAttachmentProjector<
  "attempt",
  CommandsView
>;

declare const attemptUsageProjector: RecordAttachmentProjector<
  "attempt",
  UsageView
>;

declare const attemptTimingProjector: RecordAttachmentProjector<
  "attempt",
  AttemptTimingView
>;

declare const attemptDiagnosticsProjector: RecordAttachmentProjector<
  "attempt",
  AttemptDiagnosticsView
>;

declare const runTimingProjector: RecordAttachmentProjector<
  "run",
  RunTimingView
>;

declare const runDiagnosticsProjector: RecordAttachmentProjector<
  "run",
  RunDiagnosticsView
>;
```

ConversationView、UsageView、AttemptTimingView、RunTimingView、AttemptDiagnosticsView 与
RunDiagnosticsView 保留对应 durable payload 的 value 语义。CommandsView 只把每条 stream 的
inline/blob storage 归一成相同的 UTF-8 text、retainedBytes 与
totalSafeUtf8Bytes。view 不暴露 RecordBlobRef、path、reader 或 stream。

一个 projector 不计数、不聚合 command success、不计算 duration 或 critical path、不分组
diagnostic，也不 join 另一 family。最终选定的公共 Record-to-Report 数据面负责声明多个
projection；Calculation 才能组合它们。官方 Report 不得到私有 projector 或额外 reader capability。

### migration ownership

每个 owner-specific family 各自调用 defineRecordAttachmentFamily 并只注册相邻 migration edge。
conversation、commands、usage、Attempt timing、Run timing、Attempt diagnostics 与 Run diagnostics
不能共用一个万能 migration。payload、closure、entity identity 或 ref 解释改变时，只有受影响的
family 发布下一个 schema identity。

普通 reader 不自动 migrate。explicit migrate 依既有 migration registry 执行完整相邻链。converter
只能读取同一 Attachment 的 complete value 与 own blob closure，不能读取另一个 owner、legacy event
file、当前 worktree、provider input 或 private evidence 补值。

## Frozen snapshot、reader 与 handles

```ts
type RecordAttemptRef = {
  readonly originRunId: RunId;
  readonly attemptId: AttemptId;
};

type RecordCoreRead<Value> =
  | { readonly state: "available"; readonly value: Value }
  | { readonly state: "missing" }
  | {
      readonly state: "core-invalid";
      readonly issues: NonEmptyReadonlyArray<RecordIssue>;
    };

declare const frozenRecordViewTypeId: unique symbol;
declare const frozenRecordRunTypeId: unique symbol;
declare const frozenRecordAttemptTypeId: unique symbol;

interface FrozenRecordRun {
  readonly runId: RunId;
  readonly startedAt: UtcMillis;
  readonly completedAt: UtcMillis;
  readonly expectedSlots: readonly SlotId[];
  readonly [frozenRecordRunTypeId]: typeof frozenRecordRunTypeId;
}

interface FrozenRecordAttempt {
  readonly attemptId: AttemptId;
  readonly originRunId: RunId;
  readonly [frozenRecordAttemptTypeId]: typeof frozenRecordAttemptTypeId;
}

interface FrozenRecordView {
  readonly [frozenRecordViewTypeId]: typeof frozenRecordViewTypeId;
  readonly warnings: readonly RecordWarning[];
  readonly runs: readonly RecordCoreRead<FrozenRecordRun>[];

  readonly run: (
    runId: RunId,
  ) => Effect.Effect<RecordCoreRead<FrozenRecordRun>, RecordReadError>;

  readonly attempt: (
    ref: RecordAttemptRef,
  ) => Effect.Effect<RecordCoreRead<FrozenRecordAttempt>, RecordReadError>;

  readonly readRunAttachment: <Payload>(
    owner: FrozenRecordRun,
    family: RecordAttachmentFamily<"run", Payload>,
  ) => Effect.Effect<RecordAttachmentRead<Payload>, RecordReadError>;

  readonly readAttemptAttachment: <Payload>(
    owner: FrozenRecordAttempt,
    family: RecordAttachmentFamily<"attempt", Payload>,
  ) => Effect.Effect<RecordAttachmentRead<Payload>, RecordReadError>;
}

interface RecordReader extends FrozenRecordView {}

declare const openRecordReader: (input: {
  readonly root: RecordRoot;
}) => Effect.Effect<
  RecordReader,
  RecordOpenError,
  Scope.Scope | RecordFileSystem | RecordMaintenanceLock
>;
```

`RecordReader` 与 `RecordWriteSession.view` 都是完整 `FrozenRecordView`，不是两个近似
接口。open 一次冻结已完成 Run 集合与 warning；以后完成的新 Run 不进入这个 view。

`FrozenRecordView`、`FrozenRecordRun`、`FrozenRecordAttempt` 与下文的 drafts 都是
package-branded nominal handles。

每次调用还用 package registry 检查 exact object identity、所属 snapshot 或 session、owner
与 Scope 状态。

伪造、复制、来自另一个 reader 的 handle 或已关闭的 handle 分别得到稳定的 typed handle、
read 或 state error。registry 自己出现矛盾才是 defect。

`RecordAttachmentValue` 不是这种 live handle；它是 reader 返回的 package-owned
self-contained snapshot。

`Scope.Scope` 可以让正常调用留在 `Effect.scoped` 内，但 TypeScript 不能静态证明一个
generative handle 永远不会逃出 Scope。runtime identity 与 closed-state 检查因此不可省略。

未完成 Run 不进入 `runs`，只产生：

```ts
type RecordIncompleteRunWarning = {
  readonly code: "incomplete-run";
  readonly runId: RunId;
  readonly cleanupCommand: "niceeval clean";
};
```

Core 损坏是成功 ADT。`missing` 不把未完成 Run 提升为业务对象。

## Write session、draft 与发布

```ts
declare const recordRunDraftTypeId: unique symbol;
declare const recordAttemptDraftTypeId: unique symbol;

interface RecordWriteSession {
  readonly view: FrozenRecordView;
  readonly createRun: (input: {
    readonly startedAt: UtcMillis;
    readonly expectedSlots: readonly SlotId[];
  }) => Effect.Effect<RecordRunDraft, RecordWriteError>;
}

interface RecordRunDraft {
  readonly runId: RunId;
  readonly [recordRunDraftTypeId]: typeof recordRunDraftTypeId;

  readonly record: <E, R>(
    write: RecordAttachmentWrite<"run", E, R>,
  ) => Effect.Effect<void, RecordWriteError | E, R>;

  readonly createAttempt: (input: {
    readonly slotId: SlotId;
  }) => Effect.Effect<RecordAttemptDraft, RecordWriteError>;

  readonly reference: (input: {
    readonly slotId: SlotId;
    readonly attempt: FrozenRecordAttempt;
  }) => Effect.Effect<void, RecordWriteError>;

  readonly publish: (input: {
    readonly completedAt: UtcMillis;
  }) => Effect.Effect<RecordPublishReceipt, RecordWriteError>;
}

interface RecordAttemptDraft {
  readonly attemptId: AttemptId;
  readonly [recordAttemptDraftTypeId]: typeof recordAttemptDraftTypeId;

  readonly record: <E, R>(
    write: RecordAttachmentWrite<"attempt", E, R>,
  ) => Effect.Effect<void, RecordWriteError | E, R>;
}

declare const openRecordWriteSession: (input: {
  readonly root: RecordRoot;
}) => Effect.Effect<
  RecordWriteSession,
  RecordOpenError | RecordWriteError,
  | Scope.Scope
  | RecordFileSystem
  | RecordMaintenanceLock
  | RecordWriterLock
  | RecordEntropy
>;
```

session 取得 shared maintenance lock 与 exclusive writer lock，并冻结 `view`。`reference` 只
接受这个 `session.view` 中的 exact frozen Attempt；不能按 ID 猜 latest，也不能引用本
session 尚未发布的 Run。

每个 Run draft 的状态严格为：

```text
open → publishing → published
                  ↘ failed
```

| 状态 | 行为 |
|---|---|
| `open` | 接受 record、createAttempt 与 reference，并跟踪所有在飞 mutation。 |
| `publishing` | publish 已拒绝新的 mutation，并等待此前在飞 mutation 停稳。 |
| `published` | `complete` 已创建；draft 同步 consumed，任何后续调用都失败。 |
| `failed` | marker 前的 typed failure、defect 或 interruption 已使 draft 无法复用。 |

`record<E, R>` 消费 builder 捕获的 blob Stream，并在 marker 前 exact encode、写入和验证。
它把 explicit blob failure 保留为 `E`，把 filesystem 与 contract failure 放进
`RecordWriteError`。同时进行的 mutation 失败后，publish 以稳定
`record-draft-write-failed` state error 收口它；它不会把任意 `E` 伪装成成功。

`publish` 先从 `open` 同步转入 `publishing`，再等待在飞 mutation。普通写入、final
Core/reference/closure validation 与 receipt 数据构造都在 marker 前。任一 marker 前
failure、defect 或 interruption 令 draft 进入 `failed`，不创建 `complete`，也不删除
未完成目录。

最终 commit 是短暂的 `Effect.uninterruptibleMask` 区域：

1. final flush 并 close Run 的全部 durable handles；
2. exclusive create 零字节 `complete`；
3. 在同一不可中断区域同步把 draft 标为 `published` 并 consume；
4. 退出区域后不再运行可失败的业务步骤。

marker 前 interruption 不发布 Run。marker 后 fiber 仍可能在 receipt 被观察到前收到
interruption；磁盘上的 published Run 仍有效。Scope finalizer 只释放 session、lock 与
handle，绝不删除未完成目录。release finalizer failure 保留受控 diagnostic cause 后作为
defect 传播；它既不冒充 `RecordWriteError`，也不被静默吞掉。

```ts
type RecordPublishReceipt = {
  readonly runId: RunId;
  readonly attempts: readonly {
    readonly slotId: SlotId;
    readonly ref: RecordAttemptRef;
  }[];
};
```

receipt 不保存 `publishedAt`；durable completion time 是 Run Core 的 `completedAt`。

## Closure-aware 相邻 Attachment migration

一个 schema version 是一个 definition。每条 converter 只连接同 owner、同 name 的精确
`vN → vN+1`；family 拒绝跳过、倒序、缺边、重复边与分叉。

```ts
declare const recordAttachmentMigrationEdgeTypeId: unique symbol;
declare const recordAttachmentMigrationTypeId: unique symbol;

interface RecordAttachmentMigrationEdge<
  Owner extends RecordAttachmentOwner,
> {
  readonly [recordAttachmentMigrationEdgeTypeId]: Owner;
}

interface RecordAttachmentMigration<
  Owner extends RecordAttachmentOwner,
  E,
  R,
> extends RecordAttachmentMigrationEdge<Owner> {
  readonly [recordAttachmentMigrationTypeId]: {
    readonly error: E;
    readonly requirements: R;
  };
}

interface RecordAttachmentMigrationTarget<
  Owner extends RecordAttachmentOwner,
  To,
> {
  readonly create: <const Blobs extends RecordBlobDrafts>(
    build: (
      blobs: RecordAttachmentBlobBuilder,
    ) => RecordAttachmentBlobBuild<To, Blobs>,
  ) => RecordAttachmentWrite<
    Owner,
    RecordBlobErrors<Blobs>,
    RecordBlobRequirements<Blobs>
  >;
}

declare const defineRecordAttachmentMigration: <
  Owner extends RecordAttachmentOwner,
  From,
  To,
  E,
  R,
>(input: {
  readonly from: JsonRecordAttachmentDefinition<Owner, From>;
  readonly to: JsonRecordAttachmentDefinition<Owner, To>;
  readonly convert: (
    source: RecordAttachmentValue<From>,
    target: RecordAttachmentMigrationTarget<Owner, To>,
  ) => Effect.Effect<RecordAttachmentWrite<Owner, E, R>, E, R>;
}) => Either.Either<
  RecordAttachmentMigration<Owner, E, R>,
  RecordAttachmentMigrationDefinitionError
>;

declare const declareRecordAttachmentMigrationUnavailable: <
  Owner extends RecordAttachmentOwner,
  From,
  To,
>(input: {
  readonly from: JsonRecordAttachmentDefinition<Owner, From>;
  readonly to: JsonRecordAttachmentDefinition<Owner, To>;
  readonly reason: string;
}) => RecordAttachmentMigrationEdge<Owner>;

declare const defineRecordAttachmentFamily: <
  Owner extends RecordAttachmentOwner,
  Current,
>(input: {
  readonly current: JsonRecordAttachmentDefinition<Owner, Current>;
  readonly migrations: readonly RecordAttachmentMigrationEdge<Owner>[];
}) => Either.Either<
  RecordAttachmentFamily<Owner, Current>,
  RecordAttachmentFamilyError
>;
```

converter 的 `source` 是完整、已验证并 materialize 的 `RecordAttachmentValue<From>`，
不是单独 payload。

source payload 是 package-owned deep-frozen JSON snapshot。converter 不能靠 mutation
改写其它 consumer。

它只能通过 `source.blobs.bytes(ref)` 同步取得 old bytes。错误或伪造 ref 返回
`Either.left(record-blob-handle-invalid)`；converter 必须映射它到自己的 explicit `E`。

随后可用新的 `RecordBlobSource` 组成 target 写入 Stream。`target.create` 为每个目标 blob
mint 新 ref，并捕获 target bytes。

converter 可以不创建某个 old blob、为新 payload 改名、原样保留或转换 bytes。它不能把
old ref 或手写 path 放进 target payload 冒充新 ref。

converter callback 意外 throw 是 defect。`Effect.fail(e)` 保留 explicit `E`；interruption
仍以 Cause 传播。`R = never` 只说明 Effect 类型不要求 NiceEval Layer。它不能证明
converter 没有通过 ambient JavaScript API 进行 I/O。第三方 converter 是受信任 extension，
不属于 hostile-code sandbox。

`not-losslessly-migratable` 是显式 edge。它保留 old Attachment bytes，current family 的
reader 返回 `migration-unavailable`。这是 settled data state，不是建议用户重新运行
`niceeval migrate`。

## Source identity migration group

普通 Attachment migration 只能转换一个 owner 的一个 Attachment。`SourceItemId` 或 source-site
source ref 的 identity 语义改变时，`niceeval.sources` 与
`niceeval.assertion-source-sites` 改用以下 group；两条成员边不能同时作为普通 family migration
注册。

```ts
type SourceItemIdMigration = {
  readonly from: SourceItemId;
  readonly to: SourceItemId;
};

interface SourceIdentitySourcesMigrationResult<E, R> {
  readonly write: RecordAttachmentWrite<"run", E, R>;
  readonly itemMapping: readonly SourceItemIdMigration[];
}

declare const sourceIdentityMigrationGroupTypeId: unique symbol;

interface SourceIdentityMigrationGroup<E, R> {
  readonly [sourceIdentityMigrationGroupTypeId]: {
    readonly error: E;
    readonly requirements: R;
  };
}

type SourceIdentityMigrationGroupDefinitionError = {
  readonly code: "source-identity-migration-group-invalid";
  readonly issues: NonEmptyRecordIssues;
};

declare const defineSourceIdentityMigrationGroup: <
  SourcesFrom,
  SourcesTo,
  SitesFrom,
  SitesTo,
  E,
  R,
>(input: {
  readonly sources: {
    readonly from: JsonRecordAttachmentDefinition<"run", SourcesFrom>;
    readonly to: JsonRecordAttachmentDefinition<"run", SourcesTo>;
    readonly convert: (
      source: RecordAttachmentValue<SourcesFrom>,
      target: RecordAttachmentMigrationTarget<"run", SourcesTo>,
    ) => Effect.Effect<SourceIdentitySourcesMigrationResult<E, R>, E, R>;
  };
  readonly sourceSites: {
    readonly from: JsonRecordAttachmentDefinition<"attempt", SitesFrom>;
    readonly to: JsonRecordAttachmentDefinition<"attempt", SitesTo>;
    readonly convert: (
      source: RecordAttachmentValue<SitesFrom>,
      input: {
        readonly itemMapping: readonly SourceItemIdMigration[];
        readonly target: RecordAttachmentMigrationTarget<"attempt", SitesTo>;
      },
    ) => Effect.Effect<RecordAttachmentWrite<"attempt", E, R>, E, R>;
  };
}) => Either.Either<
  SourceIdentityMigrationGroup<E, R>,
  SourceIdentityMigrationGroupDefinitionError
>;

declare const declareSourceIdentityMigrationUnavailable: <
  SourcesFrom,
  SourcesTo,
  SitesFrom,
  SitesTo,
>(input: {
  readonly sources: {
    readonly from: JsonRecordAttachmentDefinition<"run", SourcesFrom>;
    readonly to: JsonRecordAttachmentDefinition<"run", SourcesTo>;
  };
  readonly sourceSites: {
    readonly from: JsonRecordAttachmentDefinition<"attempt", SitesFrom>;
    readonly to: JsonRecordAttachmentDefinition<"attempt", SitesTo>;
  };
  readonly reason: string;
}) => SourceIdentityMigrationGroup<never, never>;
```

definition 只接受 `niceeval.sources` 的相邻 Run-owned edge 与
`niceeval.assertion-source-sites` 的相邻 Attempt-owned edge。registry 为一个 origin Run 只执行一次
Sources converter，并验证 `itemMapping` 逐一包含该完整旧 manifest 的每个 `SourceItemId`，且每个 target
id 在 mapping 中至多出现一次并存在于 target manifest。

随后 registry 将同一份 frozen mapping 传给该 origin Run 中每个匹配的 source-sites Attachment converter。
converter 不能按 path、digest、数组位置、当前 worktree 或自身局部猜测 source item 对应关系。若 group
没有无损边，`declareSourceIdentityMigrationUnavailable` 保留原 bytes，并让需要 current source navigation
的读取得到 `migration-unavailable`。

只改变 Sources payload 或 blob closure、而不改变 source item identity 时，仍使用普通
`RecordAttachmentMigration`。group 只保护必须同步改变的跨 owner semantic join；它不授权跨 owner
blob、storage path 或 `RecordAttachmentValue` capability。

## Clean 与显式 migration

```ts
declare const inspectIncompleteRuns: (input: {
  readonly root: RecordRoot;
}) => Effect.Effect<
  readonly RecordIncompleteRun[],
  RecordCleanError,
  RecordFileSystem | RecordMaintenanceLock
>;

declare const cleanIncompleteRuns: (input: {
  readonly root: RecordRoot;
  readonly runIds: readonly RunId[];
}) => Effect.Effect<
  RecordCleanReceipt,
  RecordCleanError,
  RecordFileSystem | RecordMaintenanceLock | RecordWriterLock
>;

declare const planRecordMigration: (input: {
  readonly root: RecordRoot;
}) => Effect.Effect<
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

`RecordMigrationPlan` 是 package-created opaque value，绑定 root snapshot、source
identities、installed registry 与 Git inspection。输入变化后执行返回
`record-migration-plan-stale`。

任何 Core 或 Attachment-only migration 在第一次修改 portable bytes 前，exclusive create
并 sync `migration.in-progress`。它是 Record root 下预期为零字节的 exact sentinel。
只要该 path 存在，即使内容损坏，open、plan 与 migrate 都 fail closed 为
`record-migration-interrupted`。它们不自动恢复、不删除 sentinel，也不重跑 migration。

所有 target Core、Attachment 与 blob bytes 先完成并 sync。target `record.json` 始终最后
写入并 sync，即使 Attachment-only migration 的内容与 source 相同。只有随后删除并 sync
`migration.in-progress`，root 才再次可读。中断、converter failure 或 I/O failure 留下
sentinel；用户从 Git 或自己的备份恢复。

preflight 在 sentinel 创建前验证 source decode、target identity、owner preservation、
路径冲突与完整 converter 链。Core 缺 converter、family edge 不连续或 Core 无法保留
unknown Attachment owner 时，plan 失败且不写文件。

`migrationUnavailable` 与 `unsupported` 都保留 exact old bytes，并逐项出现在 plan 与
receipt；两者不可混同。registry 把 extension 的 explicit converter failure 收口为稳定的
`record-attachment-migration-step-failed`。它不把 explicit failure 改成 defect。

## Typed error、Cause 与 Stream 边界

```ts
type RecordOpenError =
  | RecordIoError
  | RecordPermissionError
  | RecordBusyError
  | RecordBootstrapInvalid
  | RecordMigrationRequired
  | RecordMigrationInterruptedState
  | RecordFormatUnsupported;

type RecordReadError =
  | RecordIoError
  | RecordPermissionError
  | RecordReaderClosed
  | RecordHandleInvalid;

type RecordWriteError =
  | RecordIoError
  | RecordPermissionError
  | RecordBusyError
  | RecordWriterClosed
  | RecordDraftStateError
  | RecordDraftHandleInvalid
  | RecordReferenceInvalid
  | RecordCoreInvalid
  | RecordAttachmentEncodeError
  | RecordAttachmentClosureInvalid;

type RecordMigrationError =
  | RecordIoError
  | RecordPermissionError
  | RecordBusyError
  | RecordMigrationPlanStale
  | RecordAttachmentMigrationStepFailed
  | RecordMigrationInterruptedState;
```

每个 typed error 有稳定 `code` 与 bounded safe context。原始 filesystem error、Schema
tree、stack 与任意第三方 message 不进入 portable data 或默认 CLI JSON；它们只留在
受控 diagnostic cause。

interruption 不在这些联合中。Effect finalizer 释放资源后继续传播原 Cause。内部不变量、
registry 矛盾与 callback throw 是 defect，不能被转换成 data state 或 typed I/O error。

Library 不公开用于 Attachment value 的 Stream。内部 Stream 只服务 Run 扫描、写入、
migration 与形成读取 snapshot 的 blob I/O；`RecordAttachmentValue`、Sample、Projection
与 Report 仍是有界、自包含值。

## 最小调用形状

```ts
const program = Effect.scoped(
  Effect.gen(function* () {
    const reader = yield* openRecordReader({ root });
    return reader.runs.filter((entry) => entry.state === "available");
  }),
).pipe(Effect.provide(NodeRecordLive));
```

Effect 应用直接组合并运行 `program`。Promise compatibility facade 如果存在，只能包在这条
最外层 Effect 外面。
