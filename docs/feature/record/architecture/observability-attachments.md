# Observability Source receipts

Observability 的 durable facts 按产生事实的 capture authority 切分。conversation、usage、timing 与
diagnostics 是 reader-side view，不是持久 family。Adapter、SessionManager、Sandbox wrapper 与 Runner
分别保存自己亲历且有权解释的事实，不能替另一个 capture authority 重建内容或补写 provenance。

本页拥有五个 Observability source family、Source receipt、Seal manifest 与 reader-side view 的唯一目标契约。
通用 envelope、portable closure、staging、发布与恢复边界见 [Record Architecture](../architecture.md)。

## 五个固定 source family

| family | owner | capture authority | own blobs |
|---|---|---|---|
| `niceeval.agent-turns` | Attempt | Adapter 解释后的 terminal Turn | 无 |
| `niceeval.turn-contexts` | Attempt | SessionManager 的物理 `t.send` context | 无 |
| `niceeval.sandbox-commands` | Attempt | Sandbox wrapper 的 command lifecycle | stdout / stderr |
| `niceeval.runner-activities` | Attempt、Run | 对应 owner 的 Runner monotonic clock | 无 |
| `niceeval.runner-diagnostics` | Attempt、Run | 对应 owner 的 Runner diagnostic sink | 无 |

这五个名称是全部 Observability durable family。它们不按 Adapter 品牌、provider、Report 栏位或
reader-side view 扩张。第三方只能提交 NiceEval 固定的 capture input，不能注册 family、schema、migration，
也不能取得 staging、payload、blob 或 publisher capability。

一个 family 在一个 owner 下最多有一份 Attachment。payload 是一组有序、不可变的 Source receipt segments：

```ts
type SourceReceiptSet<Segment extends SourceReceiptSegment, Limitation> = {
  readonly collection:
    | { readonly state: "complete"; readonly limitations: readonly [] }
    | {
        readonly state: "partial";
        readonly limitations: readonly [Limitation, ...Limitation[]];
      };
  readonly segments: readonly Segment[];
};

type SourceReceiptSegment = {
  readonly segmentId: SourceSegmentId;
  readonly sequence: PositiveSafeInteger;
};

type SourceReceiptLimitation =
  | {
      readonly code: "capture-failed" | "capture-interrupted";
      readonly stage: "adapter" | "session-manager" | "sandbox-wrapper" | "runner-clock" | "runner-diagnostic-sink" | "attempt-finalizer" | "run-teardown";
      readonly target: SourceRetentionTarget;
    }
  | {
      readonly code: "collection-cap-reached" | "unsupported-input";
      readonly target: SourceRetentionTarget;
      readonly omittedAtLeast: PositiveSafeInteger;
    }
  | {
      readonly code: "text-truncated" | "redacted" | "invalid-utf8-replaced" | "unsafe-control-stripped";
      readonly target: SourceRetentionTarget;
      readonly replacementOrOmittedCount: PositiveSafeInteger;
    };

type SourceRetentionTarget =
  | "turn"
  | "turn-item"
  | "usage-observation"
  | "turn-context"
  | "command"
  | "stdout"
  | "stderr"
  | "activity"
  | "diagnostic"
  | "diagnostic-cause"
  | "payload-byte"
  | "blob-byte";
```

capture authority 在边界开始工作后遇到失败、中断或 retention 上限时，保留 canonical safe prefix 并写
`partial`。`complete` 可以含零个 segment；它证明该 authority 已完整观察到空集合。authority 未开始、
不适用或旧格式从未保存该 source 时不写 Attachment，reader 对它返回 `not-recorded`。

schema、identity、canonical order、Seal manifest inventory 或 own blob closure 不合法时，reader 只把对应
source 返回为 `invalid`。一个 source 的 `partial`、`not-recorded` 或 `invalid` 不改变其它 source 的结果。
I/O、permission、关闭后的 Scope 与 interruption 仍是 typed Effect failure，不伪装成这三个数据状态。

capture authority 在 segment 开始时 mint 不可推导的 `segmentId`。它不能从 sequence、turn、command、text、
time、provider、path 或 blob key 计算。每个 family 只接受属于自身 authority 与 retention target 的 limitation；
无关 stage / target 组合使该 source `invalid`。

## Agent Turn receipts

Adapter 先解释自己的 tape、JSONL 或 SDK stream，再完成归一、脱敏与有界降级。它对每个物理
`t.send` 交付一个 provider-neutral terminal `Turn`。raw provider frame、原始请求体、hidden chain of thought、
secret 与任意 attribute 不进入 Record。

```ts
type AgentTurnsAttachment = SourceReceiptSet<AgentTurnReceipt, SourceReceiptLimitation>;

type AgentTurnReceipt = {
  readonly segmentId: SourceSegmentId;
  readonly turnId: TurnId;
  readonly sequence: PositiveSafeInteger;
  readonly outcome: "completed" | "failed" | "cancelled" | "interrupted";
  readonly terminal:
    | {
        readonly state: "recorded";
        readonly status: "completed" | "failed" | "waiting";
        readonly evidenceCoverage: Readonly<Record<EvidenceCoverageChannel, "complete" | "partial" | "unavailable">>;
      }
    | { readonly state: "unavailable"; readonly reason: "send-failed" | "send-interrupted" };
  readonly items: readonly AgentTurnItem[];
  readonly usage: readonly UsageObservation[];
};

type AgentTurnItem =
  | { readonly itemId: ItemId; readonly sequence: PositiveSafeInteger; readonly kind: "message"; readonly role: "user" | "assistant"; readonly text: SafeText }
  | { readonly itemId: ItemId; readonly sequence: PositiveSafeInteger; readonly kind: "tool-call"; readonly callId: CallId; readonly tool: SourceNativeToolName; readonly inputSummary: SafeText }
  | { readonly itemId: ItemId; readonly sequence: PositiveSafeInteger; readonly kind: "tool-result"; readonly callId: CallId; readonly outcome: "completed" | "rejected" | "failed" | "cancelled"; readonly outputSummary: SafeText }
  | { readonly itemId: ItemId; readonly sequence: PositiveSafeInteger; readonly kind: "thinking-summary" | "compaction" | "context-injection"; readonly summary: SafeText }
  | { readonly itemId: ItemId; readonly sequence: PositiveSafeInteger; readonly kind: "subagent"; readonly state: "started" | "completed" | "failed"; readonly label: SafeIdentifier; readonly summary: SafeText }
  | { readonly itemId: ItemId; readonly sequence: PositiveSafeInteger; readonly kind: "input-request"; readonly state: "requested" | "answered" | "cancelled"; readonly promptSummary: SafeText; readonly responseSummary: SafeText | null }
  | { readonly itemId: ItemId; readonly sequence: PositiveSafeInteger; readonly kind: "skill-load" | "conversation-error"; readonly code: SafeIdentifier; readonly summary: SafeText };

type UsageObservation =
  | { readonly usageObservationId: UsageObservationId; readonly kind: "token-bucket"; readonly provider: SafeIdentifier; readonly bucket: "input" | "output" | "cache-read" | "cache-write" | "reasoning" | "other"; readonly tokens: NonNegativeSafeInteger }
  | { readonly usageObservationId: UsageObservationId; readonly kind: "request"; readonly provider: SafeIdentifier; readonly requestKind: "model" | "tool" }
  | { readonly usageObservationId: UsageObservationId; readonly kind: "provider-cost"; readonly provider: SafeIdentifier; readonly amount: CanonicalDecimal; readonly currency: CurrencyCode };
```

`turnId` 在物理 `t.send` 开始时由 SessionManager mint，并随 Adapter input 传入；Adapter 不自行推导它。

Agent Turn 只保存 Adapter 返回的解释后 events、原生 status、按 Adapter 默认与 Turn 降级声明合并后的
evidence coverage，以及 usage。SessionManager 自己构造的 user event 不冒充 Adapter event。

send 在 terminal Turn 前失败或中断时保留 receipt 与明确的 `terminal.unavailable`，并把 source 标成
`partial`。turn 与 item 的 sequence 各自唯一且 canonical。tool result 只引用同一 Turn 中恰一个 tool call。
usage 保存 provider observation，不保存 Attempt aggregate、价格表、汇率、估算金额或推导出的 total。

## Turn Context receipts

SessionManager 对每个物理 `t.send` 保存当时已知的 source context。它与 Agent Turn 共用 `turnId`，不复制
conversation、usage 或 timing。

```ts
type TurnContextsAttachment = SourceReceiptSet<TurnContextReceipt, SourceReceiptLimitation>;

type TurnContextReceipt = {
  readonly segmentId: SourceSegmentId;
  readonly turnId: TurnId;
  readonly sequence: PositiveSafeInteger;
  readonly sessionIndex: PositiveSafeInteger;
  readonly turnIndex: PositiveSafeInteger;
  readonly sourceOrder: PositiveSafeInteger | null;
  readonly source:
    | { readonly state: "mapped"; readonly sourceItemId: SourceItemId; readonly sha256: Sha256Digest; readonly start: SourcePosition; readonly end: SourcePosition }
    | { readonly state: "unmapped"; readonly reason: "location-not-captured" | "source-snapshot-not-recorded" | "position-unrepresentable" };
};
```

`sessionIndex` 与 `turnIndex` 保存 SessionManager 当时知道的物理会话与轮次顺序；reader 不从 Adapter event 或
数组位置重建它们。mapped context 只通过 `sourceItemId` 与 `sha256` 连接 origin Run 的 `niceeval.sources` item，并校验有序坐标。
unmapped 是完整、显式的观察结果，不等于 `partial`。reader 不扫描当前 worktree、source blob、path、文本、
array order 或时间邻近度来补配 source。

## Sandbox Command receipts

Sandbox wrapper 在调用前登记 command identity 与 manifest，在结束边界登记唯一终态。进入 provider 后取消写
`terminated/cancelled`；本地 spawn 失败写 `not-started/spawn-failed`；transport 丢失保留已登记 manifest
和安全 stream prefix，并使 source 为 `partial`。

```ts
type SandboxCommandsAttachment = SourceReceiptSet<SandboxCommandReceipt, SourceReceiptLimitation>;

type SandboxCommandReceipt = {
  readonly segmentId: SourceSegmentId;
  readonly commandId: CommandId;
  readonly sequence: PositiveSafeInteger;
  readonly turnId: TurnId | null;
  readonly phase: StablePhase;
  readonly invocation:
    | { readonly kind: "argv"; readonly executable: SafeText; readonly arguments: readonly SafeText[] }
    | { readonly kind: "shell"; readonly command: SafeText };
  readonly workingDirectory:
    | { readonly kind: "sandbox-default" }
    | { readonly kind: "project-relative"; readonly path: CanonicalProjectRelativePath }
    | { readonly kind: "redacted" };
  readonly outcome:
    | { readonly kind: "exited"; readonly exitCode: number }
    | { readonly kind: "terminated"; readonly reason: "timeout" | "cancelled" | "transport-lost" }
    | { readonly kind: "not-started"; readonly reason: "spawn-failed" | "cancelled-before-start" };
  readonly stdout: CommandStream;
  readonly stderr: CommandStream;
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

collector 先执行非 fatal UTF-8 decode、已登记敏感值脱敏与 control removal，再按 stream 上限保留 prefix。
seal 和 reader 读取都对 retained bytes 重算长度和 digest。inline 与 blob 只是同一事实的物理存储选择。

seal 和 reader payload loading 都对实际 bytes 重算 byte length、digest 与 family budget；即使篡改后的
blob 长度不变也使 Attachment `invalid`。projector 统一两种 storage，因此 consumer 看不到物理差异。

Run 与 Attempt 各自使用 owner-monotonic clock。offset 的零点不含 epoch，不同 owner 的 offset 不能相减或拼接。
OTel 只能作为 Runner capture input；只有能证明 exact owner、同一 clock、稳定 phase、label 与 anchor 的输入
才能形成 activity。raw OTLP 不进入 Record。

```ts
type RunnerActivitiesAttachment<Phase> = SourceReceiptSet<RunnerActivityReceipt<Phase>, SourceReceiptLimitation>;

type RunnerActivityReceipt<Phase> = {
  readonly segmentId: SourceSegmentId;
  readonly activityId: ActivityId;
  readonly sequence: PositiveSafeInteger;
  readonly phase: Phase;
  readonly label: StableLabel;
  readonly turnId: TurnId | null;
  readonly startOffsetMs: NonNegativeSafeInteger;
  readonly durationMs: NonNegativeSafeInteger;
  readonly parentActivityId: ActivityId | null;
  readonly outcome: "completed" | "failed" | "cancelled" | "interrupted" | "unknown";
};
```

decoder 拒绝负数、不安全整数、重复 identity、缺失 parent、cycle、overflow 与 parent containment violation。
不能证明 parent containment 的可信 activity 保留为 root。`unknown` outcome 或无法归一的输入要求 source 为
`partial`，不能把 observed interval window 当作完整 Attempt duration 或 critical path。

## Runner Diagnostic receipts

Runner diagnostic sink 保存 advisory 与 execution error，但不改变 Verdict、Score 或 reuse。diagnostic 不保存
raw exception、stack、Cause、绝对路径、secret 或任意 object。

```ts
type RunnerDiagnosticsAttachment<Phase> = SourceReceiptSet<RunnerDiagnosticReceipt<Phase>, SourceReceiptLimitation>;

type RunnerDiagnosticReceipt<Phase> = {
  readonly segmentId: SourceSegmentId;
  readonly diagnosticId: DiagnosticId;
  readonly sequence: PositiveSafeInteger;
  readonly kind: "advisory" | "execution-error";
  readonly code: SafeIdentifier;
  readonly phase: Phase;
  readonly turnId: TurnId | null;
  readonly summary: SafeText;
  readonly causes: readonly { readonly code: SafeIdentifier; readonly summary: SafeText }[];
  readonly redaction:
    | { readonly state: "none" }
    | { readonly state: "applied"; readonly replacements: PositiveSafeInteger };
  readonly sourceFrame:
    | { readonly sourceItemId: SourceItemId; readonly sha256: Sha256Digest; readonly start: SourcePosition; readonly end: SourcePosition }
    | null;
};
```

`sourceFrame` 只连接 origin Run 的 immutable Sources item，不携带 blob ref，也不授予跨 owner storage
capability。Run diagnostic `sandbox-build-failed` 可以保存 Attempt 创建前的共享构建失败；它仍属于 Run-owned
Runner Diagnostic source，不成为新的 family。

## Capture、staging 与 Seal manifest

每个 authority 在真实边界完成 decode、normalize、redact、limit 与 canonical encode，然后把 immutable segment
追加到 owner-private staging。staging 是 local operation state，不是 Record fact。ordinary reader、Analysis、
Report 与第三方 producer 都不能读取它。

Attempt 或 Run seal 冻结对应 authority，拒绝 late append，并逐 source 验证 payload 与 own blobs。Run publisher
随后形成 canonical Seal manifest。manifest 对每个已持久化 source 列出 owner、family、schemaVersion、payload
identity、ordered segment identity，以及每份 own blob 的 byte length 与 digest；未持久化的 source 不列入。

```ts
type SourceReceiptManifestEntry = {
  readonly owner: { readonly kind: "run" } | { readonly kind: "attempt"; readonly attemptId: AttemptId };
  readonly family: ObservabilitySourceFamily;
  readonly schemaVersion: PositiveSafeInteger;
  readonly payload: { readonly byteLength: NonNegativeSafeInteger; readonly sha256: Sha256Digest };
  readonly segments: readonly { readonly sequence: PositiveSafeInteger; readonly segmentId: SourceSegmentId }[];
  readonly blobs: readonly { readonly key: RecordBlobKey; readonly byteLength: NonNegativeSafeInteger; readonly sha256: Sha256Digest }[];
};
```

Seal manifest 同时 inventory Core、非 Observability Attachment 与它们的 payload / blob closure。它是 Run
发布证明，不是 cache index、latest pointer 或 optional attachment list。manifest 声明而缺失、重复或多出的
segment / blob 只使对应 source `invalid`；manifest 自身、Core identity 或 publication identity 无法验证时，
整份 Run 不能形成可读事实。

publisher 把 Core、manifest、declared payload、own blobs 与 `complete` 全部写入同一个 sealed staging Run，
逐文件和目录同步后，再以同文件系统 no-replace directory rename 发布。`complete` 与 Seal manifest 因而在
同一个原子目录发布中出现；任何 reader 都不能观察到只有其中一个已经发布的 current Run。

恢复材料位于 portable Record 之外的 local sidecar。它绑定 canonical staging / destination、`recordId`、
`runId`、Seal manifest digest 和完整 Core / payload / blob inventory。崩溃恢复只允许验证 sealed staging 后重试
同一 no-replace publish，或验证 destination 与 manifest 完全一致后收尾。destination 冲突、两端同时存在、
inventory 漂移或 identity 不一致都 fail closed；恢复不能重跑 Adapter、Sandbox 或 Runner，也不能拼装部分事实。

publish 不改写现有 portable bytes，不替换已有 Run directory，也不碰 Git index。一个新 Run 要么以完整 inventory
出现，要么只留在 Git 排除的 local staging。whole-Record copy 或 Git 操作只在 writer 与 recovery 停稳后进行，
并把 Seal manifest、全部 payload 与全部 blob 作为同一 portable inventory 对待。

## Reader-side views 与 relation

| reader-side view | source dependencies |
|---|---|
| conversation | `niceeval.agent-turns` + `niceeval.turn-contexts` |
| usage | `niceeval.agent-turns` |
| commands | `niceeval.sandbox-commands` |
| timing | `niceeval.runner-activities` |
| diagnostics | `niceeval.runner-diagnostics` |

每个 joined view 必须声明全部 dependency，并逐 source 保留 `complete`、`partial`、`not-recorded` 或 `invalid`。
projector 不能把一个 source 的 complete-empty 当成另一个 source 的缺失，也不能用较完整的 source 替代损坏 source。
total token、cache ratio、成本换算、duration coverage 与 diagnostic grouping 属于 Analysis Calculation。

source navigation 是 `turn-contexts`、`runner-activities` 与 origin Run `niceeval.sources` 之间的 Fact relation。
它以 `turnId`、`sourceItemId` 与 `sha256` 等 durable anchor 连接事实，不是 durable family。relation 不根据数组
顺序、文本、path、clock proximity 或当前源码猜测 join。

## Legacy aggregate 与格式演进

旧 `niceeval.observability` aggregate 没有可信的 Adapter、Sandbox 或 Runner provenance。converter 无法判断
同一 aggregate field 来自哪个 capture authority，也无法证明遗漏是否发生。因此 source-first layout 使用新的
Record format identity 与 Core Seal manifest，不提供 Observability adjacent migration。

当前 beta cutover 不打开 legacy `niceeval.record`。ordinary read 与 maintenance 都明确返回
`unsupported-format`；用户必须使用写出该格式的 NiceEval 版本读取。current reader 因而不会从 aggregate
字段反推 source receipt、capture authority 或 source-navigation relation。current writer 只写 source-first
format，不双写 legacy aggregate。
