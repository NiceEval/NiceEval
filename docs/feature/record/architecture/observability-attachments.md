# Observability Attachment

`niceeval.observability` 是 Record 的五个固定 Attachment family 之一。它的 envelope 固定为
`{ family: "niceeval.observability", schemaVersion: 1 }`。它保存已封口 Run 或 origin Attempt 的运行观察；
它不保存终端进度、raw provider frame、raw OTLP、Error stack、绝对路径、secret 或任意扩展 object。

本页拥有这个 family 的唯一 durable schema。通用 envelope、blob closure、`complete` 和 migration
边界见 [Record Architecture](../architecture.md)。Observability 领域怎样在运行中反馈和怎样进入
Analysis 见 [Observability](../../../observability.md)。

## 一个固定 family，一个 `owners` map

每个 origin Attempt 恰有一份 Attempt payload；每个 Run 恰有一份 Run payload。reference Member
沿精确 origin Attempt 读取，不复制 payload。NiceEval internal definition 以一个入口声明两个 owner，
不是外部可调用的 Attachment factory：

```ts
// NiceEval internal only. Each map key is the TS field; each property carries
// a separate token id and durable JSON key.
const attemptObservabilityProperties = {
  owner: defineRecordProperty({
    id: "niceeval.observability.attempt.owner",
    durableKey: "owner-kind",
    schema: Schema.Literal("attempt"),
  }),
  conversation: defineRecordProperty({
    id: "niceeval.observability.attempt.conversation",
    durableKey: "conversation-data",
    schema: ConversationCollectionSchema,
  }),
  commands: defineRecordProperty({
    id: "niceeval.observability.attempt.commands",
    durableKey: "commands-data",
    schema: CommandsCollectionSchema,
  }),
  usage: defineRecordProperty({
    id: "niceeval.observability.attempt.usage",
    durableKey: "usage-data",
    schema: UsageCollectionSchema,
  }),
  timing: defineRecordProperty({
    id: "niceeval.observability.attempt.timing",
    durableKey: "timing-data",
    schema: AttemptTimingCollectionSchema,
  }),
  diagnostics: defineRecordProperty({
    id: "niceeval.observability.attempt.diagnostics",
    durableKey: "diagnostics-data",
    schema: AttemptDiagnosticsCollectionSchema,
  }),
} as const;

const runObservabilityProperties = {
  owner: defineRecordProperty({
    id: "niceeval.observability.run.owner",
    durableKey: "owner-kind",
    schema: Schema.Literal("run"),
  }),
  timing: defineRecordProperty({
    id: "niceeval.observability.run.timing",
    durableKey: "timing-data",
    schema: RunTimingCollectionSchema,
  }),
  diagnostics: defineRecordProperty({
    id: "niceeval.observability.run.diagnostics",
    durableKey: "diagnostics-data",
    schema: RunDiagnosticsCollectionSchema,
  }),
} as const;

const observability = defineRecordAttachment({
  family: "niceeval.observability",
  current: {
    schemaVersion: 1,
    owners: {
      attempt: defineRecordValue({
        properties: attemptObservabilityProperties,
        leaf: "json-with-blob-refs",
        limits: AttemptObservabilityLimits,
        isBlobRef: isRecordBlobRef,
        refine: refineAttemptObservability,
      }),
      run: defineRecordValue({
        properties: runObservabilityProperties,
        leaf: "json-with-blob-refs",
        limits: RunObservabilityLimits,
        isBlobRef: isRecordBlobRef,
        refine: refineRunObservability,
      }),
    },
  },
});
```

`owners.attempt` 的已验证值是：

```ts
type AttemptObservabilityAttachment = {
  readonly owner: "attempt";
  readonly conversation: ConversationCollection;
  readonly commands: CommandsCollection;
  readonly usage: UsageCollection;
  readonly timing: AttemptTimingCollection;
  readonly diagnostics: AttemptDiagnosticsCollection;
};
```

`owners.run` 的已验证值是：

```ts
type RunObservabilityAttachment = {
  readonly owner: "run";
  readonly timing: RunTimingCollection;
  readonly diagnostics: RunDiagnosticsCollection;
};
```

owner discriminator（归属判别）和五个 Attempt data field 都是同一 Attachment 中的固定 property，不是
额外的 durable family。Attempt 即使确知没有 command、usage 或 timing interval，也写 `complete` 的空
collection。Run 的 properties map 没有 conversation、commands 和 usage；它们不会以 null、空 object 或
自定义 metadata 出现。

所有 payload 都是 exact JSON。array 按每种实体的 identity canonical 排序并拒绝重复。文本上限按
UTF-8 bytes 计。`SafeText` 已脱敏、没有 NUL 或 C0 control（换行除外）；它不是 raw Error 或任意
JSON 的容器。

## Collection 与 limitation

每个子结构独立声明采集完整度。`complete` 的 limitations 必须为空；`partial` 至少有一个有界原因。

```ts
type CollectionState<Limitation> =
  | { readonly state: "complete"; readonly limitations: readonly [] }
  | {
      readonly state: "partial";
      readonly limitations: readonly [Limitation, ...Limitation[]];
    };

type ObservabilityLimitation =
  | {
      readonly code: "capture-failed" | "capture-interrupted";
      readonly stage:
        | "adapter"
        | "command-capture"
        | "usage-capture"
        | "timing-capture"
        | "diagnostic-capture"
        | "attempt-finalizer"
        | "run-teardown";
      readonly target: ObservabilityTarget;
    }
  | {
      readonly code: "collection-cap-reached" | "unsupported-input";
      readonly target: ObservabilityTarget;
      readonly omittedAtLeast: PositiveSafeInteger;
    }
  | {
      readonly code: "text-truncated" | "redacted";
      readonly target: ObservabilityTarget;
      readonly replacementOrOmittedCount: PositiveSafeInteger;
    }
  | {
      readonly code: "stream-truncated";
      readonly commandId: CommandId;
      readonly stream: "stdout" | "stderr";
      readonly retainedBytes: NonNegativeSafeInteger;
      readonly omittedBytes: PositiveSafeInteger;
    }
  | {
      readonly code: "invalid-utf8-replaced" | "unsafe-control-stripped";
      readonly commandId: CommandId;
      readonly stream: "stdout" | "stderr";
      readonly count: PositiveSafeInteger;
    };

type ObservabilityTarget =
  | "conversation"
  | "command"
  | "usage"
  | "timing"
  | "diagnostic";
```

`partial` 表示这份已写入 Attachment 的事实有明确缺口，不表示没有发生。`not-recorded` 与 `invalid`
是 Record reader 的外层结果，不是 payload state，不能被当成空数组。envelope 的 family 或
schemaVersion 不匹配 current definition 时，Observability 是已知 family 的旧 schema，ordinary reader
返回 `migration-required`，不产生局部兼容读。未知 independent future family 适用另一条规则：reader 保留
其 bytes、跳过解释，继续读取 Observability 与其它认识的 family。

producer 为 turn、item、call、command、usage observation、interval 和 diagnostic mint 不可推导的
family-local identity。identity 不得由数组下标、文本、时间、provider、path 或目录名计算。

## Conversation

conversation 保存 provider-neutral、用户可见的语义。它不保存 hidden chain of thought、原始请求体或
provider 私有 trace attribute。

```ts
type ConversationCollection = {
  readonly collection: CollectionState<ObservabilityLimitation>;
  readonly turns: readonly ConversationTurn[];
  readonly items: readonly ConversationItem[];
};

type ConversationTurn = {
  readonly turnId: TurnId;
  readonly sequence: PositiveSafeInteger;
  readonly outcome: "completed" | "failed" | "cancelled" | "interrupted";
};

type ConversationItemBase = {
  readonly itemId: ItemId;
  readonly turnId: TurnId;
  readonly sequence: PositiveSafeInteger;
};

type ConversationItem =
  | (ConversationItemBase & {
      readonly kind: "message";
      readonly role: "user" | "assistant";
      readonly text: SafeText;
    })
  | (ConversationItemBase & {
      readonly kind: "tool-call";
      readonly callId: CallId;
      readonly tool: SourceNativeToolName;
      readonly inputSummary: SafeText;
    })
  | (ConversationItemBase & {
      readonly kind: "tool-result";
      readonly callId: CallId;
      readonly outcome: "completed" | "rejected" | "failed" | "cancelled";
      readonly outputSummary: SafeText;
    })
  | (ConversationItemBase & {
      readonly kind: "thinking-summary" | "compaction" | "context-injection";
      readonly summary: SafeText;
    })
  | (ConversationItemBase & {
      readonly kind: "subagent";
      readonly state: "started" | "completed" | "failed";
      readonly label: SafeIdentifier;
      readonly summary: SafeText;
    })
  | (ConversationItemBase & {
      readonly kind: "input-request";
      readonly state: "requested" | "answered" | "cancelled";
      readonly promptSummary: SafeText;
      readonly responseSummary: SafeText | null;
    })
  | (ConversationItemBase & {
      readonly kind: "skill-load" | "conversation-error";
      readonly code: SafeIdentifier;
      readonly summary: SafeText;
    });
```

turn 和 item `sequence` 在各自集合中唯一。每个 item 指向已有 turn；一个 tool-result 指向同一
Attachment 中恰一个 tool-call。`tool` 保留 source-native name，不能被 runtime canonical kind 替换。
无法安全归一的输入以 limitation 表示，而不是透传 raw frame。

## Commands

每个 Sandbox command 在调用前登记 manifest，在结束后登记一个终态 result。wrapper 已进入 provider
调用后收到取消时写 `terminated/cancelled`；可识别的本地 spawn 失败写
`not-started/spawn-failed`；其余未得到正常结果的调用写 `terminated/transport-lost`。三者都让
commands collection 变为 partial，且不能丢弃已登记的 manifest。

```ts
type CommandsCollection = {
  readonly collection: CollectionState<ObservabilityLimitation>;
  readonly commands: readonly CommandObservation[];
};

type CommandObservation = {
  readonly commandId: CommandId;
  readonly manifest: {
    readonly phase: StablePhase;
    readonly invocation:
      | { readonly kind: "argv"; readonly executable: SafeText; readonly arguments: readonly SafeText[] }
      | { readonly kind: "shell"; readonly command: SafeText };
    readonly workingDirectory:
      | { readonly kind: "sandbox-default" }
      | { readonly kind: "project-relative"; readonly path: CanonicalProjectRelativePath }
      | { readonly kind: "redacted" };
  };
  readonly result: {
    readonly outcome:
      | { readonly kind: "exited"; readonly exitCode: number }
      | { readonly kind: "terminated"; readonly reason: "timeout" | "cancelled" | "transport-lost" }
      | { readonly kind: "not-started"; readonly reason: "spawn-failed" | "cancelled-before-start" };
    readonly stdout: CommandStream;
    readonly stderr: CommandStream;
  };
};

type CommandStream = {
  readonly storage:
    | { readonly kind: "inline"; readonly text: SafeText }
    | { readonly kind: "blob"; readonly ref: RecordBlobRef };
  readonly retainedBytes: NonNegativeSafeInteger;
  readonly totalSafeUtf8Bytes: NonNegativeSafeInteger;
  readonly sha256: Sha256Digest;
};
```

collector 先进行非 fatal UTF-8 decode、已登记敏感值脱敏和 control removal，再截断每条 stream。
`retainedBytes` 等于 saved text 的 UTF-8 长度。小内容 inline，大内容使用本 Attachment 自己 closure
的 blob；`sha256` 是 exact retained safe UTF-8 bytes 的 SHA-256。

seal 和 reader materialization 都对实际 bytes 重算 byte length、digest 与 family budget；即使篡改后的
blob 长度不变也使 Attachment `invalid`。projector 统一两种 storage，因此 consumer 看不到物理差异。

## Usage

usage 保存不可再拆的 provider observation，不保存 Attempt aggregate、价格表、汇率或估算金额。

```ts
type UsageCollection = {
  readonly collection: CollectionState<ObservabilityLimitation>;
  readonly observations: readonly UsageObservation[];
};

type UsageObservation =
  | {
      readonly usageObservationId: UsageObservationId;
      readonly kind: "token-bucket";
      readonly provider: SafeIdentifier;
      readonly bucket: "input" | "output" | "cache-read" | "cache-write" | "reasoning" | "other";
      readonly tokens: NonNegativeSafeInteger;
    }
  | {
      readonly usageObservationId: UsageObservationId;
      readonly kind: "request";
      readonly provider: SafeIdentifier;
      readonly requestKind: "model" | "tool";
    }
  | {
      readonly usageObservationId: UsageObservationId;
      readonly kind: "provider-cost";
      readonly provider: SafeIdentifier;
      readonly amount: CanonicalDecimal;
      readonly currency: CurrencyCode;
    };
```

缺少 provider-observed cost 时，producer 不制造零金额。total token、cache ratio、成本换算和跨币种
汇总属于 Analysis Calculation。

## Timing

Run 与 Attempt 各自使用 owner-monotonic clock。offset 的零点不含 epoch，两个 owner 的 offset 不能
相减或拼接。OTel bridge 只能在事件发生时证明 exact owner、同一 clock、稳定 phase 和 label 后提交
interval；raw OTLP 不落盘。

```ts
type AttemptTimingCollection = {
  readonly collection: CollectionState<ObservabilityLimitation>;
  readonly intervals: readonly TimingInterval<AttemptTimingPhase>[];
};

type RunTimingCollection = {
  readonly collection: CollectionState<ObservabilityLimitation>;
  readonly intervals: readonly TimingInterval<RunTimingPhase>[];
};

type TimingInterval<Phase> = {
  readonly intervalId: IntervalId;
  readonly phase: Phase;
  readonly label: StableLabel;
  readonly startOffsetMs: NonNegativeSafeInteger;
  readonly durationMs: NonNegativeSafeInteger;
  readonly parentIntervalId: IntervalId | null;
  readonly outcome: "completed" | "failed" | "cancelled" | "interrupted" | "unknown";
};

type AttemptTimingPhase =
  | "attempt.setup"
  | "sandbox.prepare"
  | "agent.ensure"
  | "eval.run"
  | "agent.send"
  | "sandbox.command"
  | "assertion.evaluate"
  | "verdict.fold"
  | "attempt.teardown";

type RunTimingPhase =
  | "run.setup"
  | "run.discovery"
  | "run.plan"
  | "run.dispatch"
  | "run.teardown";
```

decoder 拒绝负数、不安全整数、重复 intervalId、缺失 parent、cycle、overflow 和 parent containment
violation。`unknown` outcome 必须使用 partial collection。schemaVersion `1` 不声明 designated root 或完整
causal edge。因此 observed interval window 不能自动成为 Attempt total duration 或 critical path。

标准 activity 有可信的测量值、但不能证明 parent containment 时，writer 保留其原始区间为 root，不把它伪造成
child，也不因此把 collection 标为 partial。root 不声明唯一因果边，可信活动可并发并重叠。

reuse 的 execution duration 只读取 complete collection 的 root 区间并集。按 start 排序后，第一段必须从 `0`
开始；后续段的 start 不得大于当前 covered end。重叠合法且只把 covered end 扩至较大终点，真正 gap 才使该
duration unavailable。

v1 不为 Runner 的内部 lifecycle 增加新的持久 phase：`sandbox.queue` 投影为 `attempt.setup`，
`workspace.diff` 与 `telemetry.collect` 投影为 `attempt.teardown`，同时保留原稳定 lifecycle label。因此这三类
正常完成的阶段不会单独把 timing collection 变成 partial。`workspace.diff.export` activity 同样投影为
`attempt.teardown`。标准 activity 的人读 label 不符合 `StableLabel` 时，持久值回退为它自己的稳定 key；
未知 activity 仍使 collection partial。

`judge.precheck`、`experiment.setup`、`experiment.teardown` 与 `agent.run` 都是已知的 Attempt 域外 phase。
writer 在原始 Runner clock 中继续累计它们，以便换算 child activity。持久 Attempt clock 则跳过它们，
不让上层工作制造 duration window 空洞。未知或损坏 phase 仍使 collection partial。

Runner 的嵌套 activity 只有在已测量区间实际包含时才持久化 parent edge。无法证明 containment 的标准 activity
保留为 root；未知 activity、无效数值和 cycle 仍使 collection partial。

## Diagnostics

diagnostics 保存 advisory 与 execution error，但自身不改变 Verdict、Score 或 reuse。

```ts
type AttemptDiagnosticsCollection = DiagnosticsCollection<AttemptDiagnosticPhase>;
type RunDiagnosticsCollection = DiagnosticsCollection<RunDiagnosticPhase>;

type DiagnosticsCollection<Phase> = {
  readonly collection: CollectionState<ObservabilityLimitation>;
  readonly diagnostics: readonly Diagnostic<Phase>[];
};

type Diagnostic<Phase> = {
  readonly diagnosticId: DiagnosticId;
  readonly kind: "advisory" | "execution-error";
  readonly code: SafeIdentifier;
  readonly phase: Phase;
  readonly summary: SafeText;
  readonly causes: readonly { readonly code: SafeIdentifier; readonly summary: SafeText }[];
  readonly redaction:
    | { readonly state: "none" }
    | { readonly state: "applied"; readonly replacements: PositiveSafeInteger };
  readonly sourceFrame: SourceFrame | null;
};

type SourceFrame = {
  readonly sourceItemId: SourceItemId;
  readonly sha256: Sha256Digest;
  readonly start: { readonly line: PositiveSafeInteger; readonly column: PositiveSafeInteger };
  readonly end: { readonly line: PositiveSafeInteger; readonly column: PositiveSafeInteger };
};
```

cause chain、summary 和 context 都有 family 的固定上限。诊断不持久化 raw exception、stack、Cause、
path、secret 或 arbitrary object。`sourceFrame` 只 join origin Run 的 immutable Sources item；它不携带
blob ref，也不授予跨 owner storage capability。

## Capture、seal 与错误

Adapter、Sandbox 和 Runner 只调用 NiceEval 的封闭 capture input。典型 Attempt API 是
`appendOtel()`、`appendEvent()`、command manifest/result、usage、timing 和 diagnostic capture；Run
API 只允许 timing 与 diagnostic capture。它们不能直接写 payload、定义字段或 mint blob key。

Attempt finalizer 停稳后，collector 停止接收值并冻结一个 `AttemptObservabilityAttachment`。Run
teardown 停稳后冻结一个 `RunObservabilityAttachment`。Run `seal()` 随后验证 collection、identity、
limit、command/result pair、stream closure 的实际 bytes／size／sha256、timing tree 和 Sources frame。
它再把这两个固定 payload 作为普通 Record closure 写入。

```ts
type ObservabilityCaptureError =
  | { readonly code: "observability-capture-sealed"; readonly owner: "run" | "attempt" }
  | { readonly code: "observability-input-not-safe"; readonly field: "text" | "manifest" | "diagnostic" };

type ObservabilityRecordContractError =
  | { readonly code: "observability-owner-invalid"; readonly owner: "run" | "attempt" }
  | { readonly code: "observability-identity-invalid"; readonly entity: string }
  | { readonly code: "observability-timing-tree-invalid"; readonly intervalId: IntervalId }
  | { readonly code: "observability-source-frame-invalid"; readonly diagnosticId: DiagnosticId };
```

采集不足时，collector 尽量保存已验证的安全数据并给出 partial limitation。不能安全形成 exact payload
或命令生命周期无效时返回 `ObservabilityCaptureError`；联合验证失败返回
`ObservabilityRecordContractError`；I/O 与 closure 问题仍是 `RecordWriteError`。raw payload、exception、
secret 和 stack 不进入 typed error。

## 读取与版本

Host 只把完整的 `available` internal snapshot 交给 Analysis。读取命令 stream 时，Analysis 以该 snapshot
统一 inline 与 blob storage；选择 Run、汇总 command success、计算成本或连接另一份 Attachment 仍属于
Analysis Calculation，不能回写 Record。Report 不取得这个 snapshot、reader 或 blob capability。

schemaVersion `1` 没有已发布 predecessor，`niceeval migrate` 返回 `already-current`。未发布的带 `/vN`
后缀的 Observability 草案返回 `unsupported-format`。未来 schemaVersion `2` 发布时，NiceEval 在
maintenance facet 中提供固定 `1 → 2` step。该步骤先完成或恢复，之后才允许 ordinary read；它不成为
family read、Analysis 或 Report 的状态。独立未知 future family 不触发这条 migration，也不污染可读的
Observability 事实。
