# Observability Attachment

`niceeval.observability/v1` 是 Record 的五个固定 Attachment family 之一。它保存已封口 Run 或
origin Attempt 的运行观察；它不保存终端进度、raw provider frame、raw OTLP、Error stack、绝对路径、
secret 或任意扩展 object。

本页拥有这个 family 的唯一 durable schema。通用 envelope、blob closure、`complete` 和 migration
边界见 [Record Architecture](../architecture.md)。Observability 领域怎样在运行中反馈和怎样进入
Analysis 见 [Observability](../../../observability.md)。

## 一个固定 family，两个 owner payload

每个 origin Attempt 恰有一份 Attempt payload；每个 Run 恰有一份 Run payload。reference Member
沿精确 origin Attempt 读取，不复制 payload。两者都使用同一个 envelope schema identity：
`niceeval.observability/v1`。

```ts
type ObservabilityAttachmentV1 =
  | AttemptObservabilityAttachmentV1
  | RunObservabilityAttachmentV1;

type AttemptObservabilityAttachmentV1 = {
  readonly owner: "attempt";
  readonly conversation: ConversationCollectionV1;
  readonly commands: CommandsCollectionV1;
  readonly usage: UsageCollectionV1;
  readonly timing: AttemptTimingCollectionV1;
  readonly diagnostics: AttemptDiagnosticsCollectionV1;
};

type RunObservabilityAttachmentV1 = {
  readonly owner: "run";
  readonly timing: RunTimingCollectionV1;
  readonly diagnostics: RunDiagnosticsCollectionV1;
};
```

五个 field 是同一 Attachment 中的固定子结构，不是五个可注册的物理 family。Attempt 即使确知没有
command、usage 或 timing interval，也写 `complete` 的空 collection。Run 没有 conversation、commands
和 usage field；它们不会以 null、空 object 或自定义 metadata 出现。

所有 payload 都是 exact JSON。array 按每种实体的 identity canonical 排序并拒绝重复。文本上限按
UTF-8 bytes 计。`SafeText` 已脱敏、没有 NUL 或 C0 control（换行除外）；它不是 raw Error 或任意
JSON 的容器。

## Collection 与 limitation

每个子结构独立声明采集完整度。`complete` 的 limitations 必须为空；`partial` 至少有一个有界原因。

```ts
type CollectionStateV1<Limitation> =
  | { readonly state: "complete"; readonly limitations: readonly [] }
  | {
      readonly state: "partial";
      readonly limitations: readonly [Limitation, ...Limitation[]];
    };

type ObservabilityLimitationV1 =
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
      readonly target: ObservabilityTargetV1;
    }
  | {
      readonly code: "collection-cap-reached" | "unsupported-input";
      readonly target: ObservabilityTargetV1;
      readonly omittedAtLeast: PositiveSafeInteger;
    }
  | {
      readonly code: "text-truncated" | "redacted";
      readonly target: ObservabilityTargetV1;
      readonly replacementOrOmittedCount: PositiveSafeInteger;
    }
  | {
      readonly code: "stream-truncated";
      readonly commandId: CommandIdV1;
      readonly stream: "stdout" | "stderr";
      readonly retainedBytes: NonNegativeSafeInteger;
      readonly omittedBytes: PositiveSafeInteger;
    }
  | {
      readonly code: "invalid-utf8-replaced" | "unsafe-control-stripped";
      readonly commandId: CommandIdV1;
      readonly stream: "stdout" | "stderr";
      readonly count: PositiveSafeInteger;
    };

type ObservabilityTargetV1 =
  | "conversation"
  | "command"
  | "usage"
  | "timing"
  | "diagnostic";
```

`partial` 表示这份已写入 Attachment 的事实有明确缺口，不表示没有发生。`not-recorded`、
`unsupported` 和 `invalid` 是 Record reader 的外层结果，不是 payload state，不能被投影成空数组。

producer 为 turn、item、call、command、usage observation、interval 和 diagnostic mint 不可推导的
family-local identity。identity 不得由数组下标、文本、时间、provider、path 或目录名计算。

## Conversation

conversation 保存 provider-neutral、用户可见的语义。它不保存 hidden chain of thought、原始请求体或
provider 私有 trace attribute。

```ts
type ConversationCollectionV1 = {
  readonly collection: CollectionStateV1<ObservabilityLimitationV1>;
  readonly turns: readonly ConversationTurnV1[];
  readonly items: readonly ConversationItemV1[];
};

type ConversationTurnV1 = {
  readonly turnId: TurnIdV1;
  readonly sequence: PositiveSafeInteger;
  readonly outcome: "completed" | "failed" | "cancelled" | "interrupted";
};

type ConversationItemBaseV1 = {
  readonly itemId: ItemIdV1;
  readonly turnId: TurnIdV1;
  readonly sequence: PositiveSafeInteger;
};

type ConversationItemV1 =
  | (ConversationItemBaseV1 & {
      readonly kind: "message";
      readonly role: "user" | "assistant";
      readonly text: SafeText;
    })
  | (ConversationItemBaseV1 & {
      readonly kind: "tool-call";
      readonly callId: CallIdV1;
      readonly tool: SourceNativeToolName;
      readonly inputSummary: SafeText;
    })
  | (ConversationItemBaseV1 & {
      readonly kind: "tool-result";
      readonly callId: CallIdV1;
      readonly outcome: "completed" | "rejected" | "failed" | "cancelled";
      readonly outputSummary: SafeText;
    })
  | (ConversationItemBaseV1 & {
      readonly kind: "thinking-summary" | "compaction" | "context-injection";
      readonly summary: SafeText;
    })
  | (ConversationItemBaseV1 & {
      readonly kind: "subagent";
      readonly state: "started" | "completed" | "failed";
      readonly label: SafeIdentifier;
      readonly summary: SafeText;
    })
  | (ConversationItemBaseV1 & {
      readonly kind: "input-request";
      readonly state: "requested" | "answered" | "cancelled";
      readonly promptSummary: SafeText;
      readonly responseSummary: SafeText | null;
    })
  | (ConversationItemBaseV1 & {
      readonly kind: "skill-load" | "conversation-error";
      readonly code: SafeIdentifier;
      readonly summary: SafeText;
    });
```

turn 和 item `sequence` 在各自集合中唯一。每个 item 指向已有 turn；一个 tool-result 指向同一
Attachment 中恰一个 tool-call。`tool` 保留 source-native name，不能被 runtime canonical kind 替换。
无法安全归一的输入以 limitation 表示，而不是透传 raw frame。

## Commands

每个 Sandbox command 在调用前登记 manifest，在结束后登记一个终态 result。未得到终态时写
`transport-lost` 或 `not-started` result，并让 collection 变为 partial；不能只留下 manifest。

```ts
type CommandsCollectionV1 = {
  readonly collection: CollectionStateV1<ObservabilityLimitationV1>;
  readonly commands: readonly CommandObservationV1[];
};

type CommandObservationV1 = {
  readonly commandId: CommandIdV1;
  readonly manifest: {
    readonly phase: StablePhaseV1;
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
    readonly stdout: CommandStreamV1;
    readonly stderr: CommandStreamV1;
  };
};

type CommandStreamV1 = {
  readonly storage:
    | { readonly kind: "inline"; readonly text: SafeText }
    | { readonly kind: "blob"; readonly ref: RecordBlobRef };
  readonly retainedBytes: NonNegativeSafeInteger;
  readonly totalSafeUtf8Bytes: NonNegativeSafeInteger;
};
```

collector 先进行非 fatal UTF-8 decode、已登记敏感值脱敏和 control removal，再截断每条 stream。
`retainedBytes` 等于 saved text 的 UTF-8 长度。小内容 inline，大内容使用本 Attachment 自己 closure
的 blob；projector 统一两种 storage，因此 consumer 看不到物理差异。

## Usage

usage 保存不可再拆的 provider observation，不保存 Attempt aggregate、价格表、汇率或估算金额。

```ts
type UsageCollectionV1 = {
  readonly collection: CollectionStateV1<ObservabilityLimitationV1>;
  readonly observations: readonly UsageObservationV1[];
};

type UsageObservationV1 =
  | {
      readonly usageObservationId: UsageObservationIdV1;
      readonly kind: "token-bucket";
      readonly provider: SafeIdentifier;
      readonly bucket: "input" | "output" | "cache-read" | "cache-write" | "reasoning" | "other";
      readonly tokens: NonNegativeSafeInteger;
    }
  | {
      readonly usageObservationId: UsageObservationIdV1;
      readonly kind: "request";
      readonly provider: SafeIdentifier;
      readonly requestKind: "model" | "tool";
    }
  | {
      readonly usageObservationId: UsageObservationIdV1;
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
type AttemptTimingCollectionV1 = {
  readonly collection: CollectionStateV1<ObservabilityLimitationV1>;
  readonly intervals: readonly TimingIntervalV1<AttemptTimingPhaseV1>[];
};

type RunTimingCollectionV1 = {
  readonly collection: CollectionStateV1<ObservabilityLimitationV1>;
  readonly intervals: readonly TimingIntervalV1<RunTimingPhaseV1>[];
};

type TimingIntervalV1<Phase> = {
  readonly intervalId: IntervalIdV1;
  readonly phase: Phase;
  readonly label: StableLabel;
  readonly startOffsetMs: NonNegativeSafeInteger;
  readonly durationMs: NonNegativeSafeInteger;
  readonly parentIntervalId: IntervalIdV1 | null;
  readonly outcome: "completed" | "failed" | "cancelled" | "interrupted" | "unknown";
};

type AttemptTimingPhaseV1 =
  | "attempt.setup"
  | "sandbox.prepare"
  | "agent.ensure"
  | "eval.run"
  | "agent.send"
  | "sandbox.command"
  | "assertion.evaluate"
  | "verdict.fold"
  | "attempt.teardown";

type RunTimingPhaseV1 =
  | "run.setup"
  | "run.discovery"
  | "run.plan"
  | "run.dispatch"
  | "run.teardown";
```

decoder 拒绝负数、不安全整数、重复 intervalId、缺失 parent、cycle、overflow 和 parent containment
violation。`unknown` outcome 必须使用 partial collection。v1 没有 designated root 或完整 causal edge。
因此 observed interval window 不能自动成为 Attempt total duration 或 critical path。

## Diagnostics

diagnostics 保存 advisory 与 execution error，但自身不改变 Verdict、Score 或 reuse。

```ts
type AttemptDiagnosticsCollectionV1 = DiagnosticsCollectionV1<AttemptDiagnosticPhaseV1>;
type RunDiagnosticsCollectionV1 = DiagnosticsCollectionV1<RunDiagnosticPhaseV1>;

type DiagnosticsCollectionV1<Phase> = {
  readonly collection: CollectionStateV1<ObservabilityLimitationV1>;
  readonly diagnostics: readonly DiagnosticV1<Phase>[];
};

type DiagnosticV1<Phase> = {
  readonly diagnosticId: DiagnosticIdV1;
  readonly kind: "advisory" | "execution-error";
  readonly code: SafeIdentifier;
  readonly phase: Phase;
  readonly summary: SafeText;
  readonly causes: readonly { readonly code: SafeIdentifier; readonly summary: SafeText }[];
  readonly redaction:
    | { readonly state: "none" }
    | { readonly state: "applied"; readonly replacements: PositiveSafeInteger };
  readonly sourceFrame: SourceFrameV1 | null;
};

type SourceFrameV1 = {
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
`appendOtel()`、`appendEvent()`、command register/result、usage、timing 和 diagnostic capture；Run
API 只允许 timing 与 diagnostic capture。它们不能直接写 payload、定义字段或 mint blob key。

Attempt finalizer 停稳后，collector 停止接收值并冻结一个 `AttemptObservabilityAttachmentV1`。Run
teardown 停稳后冻结一个 `RunObservabilityAttachmentV1`。Run `seal()` 随后验证 collection、identity、
limit、command/result pair、stream closure、timing tree 和 Sources frame，再把这两个固定 payload 作为
普通 Record closure 写入。

```ts
type ObservabilityCaptureError =
  | { readonly code: "observability-capture-sealed"; readonly owner: "run" | "attempt" }
  | { readonly code: "observability-command-not-registered"; readonly commandId: CommandIdV1 }
  | { readonly code: "observability-command-result-already-recorded"; readonly commandId: CommandIdV1 }
  | { readonly code: "observability-input-not-safe"; readonly field: "text" | "manifest" | "diagnostic" };

type ObservabilityRecordContractError =
  | { readonly code: "observability-owner-invalid"; readonly owner: "run" | "attempt" }
  | { readonly code: "observability-identity-invalid"; readonly entity: string }
  | { readonly code: "observability-timing-tree-invalid"; readonly intervalId: IntervalIdV1 }
  | { readonly code: "observability-source-frame-invalid"; readonly diagnosticId: DiagnosticIdV1 };
```

采集不足时，collector 尽量保存已验证的安全数据并给出 partial limitation。不能安全形成 exact payload
时返回 `ObservabilityCaptureError`；联合验证失败返回 `ObservabilityRecordContractError`；I/O 与 closure
问题仍是 `RecordWriteError`。raw payload、exception、secret 和 stack 不进入 typed error。

## Projector 与版本

neutral projector（中立投影）只接收一份 `available` Observability Attachment，并返回相同 owner 的
self-contained view。它可以统一 command stream 的 inline/blob storage，却不选择 Run、汇总 command
success、计算成本或连接另一份 Attachment。那些工作属于 Analysis Calculation。

`niceeval.observability/v1` 是首个支持 schema，没有前代 migration。`niceeval migrate` 遇到 v1 返回
`already-current`；任何非支持格式返回 `unsupported-format`。当发布 `niceeval.observability/v2` 时，
NiceEval 必须同时发布固定的 v1→v2 migration；第三方不能注册、替换或执行该步骤。
