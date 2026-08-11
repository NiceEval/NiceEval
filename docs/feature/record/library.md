# Record Library

Library 只暴露两种长期能力：lock-free `RecordReader` 与单 writer `RecordWriteSession`。业务功能通过 channel schema 与 FactRequirement 扩展，不给 storage API 增加 `writeAssertions2()`、`readUsage3()` 一类代际方法。

所有文件、句柄和 writer lock 都由 `Effect.Scope` 拥有。native API 保留 `Effect`、typed error 与 interruption，不直接返回 `Promise`，也不自行 `Effect.runPromise`；只有最外层 CLI 或明确的兼容 facade 可以运行一次 Effect。

## 打开形状

```ts
type RecordRoot = string;

declare const openRecordReader: (input: {
  root: RecordRoot;
  cache?: "allowed" | "disabled";
}) => Effect.Effect<
  RecordReader,
  RecordOpenError,
  Scope.Scope | RecordFileSystem
>;

declare const openRecordWriteSession: (input: {
  root: RecordRoot;
  mode: "open" | "open-or-create";
}) => Effect.Effect<
  RecordWriteSession,
  RecordOpenError | RecordWriteSessionError,
  Scope.Scope | RecordFileSystem | RecordWriterLock | RecordEntropy
>;
```

公开 constructor 的 Effect 依赖集合如实保留这些 service：reader 需要 `Scope | RecordFileSystem`，writer、root 初始化与 recovery 还需要 `RecordWriterLock | RecordEntropy`。动态 Record root 是 scoped constructor 的普通输入，不为每个 root 创建 Layer。

`root` 永远是实际 Record root。`open-or-create` 只在 root 不存在时初始化精确 `niceeval.record/v1`；已有非 Record 目录不领养、不清空。初始化也先取得 writer lock、完成 storage capability preflight，再在同一 filesystem 的 local staging 中形成完整 root，以 no-replace directory rename 一次建立。

典型读取由一个 Scope 约束：

```ts
const input = yield* Effect.scoped(
  Effect.gen(function* () {
    const reader = yield* openRecordReader({ root, cache: "allowed" });
    const sample = yield* projectAnalysis({ reader, selection });
    const plan = report.plan(sample);
    return yield* buildReportInput({ reader, sample, plan });
  }),
);

// input 自包含；以下 ReportExecution 不再访问 Record。
const execution = executeReport({ definition: report, input });
```

reader 不取得 writer lock。Scope 只关闭它拥有的目录/file handles 与 cache temp；dispose 后调用方法得到 `record-reader-closed`。

## RecordReader

```ts
interface RecordReader {
  readonly root: RecordRoot;
  readonly record: RecordDocument;

  candidates(): Effect.Effect<
    readonly RunCandidate[],
    RecordReadError
  >;

  run(runId: RunId): Effect.Effect<
    CoreRead<RunDocument>,
    RecordReadError
  >;

  freezeSelection(runIds: readonly RunId[]): Effect.Effect<
    RecordSelection,
    RecordReadError
  >;

  members(input: {
    selection: RecordSelection;
    runId: RunId;
  }): Effect.Effect<
    readonly MemberCandidate[],
    RecordReadError
  >;

  attempt(input: {
    selection: RecordSelection;
    ref: AttemptRef;
  }): Effect.Effect<
    CoreRead<AttemptDocument>,
    RecordReadError
  >;

  inspectFact<A>(input: {
    selection: RecordSelection;
    owner: FactOwner;
    requirement: FactRequirement<A>;
  }): Effect.Effect<ChannelRead<A>, RecordReadError>;
}

type RunCandidate =
  | {
      state: "read";
      entry: string;
      runId: RunId;
      value: RunDocument;
    }
  | {
      state: "invalid";
      entry: string;
      runId?: RunId;
      issues: NonEmptyRecordIssues;
    };

type MemberCandidate =
  | {
      state: "read";
      entry: string;
      runId: RunId;
      slotId: SlotId;
      value: MemberDocument;
    }
  | {
      state: "invalid";
      entry: string;
      runId: RunId;
      slotId?: SlotId;
      issues: NonEmptyRecordIssues;
    };

type CoreRead<A> =
  | { state: "read"; value: A }
  | { state: "missing" }
  | { state: "invalid"; issues: NonEmptyRecordIssues };
```

`candidates()` 总是返回 reader 创建时冻结的同一序列，包括 malformed entry。`run(id)` 只访问 frozen candidateSet；即使之后磁盘出现该 ID，也返回 missing。

`freezeSelection()` 先验证显式 IDs 属于 candidateSet，再冻结这些 Run 的全部 Member entry，并沿每个可读 Member 的精确 Attempt 引用建立 dependency closure。closure 是 opaque、reader-bound 普通值：

```ts
interface RecordSelection {
  readonly selectedRunIds: readonly RunId[];
  readonly attemptRefs: readonly AttemptRef[];
}

type AttemptRef = {
  originRunId: RunId;
  attemptId: AttemptId;
};
```

`members()` 只接受 selection 中的 Run，并返回冻结时按 raw entry 排序的完整序列；缺少 Member 的 expected slot 由 projector 从 `RunDocument.expectedSlots` 推出，额外或无法关联 slot 的 entry 仍以 `invalid` 保留。`attempt()` 只接受 `attemptRefs` 中的精确引用。二者让 analysis projector 能从 expected slot 走到 Member、Attempt core 与对应 fact，不暴露任意目录遍历。

Library 内部的 `resolveDependency(ref)` 可以直接打开初次弱扫描漏掉的 origin Run，但只能响应已选 Member 的精确引用。它不是任意寻址接口，不能用于 latest、扩张 `AnalysisSample` 分母或扫描 origin Run。`attemptRefs` 是全部可读 Member 直接采用的 ref 去重排序结果，包括 selected Run 自己的 executed Attempt；它不递归追踪业务通道中的引用。closure 建成后，`attempt()` 与 `inspectFact()` 只读取其中 owner，且不重新读取后来发布的版本。把 selection 传给另一个 reader 返回 `record-selection-invalid`。

每次 `niceeval view` rebuild 都丢弃上一轮 `RecordSelection`、ReportInput、execution 与 reader，再在新 Scope 中打开。不得让旧 selection 跨 reader 复用。

## Channel registry 与 FactRequirement

reader 内置 [Built-in channel registry](architecture.md#built-in-channel-registry)。每个 registry entry 以 `(owner kind, schemaId, mediaType)` 选择唯一 decoder，再归一到稳定 FactRequirement identity。owner kind 是 key 的一部分，因此 Run 与 Attempt 可以合法使用同一个 schema ID；channel name 相同但 schema 不受 requirement 接受时返回 unsupported，不尝试字段探测。

```ts
interface FactRequirement<A> {
  readonly id: string;
  readonly channelName: ChannelName;
  readonly acceptedSchemas: readonly [
    ChannelSchemaId,
    ...ChannelSchemaId[],
  ];
}

type FactOwner =
  | { kind: "run"; runId: RunId }
  | { kind: "attempt"; ref: AttemptRef };

interface BuiltInChannelDecodeContext {
  readAttemptBlob(
    ref: AttemptBlobRef,
  ): Effect.Effect<BlobRead, RecordReadError>;

  readRunSourceBlob(
    ref: RunSourceBlobRef,
  ): Effect.Effect<BlobRead, RecordReadError>;
}

type BlobRead =
  | { state: "read"; bytes: Uint8Array }
  | { state: "invalid"; issues: NonEmptyChannelIssues };

type ChannelRead<A> =
  | {
      state: "read";
      value: A;
      schemaId: ChannelSchemaId;
      collection: { state: "complete" } | {
        state: "partial";
        reason: string;
      };
      decoding: { state: "complete" } | {
        state: "partial";
        decoded: number;
        total: number;
        issues: NonEmptyChannelIssues;
      };
    }
  | {
      state: "unavailable";
      reason: string;
    }
  | {
      state: "unsupported";
      descriptor: ChannelDescriptor;
      issues: NonEmptyChannelIssues;
    }
  | {
      state: "invalid";
      descriptor?: ChannelDescriptor;
      issues: NonEmptyChannelIssues;
    };
```

四态不能折成 `null`、空数组或 throw：

| durable 情况 | ChannelRead |
|---|---|
| 没有同名 descriptor | `unavailable` |
| descriptor 明确 unavailable | `unavailable`，保留 reason |
| schemaId 或 media type 不在 registry/requirement | `unsupported` |
| core、descriptor、路径、payload 或 blob 损坏 | `invalid` |
| decoder 完整建立 normalized value | `read` |

一个坏 descriptor 只影响能安全关联到的 channel。owner 中存在连 name 都无法安全解码的 raw entry 时，没有匹配到有效 descriptor 的 requirement 必须 invalid，不能假装 unavailable。权限与 I/O 属于 Effect error channel，不伪装成业务四态。

decoder context 只返回 bytes，不返回 Record root 或物理路径。只有 Attempt-owned、registry 明确授权 blob 的 built-in decoder 能调用 `readAttemptBlob()`；只有 Run-owned `niceeval.sources/v1` decoder 能调用 `readRunSourceBlob()`。越界、缺失、长度/digest 不符、link 或特殊文件形成对应 fact 的 `invalid`；权限和真实 I/O 仍进入 `RecordReadError`。

blob/NDJSON Stream 是 reader Scope 内的内部字节能力，不出现在公开读取面。`inspectFact()` 先消费或 fold 完整条 Stream，再返回稳定的 `ChannelRead`。decoder context 返回的 `Uint8Array` 是消费完成后的自包含结果；它是否带来有界内存由对应 fact 的契约承担，拿到完整 bytes 本身并不保证有界。

custom registry 只能增加调用方 namespace 的 decoder。它不能替换 `niceeval.*` decoder、改变 built-in FactRequirement 的 accepted schemas，也不取得 built-in blob context；需要外部资源的自定义 fact 必须先解码成自包含值。

## RecordWriteSession

```ts
interface RecordWriteSession {
  readonly root: RecordRoot;
  readonly sessionId: SessionId;
  readonly view: RecordReader;

  stageRun(input: CompleteRunInput): Effect.Effect<
    SealedRun,
    RecordWriteError
  >;

  publishRun(run: SealedRun): Effect.Effect<
    PublishReceipt,
    RecordWriteError
  >;
}

interface SealedRun {
  readonly sessionId: SessionId;
  readonly runId: RunId;
  readonly _opaque: unique symbol;
}

type PublishReceipt = {
  runId: RunId;
  durable: true;
  localCleanup: "complete" | "pending";
};
```

`CompleteRunInput` 是 core aggregate 加 generic channel payloads 的内部 producer port。新增 Assertions、usage 或其它业务 schema 只增加 registry/descriptor 数据，不增加 write-session 方法。runner 可以在 session-owned `build/` 增量形成 aggregate，但 `stageRun()` 只有在完整校验、close、seal 和 recovery manifest 落稳后才返回 opaque `SealedRun`。

`SealedRun` 绑定 session，调用方不能构造、跨 session 使用或在 publish 后再次使用。`publishRun()` 只做 destination revalidation、no-replace rename 与两端 parent fsync，然后重新校验 destination manifest 并删除 local 现场。它不调用模型、不继续 Sandbox、不重新投影 carry，也不修改 aggregate。

session 的 `view` 在取得 writer lock 后创建并冻结。它看不见本 session 后来发布的 Run，因此 target 不会参与自己的 source barrier。同一 Record 的其它 reader 可以并发看到每个已发布 Run。

Scope 正常结束时，session 拒绝新调用、等待已开始的 local writes，删除本 owner 尚未 seal 的 build temp，然后释放 writer lock。已 seal 但未完成 publish/cleanup 的 recovery 现场不能由 finalizer 静默删除；下一位 writer 必须先恢复或 abandon。

## Recovery API

恢复是独立的显式写操作，不通过普通 `openRecordWriteSession()` 猜测：

```ts
declare const recoverRecordSession: (input: {
  root: RecordRoot;
  sessionId: SessionId;
  mode: "commit-only";
}) => Effect.Effect<
  readonly PublishReceipt[],
  RecordRecoveryError,
  Scope.Scope | RecordFileSystem | RecordWriterLock | RecordEntropy
>;

declare const abandonRecordSession: (input: {
  root: RecordRoot;
  sessionId: SessionId;
}) => Effect.Effect<
  void,
  RecordRecoveryError,
  Scope.Scope | RecordFileSystem | RecordWriterLock | RecordEntropy
>;
```

两者先取得同一 writer lock，并绑定 canonical root 与 durable `recordId`。`commit-only` 只处理可解码的 `niceeval.local-session/v1` 与 `niceeval.publish-recovery/v1`。它逐 Run 执行 [crash matrix](architecture.md#recovery-manifest-与-crash-matrix)；building-only session 返回 `record-session-not-committable`。

`abandon` 是未知 future session schema 的唯一受支持处理。它只按调用方给出的 canonical session ID 删除 no-follow local directory，不打开 source/destination、不修改 durable Record，也不扫描删除其它 session。多个遗留 session 必须逐个显式处理。

如果 destination 已 durable 但 local cleanup 失败，recovery 返回 `PublishReceipt.localCleanup = "pending"` 与具名 diagnostic。该现场继续阻止普通 writer，直到再次执行 commit-only cleanup 或 explicit abandon。

## Cache 行为

reader 的 `cache: "allowed"` 只授权 best-effort local 派生写。每次 cache write 使用随机 owner temp、fsync/close 后 atomic replace；竞争、损坏、权限与 I/O 全部在内部退化为 cache miss。

`cache: "allowed"` 只有在 `local.json` 精确匹配时才使用缓存；sidecar 缺失、权限失败、错误类型、未知 schema 或 identity mismatch 都退化为 no-cache，不能阻止 durable Record 打开，也不能改变公开读数。`cache: "disabled"` 不读不写 cache，并必须产生相同 candidates、selection、facts 与 issues。

cache 不持有资源生命周期，不让 reader 变成 writer，也不取得 `write.lock`。实现不能把一个负缓存或 cached latest 当作跳过 durable scan 的依据。

## Typed errors

错误类是 Effect error channel 中的 tagged values；`code` 是机器契约，message 只服务反馈。

```ts
class RecordOpenError extends Data.TaggedError("RecordOpenError")<{
  code:
    | "record-root-missing"
    | "record-root-exists"
    | "record-format-unsupported"
    | "record-core-invalid"
    | "record-local-identity-collision"
    | "record-storage-capability-unsupported"
    | "record-open-permission-denied"
    | "record-open-io-failure";
}> {}

class RecordWriteSessionError extends Data.TaggedError(
  "RecordWriteSessionError",
)<{
  code:
    | "record-writer-busy"
    | "record-recovery-required"
    | "record-local-cleanup-pending"
    | "record-session-schema-unsupported";
  sessionIds?: readonly SessionId[];
}> {}

class RecordReadError extends Data.TaggedError("RecordReadError")<{
  code:
    | "record-reader-closed"
    | "record-selection-invalid"
    | "record-read-permission-denied"
    | "record-read-io-failure";
}> {}

class RecordWriteError extends Data.TaggedError("RecordWriteError")<{
  code:
    | "record-write-session-closed"
    | "record-input-invalid"
    | "record-run-seal-failed"
    | "record-run-destination-exists"
    | "record-publish-ambiguous"
    | "record-publish-outcome-unknown"
    | "record-publish-invalid"
    | "record-local-cleanup-pending"
    | "record-write-permission-denied"
    | "record-write-io-failure";
}> {}

class RecordRecoveryError extends Data.TaggedError(
  "RecordRecoveryError",
)<{
  code:
    | "record-writer-busy"
    | "record-session-missing"
    | "record-session-schema-unsupported"
    | "record-session-identity-mismatch"
    | "record-session-not-committable"
    | "record-publish-ambiguous"
    | "record-publish-outcome-unknown"
    | "record-publish-invalid"
    | "record-recovery-permission-denied"
    | "record-recovery-io-failure";
}> {}
```

malformed Run、Member、Attempt 和 channel bytes 通常属于 `CoreRead.invalid` 或 `ChannelRead.invalid`，让 projector按作用域处理。无法访问 root、权限失败、reader 已关闭和真实 I/O 故障才进入 Effect error channel。

## 非职责

Library 不提供局部 edit/delete、跨 Record copy/merge、Git、revision、proof、远端同步、页面计算或报告渲染 API。whole-root portable 规则见 [Architecture](architecture.md#portablegit-与外部操作)。

分析范围属于 [Sample](../sample/README.md)，carry/gap 属于 [Experiments](../experiments/cache.md)，Record→Reports composition 与静态 export 属于 [Reports](../reports/README.md)。
