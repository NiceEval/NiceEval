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

`complete` 是零字节普通文件，也是排他创建的唯一发布信号。writer 在它之前关闭并 flush 本 Run 的每份文件和目录；
它之后永不修改这个 Run。缺少它，或该路径为非空文件、目录、symlink 等其它形态的 Run 不进入选择、Sample 或 reuse，并产生
`incomplete-run` warning。

## NiceEval 内部的 Effect Schema 作者模型

NiceEval 以 package-private Schema declaration 描述 root、Core 与 current catalog 的六个固定 Attachment。
它是读取、写入、校验、canonical encode 与 migration 的共同输入；不存在另一份手写的当前模型。

唯一的作者入口是 `defineRecordCore` 与 `defineRecordAttachment`。两者不从公开 package 导出，也不是
Plugin、Adapter 或应用作者可调用的 extension point。没有公开 generic family、declaration、registration point
或 migration registry。

`compileRecordSchemaCodec` 消费已声明的 Schema 并执行编解码。它是 package-private 的实现叶子，既不是
作者入口，也不是扩展点或 barrel 导出。

### Core Schema

`defineRecordCore({ schema, limits })` 声明一个 Core document。`Schema.Type` 是内存字段形状，
`Schema.Encoded` 是 durable JSON 形状。字段名和 durable JSON 键不同，由同一个 Schema 显式声明：

```ts
// NiceEval internal only; not an importable author API.
const RunTimingSchema = Schema.Struct({
  startedAt: Schema.propertySignature(UtcMillisSchema).pipe(
    Schema.fromKey("started-at-ms"),
  ),
});

const runTiming = defineRecordCore({
  schema: RunTimingSchema,
  limits: RunTimingLimits,
});

type RunTiming = Schema.Type<typeof RunTimingSchema>;
type EncodedRunTiming = Schema.Encoded<typeof RunTimingSchema>;
```

`RunTiming` 使用 `startedAt`，`EncodedRunTiming` 使用 `started-at-ms`。这项键映射不引入独立身份。
`AnalysisInput.id` 仍命名统计投影，例如 `niceeval.analysis.attempt-latency-ms`，与 Record durable JSON 键无关。

### current、maintenance 与 fixed family

内部集合有 `current` 与 `maintenance` 两个固定 facet。`current` 是 ordinary reader 与 writer 唯一可用的
完整 Schema。`maintenance` 拥有 format inspection、Git preflight 与固定相邻 migration；ordinary reader
既不调用它，也不在读取时改盘。

```ts
// NiceEval internal only; the shape explains ownership, not a public API.
const recordDefinition = {
  current: {
    root: defineRecordCore({
      schema: RecordDocumentSchema,
      limits: RecordDocumentLimits,
    }),
    run: defineRecordCore({ schema: RunDocumentSchema, limits: RunDocumentLimits }),
    member: defineRecordCore({ schema: MemberDocumentSchema, limits: MemberDocumentLimits }),
    attempt: defineRecordCore({ schema: AttemptDocumentSchema, limits: AttemptDocumentLimits }),
    attachments: currentAttachmentCatalog,
  },
  maintenance: {
    adjacentMigrations: [],
  },
} as const;
```

一个 `defineRecordAttachment` 调用定义 stable `family` 与 `current`。`current` 包含数值 `schemaVersion` 和
全部 owner。每个 owner 相邻声明 payload Schema、limits 及 `blobs: { refs, budget, verify }`。`maintenance`
是 async 的 lazy 历史 codec 与相邻 migration 描述；它不提供历史兼容读取。

```ts
// NiceEval internal only.
const observability = defineRecordAttachment({
  family: "niceeval.observability",
  current: {
    schemaVersion: 2,
    owners: {
      attempt: {
        schema: AttemptObservabilitySchema,
        limits: AttemptObservabilityLimits,
        blobs: {
          refs: AttemptObservabilityBlobRefs,
          budget: AttemptObservabilityBlobBudget,
          verify: verifyAttemptObservability,
        },
      },
      run: {
        schema: RunObservabilitySchema,
        limits: RunObservabilityLimits,
        blobs: {
          refs: RunObservabilityBlobRefs,
          budget: RunObservabilityBlobBudget,
          verify: verifyRunObservability,
        },
      },
    },
  },
  adjacentMigrationLinks: [{ fromSchemaVersion: 1, toSchemaVersion: 2 }],
  maintenance: async () => loadObservabilityMaintenanceV2(),
});

const currentAttachmentCatalog = [
  assertions,
  observability,
  fileChanges,
  sourceNavigation,
  sources,
  artifacts,
] as const;
```

每个 family 模块包含自己的 declaration、复杂 payload Schema、encoded-side durable JSON 键、limits、blob
closure 与 integrity 验证。当前每个 family 文件恰有一个 `defineRecordAttachment` 调用。复杂 family 可拆成目录，
但只有 `definition.ts` 保留该入口。总 catalog 只列六个 declaration，不复制 owner shape 或 payload Schema。
Observability 与 Artifacts 各有一个 family declaration；`owners.attempt` 与 `owners.run` 不会形成第二个 family。

ordinary reader 与 writer 只接受 exact current catalog。未知 stable family、known family 的 future 版本与
root/Core epoch 不匹配都在 session 形成前拒绝；历史版本只可由 maintenance 的固定完整 chain 迁移。

### Schema 允许集

传给两个作者入口的 Effect Schema 都必须有 `R = never`。Core 的 encoded side 只能是 exact JSON。
Attachment 的 encoded side 也只能是 exact JSON，外加 owner declaration 唯一 mint 的 `RecordBlobRef`。
每个 ref 只能指向同 owner、同 family 的一份 own blob。

允许字段到 durable JSON 键的映射与 Schema refinement。拒绝任意 transform、需要 Effect context 的 schema、
effectful schema 和历史兼容变换。旧版本只经过 maintenance 的显式相邻 migration 形成 current bytes。
generic writer 不接受任意 JSON、path、bytes 或手写 ref。

## Exact codec、canonical form 与预算

每个 declaration 以同一条顺序处理 bytes。object key 先按 `Schema.Encoded` 的 canonical durable JSON 键顺序
重建；identity array 不自动排序。Schema refinement 与 owner `verify` 要求数组已按声明的 identity canonical
顺序排列，并拒绝重复或非规范顺序。

```text
decode
bytes → JSON parse → canonicalize Schema.Encoded object keys → Effect Schema exact decode
      → local Schema refinement / owner verify → Core cross-document verification

encode
verified value → Core cross-document verification → local Schema refinement / owner verify
               → Effect Schema encode → canonical Schema.Encoded durable JSON key order → bytes
```

Effect Schema exact 拒绝未知、缺失或错误 shape。Schema refinement 与 owner `verify` 负责数值范围、identity
唯一性、owner、blob closure 和 family 的局部关系。Core 跨文档验证在 root、Run、Member 和 Attempt 都解码后
检查引用、expected Slot 与 origin 关系；单个 document 通过 Schema 不能取代这一步。

每份 Core declaration 和每个 Attachment owner declaration 都声明 JSON、identity array 与 blob 预算。封口和
读取都执行同一预算，不以一个全局宽松上限绕过 family 的边界。encode 是受控反向边界：只有已验证值可以编码，
输出 object key 始终服从 `Schema.Encoded` 的 canonical durable JSON 键顺序。

## Current root 与 Core

root 的 exact JSON 是：

```ts
type RecordDocument = {
  readonly format: "niceeval.record";
  readonly schemaVersion: 2;
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

## 六个固定 Attachment family

每个 owner 对每个 family 至多有一个 envelope。`attachment.json` 使用稳定 family identity 与数值版本：

```ts
type AttachmentEnvelope = {
  readonly family: "niceeval.assertions";
  readonly schemaVersion: 1;
};
```

其它 fixed family 使用自己的稳定 `family` literal，但相同的 envelope 规则。family 名称不包含版本。

| family | current | `owners` map | exact payload root | 写入语义 |
|---|---:|---|---|---|
| `niceeval.assertions` | 1 | `{ attempt }` | `AssertionsDocument` | Assertion producer 封口 criterion、material、Evidence 与 result |
| `niceeval.observability` | 2 | `{ attempt, run }` | `AttemptObservabilityAttachment` / `RunObservabilityAttachment` | collector 封口对话、命令、用量、时间、诊断与 OTel |
| `niceeval.file-changes` | 1 | `{ attempt }` | `FileChangesAttachment` | Sandbox collector 封口归因策略与 send 区间文件变化轨迹 |
| `niceeval.source-navigation` | 1 | `{ attempt }` | `SourceNavigationAttachment` | Runner 封口每个物理 send 的 source/timing join |
| `niceeval.sources` | 1 | `{ run }` | `SourcesAttachment` | Runner 封口源码闭包 manifest 与 own blobs |
| `niceeval.artifacts` | 1 | `{ attempt, run }` | `ArtifactsAttachment` | artifact collector 封口有类型文件 |

`niceeval.source-navigation` 只有 Attempt owner，schemaVersion 固定为 `1`，并且 `blobs.refs()` 永远为空。
它不拆分或改写 `niceeval.observability` 的 v2 payload。

```ts
type SourceNavigationAttachment = {
  readonly collection:
    | { readonly state: "complete"; readonly limitations: readonly [] }
    | {
        readonly state: "partial";
        readonly limitations: readonly (
          | {
              readonly code: "collection-cap-reached";
              readonly target: "navigation-row";
              readonly omittedAtLeast: PositiveSafeInteger;
            }
          | {
              readonly code: "capture-unrecoverable";
              readonly target: "timing-link";
              readonly omittedAtLeast: PositiveSafeInteger;
            }
        )[];
      };
  readonly rows: readonly SourceNavigationRow[];
};

type SourceNavigationRow = {
  readonly turnId: TurnId;
  readonly sourceOrder: PositiveSafeInteger | null;
  readonly source:
    | { readonly state: "mapped"; readonly sourceItemId: SourceItemId; readonly sha256: Sha256Digest; readonly start: SourcePosition; readonly end: SourcePosition }
    | { readonly state: "unmapped"; readonly reason: "location-not-captured" | "source-snapshot-not-recorded" | "position-unrepresentable" };
  readonly timing:
    | { readonly state: "linked"; readonly intervalId: IntervalId }
    | { readonly state: "unavailable"; readonly reason: "timing-not-recorded" };
};
```

`rows` 最多 256 条，`turnId`、非 null `sourceOrder` 与 linked `intervalId` 各自唯一。row order 必须与同一
Attempt ConversationTurn 的显式 `sequence` 完全相同，且两边 `turnId` 集合相同。

Host 只接受 mapped row 对 exact origin Sources 的 `sourceItemId`、`sha256` 和有序坐标 join。linked row 只接受
同一 Attempt 的 `agent.send` interval。它不扫描 source blob，也不按数组位置、path、digest 或时间接近度补配。

cap 或不可恢复 capture 时，Conversation 与 Navigation 保留同一确定性前缀并各自 `partial`。cap 的两个
`omittedAtLeast` 必须相等。Navigation 的 `collection-cap-reached` 固定 target 为 `navigation-row`，所以它的
`omittedAtLeast` 只表示遗漏的行。

无法形成 timing identity 时，Navigation 以 `capture-unrecoverable` / `timing-link` 表示遗漏的 timing link。
它绝不把两种遗漏混写。

Assertions 的 criterion、Evidence 与局部错误规则由 [Assertions architecture](../assertions/architecture.md)
拥有。Observability 的精确 shape 由 [Observability Attachment](architecture/observability-attachments.md)
拥有。本页定义它们共同的 durable boundary。

future NiceEval catalog 可以增加独立 fixed family，例如 `niceeval.energy`，但发布时必须同时升级 root writer
epoch。它仍有自己的 stable family name、numeric schemaVersion、`owners` map、definition 与 collector，且不是
第三方扩展点。旧 reader 在扫描到未知 family 时 fail closed，不能让 Analysis、Report 或 Runner 读取一个只验证了
部分 catalog 的 Record。

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

- 最多 256 个 send 区间。v1 decoder 继续接受每个区间与整份 Attachment 最多 10,000 个 changes，保证既有 Record 可读；新 producer 每个区间与整份 Attachment 只保留 1,000 个 changes。上游导出候选超过 producer 边界时仍进入 collector，由它保留确定性前缀并登记遗漏数量。这个 1,000 条边界只约束 structural retention；16 MiB payload JSON 与 128 MiB blob bytes 上限不变。
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
   受控中断时，已经 reserved 的 Attempt 则以 Attempt Core `outcome: "interrupted"` 关闭，不改写成空 Member。
5. `seal()` 拒绝新 mutation，等待既有 Attempt 和 collector 停稳，并用 current definition 验证
   `RunDocument.context`、其余 Core、references、family 与 closure。
   验证完成后，它把已验证的 context 写入 `run.json`。
6. `seal()` 在短暂 `Effect.uninterruptibleMask` 中 final flush/close、排他创建 `complete`，并同步 consume writer。

第 6 步前的 typed failure、defect、interruption 或进程退出都不发布 Run。directory 保留为 incomplete，
以便 `niceeval clean` 明确处理。第 6 步后 Run 已发布；即使 receipt 未被观察到，也不会撤销事实。finalizer
只释放 lease 和 handle，绝不删除目录。

Runner 收到可处理的 `SIGINT` 后会先停止派发并关闭每个已知 Slot，再调用同一个 `seal()`。这条路径没有部分读取协议：Run 要么以 `complete` 发布，已完成 Attempt 可按 locator 使用；要么因收尾写入失败保持整体 incomplete，并继续由 warning 与 `clean` 处理。

## Maintenance、兼容性与相邻迁移

schemaVersion `2` 是当前 root / Core 的唯一可读、可写 writer epoch；fixed family 各自拥有 current 版本。
schemaVersion `1` 与 Observability v1 只有在固定完整 `1 → 2` chain 中才是 predecessor：

| 发现的内容 | ordinary reader | maintenance |
|---|---|---|
| root/Core epoch 与全部 family 命中完整 automatic-safe chain | ordinary 入口不得形成 session；Git-safe automatic maintenance 成功后全新打开 | 同一 exclusive session plan/apply，并同时升级 root epoch与目标 family |
| root/Core 或已知 family 是 future/无链 schemaVersion | `unsupported-format`；不形成 session | `unsupported-format`；提示使用写出该版本的 NiceEval |
| 未知 family | `unsupported-format`；不形成 session | `unsupported-format`；不猜 payload、closure 或迁移 |
| current catalog family 缺失 | 按请求得到 `not-recorded` | 不补写历史事实 |
| 带 `/vN` 后缀的未发布 family 草案 | `unsupported-format`；不得按未知 family 容忍 | 不进入迁移链 |

未知 family 没有 payload schema、closure rule 或 projection 可供当前版本验证，因此整个 ordinary open
fail closed；它不能再作为局部 `unsupported` 进入 Analysis。

Record root schemaVersion `2` 与 Observability schemaVersion `2` 由 `maintenance` facet 提供固定的联合
`1 → 2` step。step 只依赖已保存的两个 owner payload 与 own blob closure，并逐字保留 label、blob refs 与
blob bytes；root epoch 最后升级。它不调用第三方 converter，也不从当前 worktree、网络或运行时算法补写历史事实。

有相邻步骤时，maintenance 在首次写 portable byte 前完成 Git preflight：Record 位于 Git worktree，
完整 portable inventory 由 HEAD 跟踪，index 与 worktree 对该 inventory 干净。计划还绑定 repository
identity、HEAD、Record path、`recordId`、source inventory 与 NiceEval migration implementation identity。

迁移在 exclusive maintenance lease 下原地逐步执行，完整校验 exact current Core、完整 catalog 与所有 blob
closure 后才结束。未知或 future family 使计划失败。NiceEval 不创建 staging、backup、rollback 或 root replacement。

`show`、`view` 与 `exp` 在 ordinary session、Run/claim/Sandbox 或付费调用前先做短检查。current fast path
直接 ordinary open，不要求 Git clean。

需要迁移时先关闭检查 scope，再取得 exclusive maintenance。plan/apply 绑定并复核 HEAD、
Record identity、portable inventory、source bytes 与 migration identity。只有完整、无损、automatic-safe chain
且 HEAD 已跟踪全部 portable bytes、Record path 的 index/worktree 干净时才无确认迁移。

成功并全量验证后释放 maintenance，再新开 ordinary session。非 Git、dirty/untracked/ignored、read-only、
lease busy、不完整 chain、future/unknown 或失败都给出 typed blocker，绝不继续 ordinary open。

计划同时绑定每个目标 envelope 的 exact source bytes。首次改写前的 `migration.in-progress` 只保存已验证的 restore commit。

中断或失败后，maintenance 先证明 HEAD 未变化，且 dirty path 只有 sentinel 与 canonical v2 计划目标。证明成立时，CLI 才给出限定到 Record root 的 Git restore 与 tracked-byte 验证命令；否则只要求人工检查并保留并发编辑。验证 worktree/index 等于该 commit 后才清除 sentinel 并重试 `niceeval migrate`。

只有 sentinel 创建成功后的失败进入该恢复态。首个目标改写前发现 source bytes 变化、计划指纹变化、第二次 Git preflight 或 sentinel 创建失败时，不得输出旧计划的 restore 命令。恢复前不会创建 reader。

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
