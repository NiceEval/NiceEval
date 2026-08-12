# Observability RecordAttachment

本页定义官方 Observability Attachment 的唯一 durable schema。领域入口见
[Observability](../../../observability.md)。Record Core、blob closure、完成标识与通用 migration
规则仍由 [Record 架构](../architecture.md) 定义。

每个 payload 都是 exact JSON。未列出的字段不存在。所有 array 都按本页规定的 canonical order
编码，并拒绝重复 identity。所有 byte 上限按 UTF-8 encoded byte length 计，而不是 JavaScript
string length。

## owner 与固定 family

schema identity 的 name 是 slash 前的部分。Record envelope 分别保存 name 与 schemaId。

| owner | name | schemaId | payload |
|---|---|---|---|
| Attempt | niceeval.conversation | niceeval.conversation/v1 | ConversationAttachmentV1 |
| Attempt | niceeval.commands | niceeval.commands/v1 | CommandsAttachmentV1 |
| Attempt | niceeval.usage | niceeval.usage/v1 | UsageAttachmentV1 |
| Attempt | niceeval.timing | niceeval.timing/v1 | AttemptTimingAttachmentV1 |
| Attempt | niceeval.diagnostics | niceeval.diagnostics/v1 | AttemptDiagnosticsAttachmentV1 |
| Run | niceeval.timing | niceeval.timing/v1 | RunTimingAttachmentV1 |
| Run | niceeval.diagnostics | niceeval.diagnostics/v1 | RunDiagnosticsAttachmentV1 |

一个实际执行的 Attempt 必须拥有表中的全部五个 Attempt family。一个 Run 必须拥有表中的两个
Run family。reference Member 没有新的 physical Attempt，因此不再写第二份 Attachment。

## 共同模型

### Scalar、文本与上限

| value | exact validation |
|---|---|
| NonNegativeSafeInteger | JSON number、整数、0 至 9,007,199,254,740,991 |
| PositiveSafeInteger | JSON number、整数、1 至 9,007,199,254,740,991 |
| SafeIdentifier | lowercase ASCII，匹配 [a-z][a-z0-9.-]{0,63} |
| StableLabel | lowercase ASCII，匹配 [a-z][a-z0-9.-]{0,63}；不是 provider 名称 |
| SafeText | 已脱敏的 UTF-8 text；不得含 NUL 或 C0 control，换行除外 |
| CanonicalDecimal | 非负 decimal string，匹配 (0\|[1-9][0-9]*)(\.[0-9]*[1-9])?，最长 64 bytes |
| CurrencyCode | uppercase ASCII，匹配 [A-Z]{3} |

SafeText 的具体最大值由使用它的字段声明。输出展示可以进一步裁剪，却不能回写 payload。任何
原始 Error、stack、Cause、绝对 path、secret、native bytes、函数、symbol 或任意 JSON object
都不能作为 SafeText 的替代品。

每个 family 的 payload、item 和 blob closure 都有独立上限：

| family | payload max bytes | item cap | closure max bytes |
|---|---:|---:|---:|
| conversation | 2,097,152 | 2,048 items，256 turns | 0 |
| commands | 2,097,152 | 256 commands | 33,554,432 |
| usage | 1,048,576 | 2,048 observations | 0 |
| timing | 1,048,576 | 4,096 intervals | 0 |
| diagnostics | 524,288 | 512 diagnostics | 0 |

item cap 触发后 collector 停止保留同类新项，并在 collection 中写 collection-cap-reached。
payload 或 closure 达到上限时也使用同一 limitation。它们不会静默丢失数据，也不会把已经保留的
安全项改成 invalid。

### producer-minted identity

所有实体 identity 由 producer 使用 128-bit entropy mint。编码是对应 lowercase prefix 加 26 个
lowercase Crockford base32 字符。编码排除 i、l、o 与 u。

| entity | prefix |
|---|---|
| turn | turn_ |
| item | item_ |
| call | call_ |
| command | command_ |
| usage observation | usage_ |
| interval | interval_ |
| diagnostic | diagnostic_ |

identity 的唯一范围是所属 Attachment family 与 entity kind。producer 不得从数组下标、文本、时间、
provider id、路径或目录名称导出它。array order 只服务呈现或 canonical encoding，不承担 identity。

```ts
type TurnIdV1 = string;
type ItemIdV1 = string;
type CallIdV1 = string;
type CommandIdV1 = string;
type UsageObservationIdV1 = string;
type IntervalIdV1 = string;
type DiagnosticIdV1 = string;

type NonEmptyReadonlyArray<Item> = readonly [Item, ...Item[]];

type CollectionV1<Limitation extends ObservabilityLimitationV1> =
  | {
      readonly state: "complete";
      readonly limitations: readonly [];
    }
  | {
      readonly state: "partial";
      readonly limitations: NonEmptyReadonlyArray<Limitation>;
    };
```

### collection limitation

limitation 是 closed union。payload 的 limitations 以 code、target、entity identity 的顺序排序，
并把同种原因合并计数。partial 至少有一项；complete 必须恰为零项。

```ts
type CollectionTargetV1 =
  | "conversation-item"
  | "conversation-text"
  | "command-manifest"
  | "command-stdout"
  | "command-stderr"
  | "usage-observation"
  | "timing-interval"
  | "diagnostic";

type CollectionStageV1 =
  | "adapter"
  | "command-capture"
  | "usage-capture"
  | "timing-capture"
  | "diagnostic-capture"
  | "attempt-finalizer"
  | "run-teardown";

type ObservabilityLimitationV1 =
  | {
      readonly code: "capture-failed";
      readonly stage: CollectionStageV1;
      readonly target: CollectionTargetV1;
    }
  | {
      readonly code: "capture-interrupted";
      readonly stage: CollectionStageV1;
      readonly target: CollectionTargetV1;
    }
  | {
      readonly code: "collection-cap-reached";
      readonly target: CollectionTargetV1;
      readonly retained: NonNegativeSafeInteger;
      readonly omittedAtLeast: PositiveSafeInteger;
    }
  | {
      readonly code: "unsupported-input";
      readonly target: CollectionTargetV1;
      readonly omittedAtLeast: PositiveSafeInteger;
    }
  | {
      readonly code: "text-truncated";
      readonly target: "conversation-text";
      readonly itemId: ItemIdV1;
      readonly retainedBytes: NonNegativeSafeInteger;
      readonly omittedBytes: PositiveSafeInteger;
    }
  | {
      readonly code: "text-truncated";
      readonly target: "command-manifest";
      readonly commandId: CommandIdV1;
      readonly retainedBytes: NonNegativeSafeInteger;
      readonly omittedBytes: PositiveSafeInteger;
    }
  | {
      readonly code: "text-truncated";
      readonly target: "diagnostic";
      readonly diagnosticId: DiagnosticIdV1;
      readonly retainedBytes: NonNegativeSafeInteger;
      readonly omittedBytes: PositiveSafeInteger;
    }
  | {
      readonly code: "stream-truncated";
      readonly commandId: CommandIdV1;
      readonly stream: "stdout" | "stderr";
      readonly retainedBytes: NonNegativeSafeInteger;
      readonly omittedBytes: PositiveSafeInteger;
    }
  | {
      readonly code: "invalid-utf8-replaced";
      readonly commandId: CommandIdV1;
      readonly stream: "stdout" | "stderr";
      readonly replacementCount: PositiveSafeInteger;
    }
  | {
      readonly code: "unsafe-control-stripped";
      readonly commandId: CommandIdV1;
      readonly stream: "stdout" | "stderr";
      readonly strippedCount: PositiveSafeInteger;
    }
  | {
      readonly code: "redacted";
      readonly target: CollectionTargetV1;
      readonly replacementCount: PositiveSafeInteger;
    };
```

capture-failed 与 capture-interrupted 只说明哪个稳定 capture stage 没能形成完整观察。它们不带
原始异常文字。unknown provider event、无法安全归一的输入与被上限拒收的新项分别使用
unsupported-input、text-truncated 或 collection-cap-reached。

### 可选跨 family reference

cross-family ref 没有 owner id、RunId、path 或 blob ref。它只能在当前 Record owner 下指向一个
已封口的 entity。refs array 最多 16 项，按 family、kind、id 排序且三元组唯一。

```ts
type AttemptReferenceTargetV1 =
  | {
      readonly family: "niceeval.conversation/v1";
      readonly kind: "turn" | "item" | "call";
      readonly id: TurnIdV1 | ItemIdV1 | CallIdV1;
    }
  | {
      readonly family: "niceeval.commands/v1";
      readonly kind: "command";
      readonly id: CommandIdV1;
    }
  | {
      readonly family: "niceeval.usage/v1";
      readonly kind: "usage-observation";
      readonly id: UsageObservationIdV1;
    }
  | {
      readonly family: "niceeval.timing/v1";
      readonly kind: "interval";
      readonly id: IntervalIdV1;
    }
  | {
      readonly family: "niceeval.diagnostics/v1";
      readonly kind: "diagnostic";
      readonly id: DiagnosticIdV1;
    };

type RunReferenceTargetV1 =
  | {
      readonly family: "niceeval.timing/v1";
      readonly kind: "interval";
      readonly id: IntervalIdV1;
    }
  | {
      readonly family: "niceeval.diagnostics/v1";
      readonly kind: "diagnostic";
      readonly id: DiagnosticIdV1;
    };

type ConversationReferencesV1 = Exclude<
  AttemptReferenceTargetV1,
  { readonly family: "niceeval.conversation/v1" }
>;

type CommandsReferencesV1 = Exclude<
  AttemptReferenceTargetV1,
  { readonly family: "niceeval.commands/v1" }
>;

type UsageReferencesV1 = Exclude<
  AttemptReferenceTargetV1,
  { readonly family: "niceeval.usage/v1" }
>;

type AttemptTimingReferencesV1 = Exclude<
  AttemptReferenceTargetV1,
  { readonly family: "niceeval.timing/v1" }
>;

type AttemptDiagnosticsReferencesV1 = Exclude<
  AttemptReferenceTargetV1,
  { readonly family: "niceeval.diagnostics/v1" }
>;

type RunTimingReferencesV1 = Exclude<
  RunReferenceTargetV1,
  { readonly family: "niceeval.timing/v1" }
>;

type RunDiagnosticsReferencesV1 = Exclude<
  RunReferenceTargetV1,
  { readonly family: "niceeval.diagnostics/v1" }
>;
```

ObservabilityRecordContractV1 在 seal 前验证每个 ref 的 target 已存在、恰有一个、family 正确且
kind 匹配。它不要求 target 反向引用 source。

单 family reader 不因 cross-family target 读取不到而让自己 invalid。需要两份 family 的组合
projector 或 Calculation 才把 dangling relation 变为 partial。官方新 Run 在联合验证后没有这种
dangling ref；历史、第三方或不可迁移数据仍可能产生它。

## conversation

conversation 只保存 provider-neutral、用户可见的内容。items 按 sequence 升序、itemId 升序编码。
sequence 是呈现顺序，不是 identity。turns 按 turnId 排序。

```ts
type ConversationAttachmentV1 = {
  readonly collection: CollectionV1<ObservabilityLimitationV1>;
  readonly turns: readonly ConversationTurnV1[];
  readonly items: readonly ConversationItemV1[];
};

type ConversationTurnV1 = {
  readonly turnId: TurnIdV1;
  readonly sequence: PositiveSafeInteger;
  readonly outcome: "completed" | "failed" | "cancelled" | "interrupted";
  readonly refs: readonly ConversationReferencesV1[];
};

type ConversationItemBaseV1 = {
  readonly itemId: ItemIdV1;
  readonly turnId: TurnIdV1;
  readonly sequence: PositiveSafeInteger;
  readonly refs: readonly ConversationReferencesV1[];
};

type ConversationItemV1 =
  | (ConversationItemBaseV1 & {
      readonly kind: "message";
      readonly role: "user" | "assistant";
      readonly text: string;
    })
  | (ConversationItemBaseV1 & {
      readonly kind: "tool-call";
      readonly callId: CallIdV1;
      readonly tool: string;
      readonly inputSummary: string;
    })
  | (ConversationItemBaseV1 & {
      readonly kind: "tool-result";
      readonly callId: CallIdV1;
      readonly outcome: "completed" | "rejected" | "failed" | "cancelled";
      readonly outputSummary: string;
    })
  | (ConversationItemBaseV1 & {
      readonly kind: "thinking-summary";
      readonly summary: string;
    })
  | (ConversationItemBaseV1 & {
      readonly kind: "subagent";
      readonly state: "started" | "completed" | "failed";
      readonly label: string;
      readonly summary: string;
    })
  | (ConversationItemBaseV1 & {
      readonly kind: "input-request";
      readonly state: "requested" | "answered" | "cancelled";
      readonly promptSummary: string;
      readonly responseSummary: string | null;
    })
  | (ConversationItemBaseV1 & {
      readonly kind: "skill-load";
      readonly skill: string;
      readonly outcome: "loaded" | "failed";
    })
  | (ConversationItemBaseV1 & {
      readonly kind: "context-injection";
      readonly source: "system" | "memory" | "skill" | "user";
      readonly summary: string;
    })
  | (ConversationItemBaseV1 & {
      readonly kind: "compaction";
      readonly summary: string;
      readonly compactedItemCount: NonNegativeSafeInteger;
    })
  | (ConversationItemBaseV1 & {
      readonly kind: "conversation-error";
      readonly code: string;
      readonly summary: string;
    });
```

turn sequence 必须唯一。item sequence 必须唯一，且 item 指向已有 turn。tool 字段、skill、label 与
code 都是 SafeIdentifier。message text、inputSummary、outputSummary 与 summary 最多 16,384 bytes。
responseSummary 为 null 只表示还没有安全可保存的回答；对应 collection 必须 partial。

tool-call 的 callId 在 conversation 内唯一。tool-result 必须指向一个已有 tool-call，且每个 call
最多一个 result。complete collection 中每个 tool-call 恰有一个 result。pending、无法归一或不可安全
显示的 provider 输入不原样写入，只以 limitation 表示。

thinking-summary 只接受 provider 或 producer 已生成的面向用户摘要。它不能包含 hidden chain of
thought、推理 token、raw reasoning frame 或提示词全文。

## commands

command 是一次已登记 manifest 与一个终态 result。producer 必须在调用外部命令前获得 commandId，
并在外部调用结束后为同一个 identity 写 result。一个 commandId 恰有一份 manifest 与一份 result。
commands 按 commandId 排序。

seal 时任何已登记但无法取得真实终态的 command 都写 terminated/transport-lost result，并增加
capture-failed 或 capture-interrupted limitation。它不能只留下 manifest，也不能因缺 result 省略
整份 commands Attachment。

确知本 Attempt 没有任何 Sandbox command 时，commands 必须写 collection 为 complete、limitations
为空且 commands 为空 array。它不是 unavailable。

```ts
type CommandsAttachmentV1 = {
  readonly collection: CollectionV1<ObservabilityLimitationV1>;
  readonly commands: readonly CommandObservationV1[];
};

type CommandObservationV1 = {
  readonly commandId: CommandIdV1;
  readonly manifest: CommandManifestV1;
  readonly result: CommandResultV1;
  readonly refs: readonly CommandsReferencesV1[];
};

type CommandManifestV1 = {
  readonly phase:
    | "attempt.setup"
    | "sandbox.prepare"
    | "agent.ensure"
    | "eval.run"
    | "sandbox.command"
    | "attempt.teardown";
  readonly invocation:
    | {
        readonly kind: "argv";
        readonly executable: string;
        readonly arguments: readonly string[];
      }
    | {
        readonly kind: "shell";
        readonly command: string;
      };
  readonly workingDirectory:
    | { readonly kind: "sandbox-default" }
    | { readonly kind: "project-relative"; readonly path: string }
    | { readonly kind: "redacted" };
};

type CommandResultV1 = {
  readonly outcome:
    | {
        readonly kind: "exited";
        readonly exitCode: number;
      }
    | {
        readonly kind: "terminated";
        readonly reason: "timeout" | "cancelled" | "transport-lost";
      }
    | {
        readonly kind: "not-started";
        readonly reason: "spawn-failed" | "cancelled-before-start";
      };
  readonly stdout: CommandStreamV1;
  readonly stderr: CommandStreamV1;
};

type CommandStreamV1 = {
  readonly storage:
    | {
        readonly kind: "inline";
        readonly text: string;
      }
    | {
        readonly kind: "blob";
        readonly ref: RecordBlobRef;
      };
  readonly retainedBytes: NonNegativeSafeInteger;
  readonly totalSafeUtf8Bytes: NonNegativeSafeInteger;
};
```

argv executable、每个 argument 与 shell command 都是脱敏 SafeText。executable、shell command 最多
2,048 bytes；argv 最多 64 个 argument，每个最多 1,024 bytes。project-relative path 使用 / 分隔，
不以 / 开头、不含空、. 或 .. segment，最多 512 bytes。sandbox 外或无法安全表示的 cwd 必须写
redacted，而不能写绝对 path。

exitCode 是 -2,147,483,648 至 2,147,483,647 的整数。result 不保存 raw spawn error、signal 原文、
stack 或自由 diagnostics；需要解释的内容属于 diagnostics family。

collector 以此顺序处理每条流：非 fatal UTF-8 decode、已登记敏感值脱敏、移除 ANSI escape 与除
换行外的 C0 control、UTF-8 encode、逐流截断。遇到无效 UTF-8 replacement 时写
invalid-utf8-replaced；移除 control 时写 unsafe-control-stripped。脱敏与安全字符处理都发生在
截断之前。

retainedBytes 是 storage 中 exact UTF-8 byte length。totalSafeUtf8Bytes 是脱敏、替换后的完整流长度。
它不超过 retainedBytes 时，storage 必须 inline 且两者相等。超过 retainedBytes 时，collection 必须有
同 commandId、stream 的 stream-truncated limitation。retainedBytes 最高 65,536；inline 只允许
不超过 4,096，超过该值必须使用本 Attachment 自己 closure 的 blob。

commands definition 的 blobRefs 只枚举 stdout 与 stderr 的 blob ref。每个 ref 只出现一次。projector
验证 blob 的 UTF-8 与 retainedBytes 后返回同一份 text view，因此 consumer 无法观察 inline/blob
差异。

## usage

usage 不存 Attempt aggregate。每一项是一个不可再拆的 observed value。observations 按
usageObservationId 排序。

```ts
type UsageAttachmentV1 = {
  readonly collection: CollectionV1<ObservabilityLimitationV1>;
  readonly observations: readonly UsageObservationV1[];
};

type UsageObservationBaseV1 = {
  readonly usageObservationId: UsageObservationIdV1;
  readonly provider: string;
  readonly refs: readonly UsageReferencesV1[];
};

type UsageObservationV1 =
  | (UsageObservationBaseV1 & {
      readonly kind: "token-bucket";
      readonly bucket:
        | "input"
        | "output"
        | "cache-read"
        | "cache-write"
        | "reasoning"
        | "other";
      readonly tokens: NonNegativeSafeInteger;
    })
  | (UsageObservationBaseV1 & {
      readonly kind: "request";
      readonly requestKind: "model" | "tool";
    })
  | (UsageObservationBaseV1 & {
      readonly kind: "provider-cost";
      readonly amount: string;
      readonly currency: string;
    });
```

provider 是 SafeIdentifier。amount 是 CanonicalDecimal，currency 是 CurrencyCode。每个 request
observation 正好代表一个 observed request，不能用 count 字段保存 batch total。token bucket 只表达
该 provider 当时报告或已在 Adapter 边界规范化的一个桶。

payload 不包含 totals、cache ratio、价格表、模型价格、estimated cost、汇率或跨币种数值。它们全部
属于后续 Calculation。没有 provider-observed cost 时，producer 不制造 amount 为零的 observation。

## timing

Run 和 Attempt 各自拥有从 owner 生命周期起点计时的 monotonic clock。offset 的 0 不写 epoch，
也不能跨 owner 比较。intervals 按 intervalId 排序。

```ts
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

type TimingIntervalV1<Phase, Reference> = {
  readonly intervalId: IntervalIdV1;
  readonly phase: Phase;
  readonly label: string;
  readonly startOffsetMs: NonNegativeSafeInteger;
  readonly durationMs: NonNegativeSafeInteger;
  readonly parentIntervalId: IntervalIdV1 | null;
  readonly outcome:
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted"
    | "unknown";
  readonly refs: readonly Reference[];
};

type AttemptTimingAttachmentV1 = {
  readonly collection: CollectionV1<ObservabilityLimitationV1>;
  readonly intervals: readonly TimingIntervalV1<
    AttemptTimingPhaseV1,
    AttemptTimingReferencesV1
  >[];
};

type RunTimingAttachmentV1 = {
  readonly collection: CollectionV1<ObservabilityLimitationV1>;
  readonly intervals: readonly TimingIntervalV1<
    RunTimingPhaseV1,
    RunTimingReferencesV1
  >[];
};
```

label 是 StableLabel。它描述同一 stable phase 内的中立细分，例如 turn 或 command，不含 provider
名字、raw span 名、raw OTLP attribute 或 command text。outcome 为 unknown 时 collection 必须 partial。

decoder 拒绝负数、非安全整数、重复 intervalId、缺失 parent 与 parent cycle。parent 只能指向当前
owner 的 timing Attachment。parent 的开始不得晚于 child，且 child 结束不得晚于 parent 结束。
它不从目录 mtime、终端文本、raw OTLP 或任意 epoch 猜测 interval。

## diagnostics

diagnostics 按 diagnosticId 排序。每一项要么是 advisory，要么是 execution-error。两者分开呈现，
但都不会自行改变 Verdict、Score 或 Eligibility。

```ts
type AttemptDiagnosticPhaseV1 =
  | "attempt.setup"
  | "sandbox.prepare"
  | "agent.ensure"
  | "eval.run"
  | "agent.send"
  | "sandbox.command"
  | "assertion.evaluate"
  | "verdict.fold"
  | "attempt.teardown"
  | "collection";

type RunDiagnosticPhaseV1 =
  | "run.setup"
  | "run.discovery"
  | "run.plan"
  | "run.dispatch"
  | "run.teardown"
  | "collection";

type DiagnosticAttachmentV1<Phase, Reference> = {
  readonly collection: CollectionV1<ObservabilityLimitationV1>;
  readonly diagnostics: readonly DiagnosticV1<Phase, Reference>[];
};

type DiagnosticV1<Phase, Reference> = {
  readonly diagnosticId: DiagnosticIdV1;
  readonly kind: "advisory" | "execution-error";
  readonly code: string;
  readonly phase: Phase;
  readonly summary: string;
  readonly causes: readonly SafeDiagnosticCauseV1[];
  readonly context: readonly DiagnosticContextV1<Reference>[];
  readonly redaction: DiagnosticRedactionV1;
  readonly sourceFrame: SourceFrameV1 | null;
  readonly refs: readonly Reference[];
};

type SafeDiagnosticCauseV1 = {
  readonly code: string;
  readonly summary: string;
};

type DiagnosticRedactionV1 =
  | { readonly state: "none" }
  | {
      readonly state: "applied";
      readonly summaryReplacements: NonNegativeSafeInteger;
      readonly causeReplacements: NonNegativeSafeInteger;
      readonly contextReplacements: NonNegativeSafeInteger;
    };

type DiagnosticContextV1<Reference> =
  | {
      readonly kind: "entity";
      readonly target: Reference;
    }
  | {
      readonly kind: "limit";
      readonly limit:
        | "conversation-items"
        | "commands"
        | "usage-observations"
        | "timing-intervals"
        | "diagnostics"
        | "command-stream-bytes";
      readonly maximum: NonNegativeSafeInteger;
      readonly observedAtLeast: NonNegativeSafeInteger;
    }
  | {
      readonly kind: "provider";
      readonly provider: string;
    };

type SourceFrameV1 = {
  readonly sourceItemId: SourceItemId;
  readonly sha256: Sha256Digest;
  readonly start: SourcePositionV1;
  readonly end: SourcePositionV1;
};

type SourcePositionV1 = {
  readonly line: PositiveSafeInteger;
  readonly column: PositiveSafeInteger;
};

type AttemptDiagnosticsAttachmentV1 = DiagnosticAttachmentV1<
  AttemptDiagnosticPhaseV1,
  AttemptDiagnosticsReferencesV1
>;

type RunDiagnosticsAttachmentV1 = DiagnosticAttachmentV1<
  RunDiagnosticPhaseV1,
  RunDiagnosticsReferencesV1
>;
```

diagnostic code 和 cause code 是 SafeIdentifier。summary 最多 1,024 bytes；一个 cause summary 最多
512 bytes；cause chain 最多 8 项；context 最多 16 项。provider context 使用 SafeIdentifier。
redaction 永远存在，且 applied 的三个计数至少一个为正数。

context 是 closed union，不接受扩展 object 或 raw error data。collector 必须把原始 throw、错误消息、
stack、Cause 和路径映射为公开 code 与安全 summary，或只写 capture-failed limitation。

sourceFrame 不包含 path、源码文本或 blob ref。

Run diagnostic 的 frame 必须匹配同一 Run 的 immutable Sources Attachment。Attempt diagnostic 的 frame
必须匹配其 exact origin Run 的 immutable Sources Attachment。

sourceFrame 是 SourceItem 定位值，不是通用 cross-family ref。它沿既有 origin relation 验证
immutable SourceItem 的 identity、digest 与范围。

start 不得晚于 end。两端都必须落在该 SourceItem 已验证 UTF-8/LF text 的 line 与 column 范围内。
line 与 column 都从 1 开始计数。

这一既有 origin relation 不授予 diagnostics 对 Sources blob 的 capability。组合 source view 在 Sources
缺失、unsupported、invalid 或 digest 不匹配时 partial；diagnostics family 本身仍可用。

## seal、联合验证与失败

### 收集和冻结顺序

1. Attempt collector 在实际工作期间收集五类 observation。
2. Attempt 的全部 finalizer 停稳后，collector 停止接收新项并冻结五份 Attempt payload。
3. Run teardown 停稳后，Run collector 停止接收新项并冻结 timing 与 diagnostics。
4. ObservabilityRecordContractV1 联合验证所有冻结 payload。
5. coordinator 把已验证的 typed Attachment write 交给 generic Record writer。
6. 所有领域 contract 与通用写入成功后，RecordRunDraft.publish 创建 complete marker。

第 4 步失败或其后的任一普通写入失败都不创建 complete marker。collector 与 contract 不删除
incomplete directory。

### ObservabilityRecordContractV1

contract 必须在 generic writer 开始任何 official observability write 前检查：

- 每个实际 Attempt 恰有五份 family，Run 恰有两份 family；
- owner、name、schemaId 和 definition 都等于本页表格；
- collection 与 limitations 符合共同模型；
- entity identity、array order、每个 family 的上限和 local relation 合法；
- command manifest 在对应 result 之前已登记，且 stdout/stderr closure 完整；
- usage 没有 aggregate 或价格表字段；
- timing parent tree 合法；
- diagnostics 的 cause、context、redaction 与 SourceItem frame 合法；
- 每个 direct cross-family ref 在同一 owner 下存在、唯一且 type 匹配。

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

这些 error 只含稳定 code 与有界 identity。raw producer exception、payload、path、secret 与 stack
不进入 typed error。

capture 发生采集不足时，应尽可能留下已经验证的安全 observation 和 partial limitation。不能构成
安全 exact payload 时，capture 返回 ObservabilityCaptureError。联合验证失败返回
ObservabilityRecordContractError。generic writer 的 I/O、closure、owner 与 Core 错误仍保持
RecordWriteError，不能被 contract 吞掉。

## neutral projector 与 Calculation

每个 owner-specific family 有一个公开 neutral projector：

| projector | family |
|---|---|
| attemptConversationProjectorV1 | Attempt conversation |
| attemptCommandsProjectorV1 | Attempt commands |
| attemptUsageProjectorV1 | Attempt usage |
| attemptTimingProjectorV1 | Attempt timing |
| attemptDiagnosticsProjectorV1 | Attempt diagnostics |
| runTimingProjectorV1 | Run timing |
| runDiagnosticsProjectorV1 | Run diagnostics |

每个 projector 只解释一份 available Attachment。它不选择 Run、读取另一份 family、重建 denominator、
聚合或重新判定结果。commands projector 唯一负责把 inline/blob storage 统一为相同的 text view。

计数、observed／denominator、command success、duration、critical path、diagnostic grouping 和跨
family join 都属于 Calculation。Calculation 必须声明每份 projection 和 completeness policy。它不能用
一个 attachment 的 transport coverage 或物理 entry 数推导逻辑 Sample denominator。

官方 Report 与第三方 Report 都只能通过最终选定的公共 Record-to-Report 数据面使用这些 public
projector。official status 不授予额外 reader、legacy event 文件、private evidence 或 raw provider
input。

## current v1 与 migration

每个 owner-specific family 独立拥有相邻 migration。conversation、commands、usage、Attempt timing、
Run timing、Attempt diagnostics 与 Run diagnostics 分别登记自己的 vN 到 vN+1 edge。

payload、blob closure、entity identity 或 durable ref 的语义变化时发布新的相邻 schema。

普通 open 不自动 migrate，也不提供 compat reader。已知旧 schema 由 RecordAttachmentRead 说明
migration-required 或 migration-unavailable；用户显式运行 niceeval migrate 后才执行完整链。

单 family migration 不得靠另一个 owner、raw legacy file、当前 worktree 或 provider 补值。不能无损
保持某个 ref 时，converter 必须声明不可迁移或让组合读取 partial；不能把它伪造成有效 target。

## 实现依赖

实现必须按下面的依赖顺序组织，而不是另建计划文档：

1. 先串行完成共同模型、limit、identity、collection、limitation、ref 与 contract validator。
2. 共同模型稳定后，conversation、commands、usage、timing、diagnostics 五个 family 目录可并行实现。
   Run timing 与 Run diagnostics 属于后两个目录。
3. 五个 durable family 都可用后，采集接入函数可并行接入 Adapter、Sandbox 与 Runner 边界。
4. shared runner integration 在采集接入函数都能 seal 后串行完成，并在 publish 前调用联合 validator。
5. legacy cleanup 最后串行完成。它只删除旧读取与写入路径，不为旧文件建立 fallback。

## 相关阅读

- [Observability](../../../observability.md) —— 领域边界、运行反馈与 Report 规则。
- [Record Attachment 与 closure](../architecture.md#recordattachment-与完整-blob-closure)
  —— 通用 envelope、blob 与读取状态。
- [Record Library](../library.md) —— Effect-native capture 与 contract API。
- [Projection](../../projection/README.md) —— owner-local projector 怎样进入 Sample。
- [Record-to-Report DX](../../../design/record-to-report-dx/README.md) —— 候选数据面比较，
  不构成当前契约。
