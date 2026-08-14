# Record 架构

Record 是可携带的已封口运行事实。它冻结 identity（身份）、owner（归属者）、精确引用、固定
Attachment family 和发布边界。Experiment 的调度、execution claim（执行占用）、Analysis 的分母和
Report 的页面都在 Record 之外。

外部消费者把 `<project>/.niceeval/record/` 当作 opaque directory（不透明目录），通过 CLI 与上层数据面
观察它。目录、JSON、blob、reader 和 writer 是 NiceEval 内部持久协议，不是第三方 producer 或 consumer
的扩展格式。

## 两个物理边界

| 边界 | 内容 | 是否可复制、纳入 Git |
|---|---|---|
| portable Record | `record.json`、已封口 Run、Core 与 fixed family closure | 是 |
| local operation state | execution claim、lease、session 与 verified-read cache | 否 |

execution claim、session 与 gate 位于项目 `.niceeval/`，并由 Coordination SDK 拥有。默认 Record 的
read / append / maintenance lease 位于 `.niceeval/coordination/records/<recordKey>/`。custom Record 的
lease 位于其 parent 的同形目录。`recordKey` 绑定 canonical physical root，并由不可变 `recordId` 复核。

这些 local state 不进入 Report，也不随 Record 复制。复制或 Git 操作只在没有活动 reader、writer 或
maintenance 的静止状态进行。

## Durable Record 布局

```text
record/
├─ record.json
└─ runs/
   └─ <RunId>/
      ├─ run.json
      ├─ members/<SlotId>.json
      ├─ attempts/<AttemptId>/
      │  ├─ attempt.json
      │  └─ attachments/<family>/
      │     ├─ attachment.json
      │     ├─ payload.json
      │     └─ blobs/<opaque-key>
      ├─ attachments/<family>/
      │  ├─ attachment.json
      │  ├─ payload.json
      │  └─ blobs/<opaque-key>
      └─ complete
```

`record.json` 建立 Record 时写一次，保存 format 与 `recordId`，不是 Run 索引。根目录没有
`manifest.json`、递增编号、权威 `latest` 或共享 summary。可删除重建的索引只能是 local cache，不能决定
事实是否存在。

`complete` 是零字节、排他创建的唯一发布信号。writer 在它之前关闭并 flush 本 Run 的每份文件和目录；
它之后永不修改这个 Run。没有 `complete` 的目录不进入选择、Sample 或 reuse，并产生
`incomplete-run` warning。

## NiceEval 内部的 definition 驱动模型

NiceEval 以一个 package-private definition 集合描述 root、Core 与 current catalog 的五个固定 Attachment。它是读取、
写入、校验、canonical encode 和 migration 的共同输入；不存在另一份手写的“当前模型”。以下函数不从
任何公开 package 导出：

- `defineRecordProperty`
- `defineRecordValue`
- `defineRecordCore`
- `defineRecordAttachment`

它们也不是 Plugin、Adapter 或应用作者可调用的 extension point。没有公开 generic
`RecordDefinition`、`RecordFamily`、`RecordAttachment`、registration point 或 migration registry。

### property 的三个身份

每个 property 分开声明 property token id、TS field 和 durableKey。TS field 不是 property input 的成员；
它是 `defineRecordCore` 或 `defineRecordValue` 的 `properties` map key。即使 map key 与 `durableKey`
的拼写碰巧相同，它们仍是三个不同角色，定义和编码不能以字符串相等把它们合并。

```ts
// NiceEval internal only; not an importable author API.
const runStartedAt = defineRecordProperty({
  id: "niceeval.record.property.run-started-at",
  durableKey: "started-at-ms",
  schema: UtcMillisSchema,
});

const runTiming = defineRecordCore({
  properties: {
    startedAt: runStartedAt,
  },
  limits: RunTimingLimits,
});
```

| 名称 | 示例 | 用途 |
|---|---|---|
| property token id | `niceeval.record.property.run-started-at` | definition 图中的内部令牌与缓存身份 |
| TS field | `startedAt`，即 `properties` map key | 已验证内存对象的字段访问 |
| durableKey | `started-at-ms` | durable JSON 的 canonical key |

`AnalysisInput.id` 是另一类身份。它命名统计投影，例如 `niceeval.analysis.attempt-latency-ms`，既不是
property token id，也不是 durableKey，不能拿 Record JSON key 代替。

### current 与 maintenance facet

内部集合有两个固定 facet：

```ts
// NiceEval internal only; the shape explains ownership, not a public factory.
const recordDefinition = {
  current: {
    root: defineRecordCore({
      properties: recordDocumentProperties,
      limits: RecordDocumentLimits,
      refine: refineRecordDocument,
    }),
    core: defineRecordCore({
      properties: runMemberAttemptProperties,
      limits: RecordCoreLimits,
      refine: refineRecordCore,
    }),
    attachments: {
      assertions: /* one fixed definition */,
      observability: /* one fixed definition */,
      fileChanges: /* one fixed definition */,
      sources: /* one fixed definition */,
      artifacts: /* one fixed definition */,
    },
  },
  maintenance: {
    adjacentMigrations: [],
  },
} as const;
```

`current` 是 ordinary reader 与 writer 唯一可用的完整 schema。`maintenance` 只拥有 format inspection、
Git preflight 与固定相邻迁移。普通 reader 不调用 maintenance，也不在读历史时自动改盘。

### Core 与 Attachment 的 leaf 类型

`defineRecordCore({ properties, limits, refine? })` 固定使用 `json` leaf。它的输出绝不含 blob ref；根、
Run、Member 与 Attempt 因此能在不 materialize 大内容的情况下独立验证。

Attachment owner value 用
`defineRecordValue({ properties, leaf: "json-with-blob-refs", limits, isBlobRef?, refine? })` 声明。它仍是
exact JSON，但只可用由该 definition 认可的 blob ref 指向 own closure。generic writer 不能接受任意 JSON、
path、bytes 或手写 ref。

固定 family 只由 NiceEval 用
`defineRecordAttachment({ family, current: { schemaVersion, owners }, maintenance? })` 声明。`maintenance` 是
延迟取得历史 codec 与相邻迁移的内部 facet；它不是普通 reader 或第三方 registration 的入口。

```ts
// NiceEval internal only. Map keys are TS fields; each value has its own token
// and durableKey instead of one monolithic payload schema.
const attemptObservabilityProperties = {
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
} as const;

const runObservabilityProperties = {
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

Observability 有一个 family 入口，owner-specific shape 位于 `owners.attempt` 与 `owners.run`。Artifacts
也有一个入口：

```ts
// NiceEval internal only.
const artifacts = defineRecordAttachment({
  family: "niceeval.artifacts",
  current: {
    schemaVersion: 1,
    owners: {
      attempt: defineRecordValue({
        properties: attemptArtifactProperties,
        leaf: "json-with-blob-refs",
        limits: AttemptArtifactLimits,
        isBlobRef: isRecordBlobRef,
        refine: refineAttemptArtifacts,
      }),
      run: defineRecordValue({
        properties: runArtifactProperties,
        leaf: "json-with-blob-refs",
        limits: RunArtifactLimits,
        isBlobRef: isRecordBlobRef,
        refine: refineRunArtifacts,
      }),
    },
  },
});
```

Observability 与 Artifacts 都不是两个 family，也不会因 owner 增加第二个 schema 名称。

## Exact codec、canonical form 与预算

每个 definition 以同一条顺序处理 bytes。object key 先按 definition 的 durableKey canonical order
重建；identity array 不自动排序。array 的领域 refine 要求它已按声明 identity canonical order 排列，
并拒绝重复或非规范顺序。

```text
decode
bytes → JSON parse → canonicalize object keys → Effect Schema exact → local refine
                                                           │
                                                           ▼
                                              Core cross-document refine

encode
refined value → Core cross-document refine → local refine → Effect Schema encode
                                                    → canonical durableKey order → bytes
```

Effect Schema exact 拒绝未知、缺失或错误 shape。local refine 负责数值范围、identity 唯一性、owner、
blob closure 和 family 的局部关系。Core cross-document refine 在 root、Run、Member 和 Attempt 都解码后
检查引用、expected Slot 与 origin 关系；单个 document 通过 Schema 不能取代这一步。

每个 property/value definition 自己声明 JSON、identity array 与 blob 的预算。封口和读取都执行同一预算，
不以一个全局宽松上限绕过 family 的边界。encode 是 decode 的反向受控边界：只有已经 refined 的值可以
编码，输出 object key 始终依 durableKey canonical order。

## Current root 与 Core

root 的 exact JSON 是：

```ts
type RecordDocument = {
  readonly format: "niceeval.record";
  readonly schemaVersion: 1;
  readonly recordId: RecordId;
};
```

Run、Member 与 Attempt 由 current Core definition 生成如下已验证值。它们是 definition 的输出形状，
不是第二份独立 wire model。

```ts
type RunDocument = {
  readonly runId: RunId;
  readonly experimentId: ExperimentId;
  readonly context: RunContext;
  readonly startedAt: UtcMillis;
  readonly completedAt: UtcMillis;
  readonly expectedSlots: readonly SlotIdentity[];
};

type RunContext = {
  readonly experimentId: ExperimentId;
  readonly execution: {
    readonly agentId: string;
    readonly model: string | null;
    readonly reasoningEffort: string | null;
    readonly flags: RecordJsonObject;
  };
  readonly labels: Readonly<Record<string, string>>;
};

type SlotIdentity = {
  readonly slotId: SlotId;
  readonly evalId: EvalId;
  /** Zero-based, durable; it is never inferred from expectedSlots order. */
  readonly attemptOrdinal: number;
  readonly executionIdentityDigest: ExecutionIdentityDigest;
};

type MemberDocument = {
  readonly slotId: SlotId;
  readonly action:
    | "executed"
    | "carried"
    | "accepted"
    | "not-dispatched"
    | "interrupted";
  readonly attempt:
    | { readonly originRunId: RunId; readonly attemptId: AttemptId }
    | null;
};

type AttemptDocument = {
  readonly attemptId: AttemptId;
  readonly originRunId: RunId;
  readonly slotId: SlotId;
  readonly evalId: EvalId;
  readonly executionIdentityDigest: ExecutionIdentityDigest;
  readonly outcome: "completed" | "errored" | "cancelled" | "interrupted";
};
```

Core refine 强制以下不变量：

- `expectedSlots` 以 `slotId` canonical 排列且不重复；同一 `(evalId, attemptOrdinal)` 也只能有一个
  Slot。ordinal 不要求连续，且不从数组位置推断；一个 Slot 最多有一个 Member。
- `RunDocument.context` 必填、只写一次；它是解释已封口 Run 所需的 Core 历史事实，绝不是当前配置的
  pointer。`context.experimentId` 必须与 `RunDocument.experimentId` 完全相同。
- `executed`、`carried` 与 `accepted` 必须有 Attempt reference；`not-dispatched` 与 `interrupted`
  必须显式写 `null`。
- Attempt 只存放在 `originRunId` 的目录中，且与 origin Run 的 Slot、Eval 和 execution identity 相同；
  ordinal 只留在 origin Run 的 SlotIdentity，绝不复制进 Attempt 或 Member。
- origin Run 中每个 Attempt 恰有一个 origin Member；后续 Run 只写精确 reference Member。
- `executed` 与 `carried` 的 target SlotIdentity 必须和 origin SlotIdentity 的 slotId、evalId、
  attemptOrdinal、execution identity digest 全等；`accepted` 只解释当前 Run，不授予未来 carry。
- writer 只引用其 read selection 中已封口的 Attempt，因此新 Run 不会形成 future reference 或环。

Experiment、RunContext、Eval、Slot identity、execution identity digest 与 Member action 是离线解释不可缺的
Core 历史事实。matcher、当前输入、cache hit、通行率、排名与页面模型不进入 Core。

## 五个固定 Attachment family

每个 owner 对每个 family 至多有一个 envelope。`attachment.json` 使用稳定 family identity 与数值版本：

```ts
type AttachmentEnvelope = {
  readonly family: "niceeval.assertions";
  readonly schemaVersion: 1;
};
```

其它 fixed family 使用自己的稳定 `family` literal，但相同的 envelope 规则。family 名称不包含版本。

| family | `owners` map | exact payload root | 写入语义 |
|---|---|---|---|
| `niceeval.assertions` | `{ attempt }` | `AssertionsDocument` | Assertion producer 封口 criterion、material、Evidence 与 result |
| `niceeval.observability` | `{ attempt, run }` | `AttemptObservabilityAttachment` / `RunObservabilityAttachment` | collector 封口对话、命令、用量、时间、诊断与 OTel |
| `niceeval.file-changes` | `{ attempt }` | `FileChangesAttachment` | Sandbox collector 封口归因策略与 send 区间文件变化轨迹 |
| `niceeval.sources` | `{ run }` | `SourcesAttachment` | Runner 封口源码闭包 manifest 与 own blobs |
| `niceeval.artifacts` | `{ attempt, run }` | `ArtifactsAttachment` | artifact collector 封口有类型文件 |

Assertions 的 criterion、Evidence 与局部错误规则由 [Assertions architecture](../assertions/architecture.md)
拥有。Observability 的精确 shape 由 [Observability Attachment](architecture/observability-attachments.md)
拥有。本页定义它们共同的 durable boundary。

future NiceEval catalog 可以增加独立 fixed family，例如 `niceeval.energy`，而不改变 root 或 Core。它有自己的
stable family name、numeric schemaVersion、`owners` map、definition 与 collector；它仍不是第三方扩展点。
早期 reader 在扫描 owner attachment directory 时保留未知 family 的完整 bytes，跳过 payload / blob 解释，
继续验证 Core 和认识的 family。

```ts
type FileChangesAttachment = {
  readonly attribution: FileChangesAttribution;
  readonly collection: FileChangesCollectionState;
  readonly windows: readonly FileChangesWindow[];
};

type FileChangesAttribution = {
  readonly kind: "agent-send-window-endpoints";
  readonly policy: {
    readonly defaultPolicy: "niceeval.sandbox-ledger/default-excludes/v1";
    readonly include: readonly FileChangesPolicyEntry[];
    readonly ignore: readonly FileChangesPolicyEntry[];
  };
};

type FileChangesPolicyEntry = string;

type FileChangesCollectionState =
  | { readonly state: "complete"; readonly limitations: readonly [] }
  | {
      readonly state: "partial";
      readonly limitations: readonly [
        FileChangesCollectionLimitation,
        ...FileChangesCollectionLimitation[],
      ];
    };

type FileChangesCollectionLimitation =
  | {
      readonly code: "capture-failed" | "capture-interrupted";
      readonly stage: "checkpoint" | "export" | "finalizer-export" | "normalize";
      readonly atWindowId: FileChangesWindowId | null;
    }
  | {
      readonly code: "collection-cap-reached";
      readonly target: "window" | "change" | "content-blob" | "content-byte" | "json-byte";
      readonly omittedAtLeast: PositiveSafeInteger;
      readonly atWindowId: FileChangesWindowId | null;
    }
  | {
      readonly code: "unsupported-input";
      readonly target: "endpoint-metadata";
      readonly omittedAtLeast: PositiveSafeInteger;
    };

type FileChangesWindow = {
  readonly windowId: FileChangesWindowId;
  readonly sequence: PositiveSafeInteger;
  readonly changes: readonly FileChange[];
};

type FileChangesWindowId =
  | `turn${PositiveSafeInteger}`
  | `session${PositiveSafeInteger}/turn${PositiveSafeInteger}`;

type FileChange = {
  readonly changeId: FileChangeId;
  readonly path: CanonicalProjectRelativePath;
  readonly kind: "created" | "modified" | "deleted";
  readonly before: FileEndpoint;
  readonly after: FileEndpoint;
};

type FileEndpoint =
  | { readonly state: "absent" }
  | { readonly state: "present"; readonly revision: FileRevision };

type FileRevision =
  | {
      readonly kind: "text";
      readonly sha256: Sha256Digest;
      readonly byteLength: NonNegativeSafeInteger;
      readonly content:
        | { readonly state: "available"; readonly ref: RecordBlobRefPosition }
        | { readonly state: "omitted"; readonly reason: "collection-cap" };
    }
  | {
      readonly kind: "elided";
      readonly reason: "binary" | "oversized-text";
      readonly byteLength: NonNegativeSafeInteger;
    }
  | {
      readonly kind: "unavailable";
      readonly reason: "unsupported-input" | "capture-failed" | "capture-interrupted";
    };

type ArtifactsAttachment = {
  readonly collection: CollectionState;
  readonly artifacts: readonly Artifact[];
};

type Artifact = {
  readonly artifactId: ArtifactId;
  readonly mediaType: string;
  readonly label: string;
  readonly byteLength: NonNegativeSafeInteger;
  readonly sha256: Sha256Digest;
  readonly content: RecordBlobRef;
};
```

File Changes 的 durable 单位是 send 区间轨迹。每个 send 区间保留自己的路径变化，不按路径汇总。`attribution.kind` 固定为
`agent-send-window-endpoints`；其 `policy.defaultPolicy` 固定为
`niceeval.sandbox-ledger/default-excludes/v1`。`include` 与 `ignore` 各自按 canonical identity（规范身份）
排序且无重复。

`windowId` 必须精确是 `turnN` 或 `sessionN/turnN`，其中每个 N 都从 `1` 开始，同一 ID 只能出现一次。每个
send 区间内的 `changes` 按 path 的 ASCII 字节序排列，path 不重复；不同 send 区间可以重复同一路径。
所有 `sequence` 严格递增。仅 `collection.state: "complete"` 要求它们恰为连续的 `1..N`；`partial` 只要求
严格递增，不能以缺号伪装未捕获的区间。

collector 在 capture freeze（捕获封口）时只 mint 一次 `changeId`，且它在整份 Attachment 中唯一。读取、Analysis
和 Report 都不得生成、重排或复用它。`created` 必须是 absent → present，`modified` 必须是 present → present，
`deleted` 必须是 present → absent。`present` 的 revision 可以是完整 text、内容已省略的 `elided`，或无法取得内容的
`unavailable`；它从不等同于文件不存在。

text revision 的 `content` 要么是带 `RecordBlobRefPosition` 的 `available`，要么是
`omitted(collection-cap)`。`available` 的 blob ref、SHA-256 与 byteLength 一起进入本 family 的 own closure。
blob bytes 必须同时匹配 digest 和长度，且每个 ref 仍遵守 Attachment 的双向 closure 规则。

binary 与超过文本上限的 revision 使用 `elided`，携带 `binary` 或 `oversized-text` 原因和 byteLength；这本身是
完整采集，不能降级 collection。`unavailable` 必须带 `unsupported-input`、`capture-failed` 或
`capture-interrupted` 原因。

`collection: "complete"` 可以含零变化；它证明完整轨迹中没有 agent 归因的路径变化。`collection: "partial"`
也可以没有已捕获变化；它只证明安全前缀为空，不能证明没有变化。缺少 Attachment 的 `not-recorded` 只表示
collector 对该 Attempt 不适用，和前两种空态不同。

File Changes 固定限额如下：

- 最多 256 个 send 区间；每个 send 区间与整份 Attachment 都最多 10,000 个 changes。
- 一个完整 text revision 与单个 blob 都最多 1 MiB；最多 20,000 个 blobs、总计 128 MiB blob bytes。
- payload JSON 最多 16 MiB。`include` 与 `ignore` 各最多 256 项，每项最多 4,096 bytes。

collector 先按 `sequence`，再按同一 send 区间内的 ASCII path 处理候选变化。达到任一采集限额时，它不跳过
当前项去采后面的项：只保存这个确定性的安全前缀，并写入 `collection-cap-reached` limitation。该 limitation
以 `target`、`omittedAtLeast` 和可空 `atWindowId` 标明边界，collection 必为 `partial`。

capture 失败或中断则以 `capture-failed` 或 `capture-interrupted` 写入 `stage` 与 `atWindowId`。无法支持 endpoint
metadata 时，使用 `unsupported-input`、`endpoint-metadata` 与 `omittedAtLeast`。partial 的 limitations 非空、按确定
key 排列且无重复；complete 的 limitations 必为空。

binary 或 oversized text 的既定 `elided` 形态不触发这条截断。policy 超过自身限额不能形成合法 Attachment。

`niceeval.file-changes` 固定使用 numeric schemaVersion `1`。不存在已发布的按 path 汇总格式作为 migration source，
也不存在 File Changes 独立的前代格式；Record 的首次正式格式没有已发布 predecessor。

### Sources manifest

`niceeval.sources` 保存当时的源码闭包，不从 reader 所在 worktree、网络或 package installation 补读内容。

```ts
type SourcesAttachment = {
  readonly items: readonly SourceItem[];
};

type SourceItem = {
  readonly sourceItemId: SourceItemId;
  readonly path: CanonicalProjectRelativePath;
  readonly byteLength: NonNegativeSafeInteger;
  readonly sha256: Sha256Digest;
  readonly content: RecordBlobRef;
};
```

`path` 用 `/` 分隔，不以 `/` 开头，且没有空、`.` 或 `..` segment。`sourceItemId` 不是数组下标、path、
digest 或 blob key 的函数。每个 item 的 `byteLength` 与 `sha256` 都声明 own blob 的 exact bytes；reader
在 materialize 完整 closure 后验证它们。

Attempt 的 source site 或 diagnostic frame 只能以 schema-declared identity join origin Run 的 item。
join 不授予跨 owner blob capability，也不把 path、host handle 或 storage address 交给 Attempt。

## Attachment closure、惰性读取与 cache

一个 closure 有效，当且仅当：

- payload 的每个 blob ref 有且只有一个同目录 blob；
- 每个 blob key 恰被该 payload 引用一次；
- ref、key、bytes 与 envelope 都属于同一个 owner 与 family；
- exact payload、family definition 与每个 family 的局部 refine 都通过。

缺 key、多 key、重复 key、手写 key、跨 owner ref 或 root 外路径使 Attachment 为 `invalid`。它不会产生
“可用但少一个 blob”的值。I/O 与 permission failure 在值形成前产生 typed `RecordReadError`。

`RecordReadSession` 打开时只验证 root 与 current definition。`selectRuns()` 扫描 `runs/*/complete`，
并读取选择所需的最小 Run Core 与 Member identity。它形成的 `RecordSelection` 只保存 RunId、SlotId、
预期分母和问题；不会把 Attempt、OTel、Evidence、diff 或 blob 复制进内存。

Analysis 的 Sample 才按 `AnalysisInput` 或 `DomainViewRequest` 请求精确 Attachment。Sample 在 Scope 内
以 `{ owner, internal attachment definition }` 缓存一次完整验证结果。already materialized 的 JSON snapshot
与 defensive blob copy 可在 Scope 后同步消费；cache 不成为 candidate、absence 或 latest 的权威依据。

Report 不取得 reader、Attachment、blob handle、Scope 或 raw payload。它只消费 Analysis 已闭合的
`ClosedRows`、`SemanticFrame` 与 `DomainView`。

## 直接写入与发布状态机

一个 Run writer 直接写 `runs/<RunId>/`，不建立 staging root。不同 writer 的目录不重叠：

```text
writer A ──▶ runs/<RunId-A>/ ──▶ complete
writer B ──▶ runs/<RunId-B>/ ──▶ complete
```

session 状态如下：

```text
open → sealing → sealed
               ↘ failed
```

1. `createRun()` 或 `createReferenceRun()` 先接收必填 `context`，验证它的 exact Core shape 与
   `context.experimentId === experimentId`，再排他创建新目录并把 context 带入本 Run 的 mutable draft。
2. `createAttempt()` 为每个实际执行的 Attempt 排他创建目录；fixed collector 在内存收集并封口其 family。
3. `referenceAttempt()` 只写 Member reference，不复制历史 Attempt 或 Attachment。
4. `recordTerminalMember()` 为 `not-dispatched` 或 `interrupted` 显式写入 `attempt: null`。
5. `seal()` 拒绝新 mutation，等待既有 Attempt 和 collector 停稳，并用 current definition 验证
   `RunDocument.context`、其余 Core、references、family 与 closure。
   验证完成后，它把已验证的 context 写入 `run.json`。
6. `seal()` 在短暂 `Effect.uninterruptibleMask` 中 final flush/close、排他创建 `complete`，并同步 consume writer。

第 6 步前的 typed failure、defect、interruption 或进程退出都不发布 Run。directory 保留为 incomplete，
以便 `niceeval clean` 明确处理。第 6 步后 Run 已发布；即使 receipt 未被观察到，也不会撤销事实。finalizer
只释放 lease 和 handle，绝不删除目录。

## Maintenance、兼容性与相邻迁移

schemaVersion `1` 是当前 root / Core 的唯一可读、可写版本。ordinary reader 按下表区分不兼容和局部
未知数据：

| 发现的内容 | ordinary reader | maintenance |
|---|---|---|
| root 或 Core schemaVersion 不匹配 | `migration-required`（有相邻步骤）或 `unsupported-format`；不形成 session | 只运行静态定义的相邻 step |
| 已知 family 的旧 schemaVersion | `migration-required`；ordinary read 不兼容 | 显式迁移该已知 family 的 definition |
| 未知的独立 future family | 保留 directory、payload 与 blob bytes；不解释，继续读取 Core / 已知 family | 不迁移、也不删除 |
| current catalog family 缺失 | 按请求得到 `not-recorded` | 不补写历史事实 |
| 带 `/vN` 后缀的未发布 family 草案 | `unsupported-format`；不得按未知 family 容忍 | 不进入迁移链 |

未知 family 不是 schemaVersion 不匹配的 known family。它的 stable name 尚未被该 reader 的 catalog 认识，
所以 reader 没有 payload schema、closure rule 或 projection 可以安全执行。任何 `AnalysisInput` 或
`DomainViewRequest` 依赖它时，只返回 `unsupported`；其它 Analysis 结果和 Report
闭合输出不受污染。

未来发布 schemaVersion `2` 时，`maintenance` facet 必须提供固定 `1 → 2` step。step 只依赖已保存的
Core、fixed family payload 与 own blob closure；它不调用第三方 converter，也不从当前 worktree、网络或
运行时算法补写历史事实。

有相邻步骤时，maintenance 在首次写 portable byte 前完成 Git preflight：Record 位于 Git worktree，
完整 portable inventory 由 HEAD 跟踪，index 与 worktree 对该 inventory 干净。计划还绑定 repository
identity、HEAD、Record path、`recordId`、source inventory 与 NiceEval migration implementation identity。

迁移在 exclusive maintenance lease 下原地逐步执行，完整校验 Core、所有认识的 fixed family 与它们的
blob closure 后才结束。未知 future family 保持逐字节不动。NiceEval 不创建 staging、backup、rollback、
root replacement 或恢复日志。中断或失败后，用户以 Git 完整恢复 `.niceeval/record` 的历史 bytes，再重新
运行 `niceeval migrate`；恢复前不会创建 reader。

## 变化归属

| 变化 | 归属 | Record 动作 |
|---|---|---|
| matcher、计划、reuse 条件或 Report component 改变 | behavior / Analysis / Report | 不改 Record，必要时更新 behavior identity |
| 从已保存事实计算新统计或视图 | Analysis / Report | 不改 Record |
| 此前未保存且不可恢复的事实 | NiceEval catalog | 扩展既有 family，或增加新的 static fixed family；不升级 Core |
| fixed family 的字段、单位、cardinality 或 closure 语义改变 | NiceEval Record | 发布相邻 schemaVersion migration |
| Core identity、owner、引用、目录或原子发布边界改变 | NiceEval Record | 发布相邻 Record migration |

新增 Query、Measure、页面、组件、输出媒介或 Adapter mapper 不能推动 Record migration。它们只能消费
NiceEval 已发布的 current data plane。
