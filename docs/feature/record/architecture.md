# Record 架构

Record 是可携带的已封口运行事实。它冻结身份、owner（归属者）、精确引用、固定 Attachment
family 和发布边界；Experiment 的调度、execution claim（执行占用）、Analysis 的分母和 Report
的页面都在 Record 之外。

外部消费者把 `<project>/.niceeval/record/` 当作 opaque directory（不透明目录），通过 CLI 与
上层数据面观察它。目录、JSON、blob、reader 和 writer 是 NiceEval 内部持久协议，不是第三方
producer 或 consumer 的扩展格式。

## 两个物理边界

| 边界 | 内容 | 是否可复制、纳入 Git |
|---|---|---|
| portable Record | `record.json`、已封口 Run、Core 与五个 family 的 closure | 是 |
| local operation state | execution claim、lease、session 与 verified-read cache | 否 |

local state 位于 `.niceeval-local/<recordKey>/`。`recordKey` 绑定 canonical physical root，并由
不可变 `recordId` 复核。它不进入 Report，也不随 Record 复制。复制或 Git 操作只在没有活动
reader、writer 或 maintenance 的静止状态进行。

## Durable Record 布局

```text
record/
├─ record.json
├─ runs/
│  └─ <RunId>/
│     ├─ run.json
│     ├─ members/<SlotId>.json
│     ├─ attempts/<AttemptId>/
│     │  ├─ attempt.json
│     │  └─ attachments/<family>/
│     │     ├─ attachment.json
│     │     ├─ payload.json
│     │     └─ blobs/<opaque-key>
│     ├─ attachments/<family>/
│     │  ├─ attachment.json
│     │  ├─ payload.json
│     │  └─ blobs/<opaque-key>
│     └─ complete
└─ migration.in-progress
```

`record.json` 在建立 Record 时写一次，保存 format 和 `recordId`，不是 Run 索引。根目录没有
`manifest.json`、递增编号、权威 `latest` 或共享 summary。可删除重建的索引只能是 local cache，
不能决定事实是否存在。

`complete` 是零字节、排他创建的唯一发布信号。writer 在它之前关闭并 flush 本 Run 的每份文件和
目录；它之后永不修改这个 Run。没有 `complete` 的目录不进入选择、Sample 或 reuse，并产生
`incomplete-run` warning。`migration.in-progress` 存在时，整个 root 都是
`migration-interrupted`，普通访问必须 fail closed。

## Core v1

Core 只保存所有 reader 都必须理解的 identity、expected denominator 和 reference 公理。业务事实
不进入 Core。

```ts
type RecordDocumentV1 = {
  readonly format: "niceeval.record/v1";
  readonly recordId: RecordId;
};

type RunDocumentV1 = {
  readonly runId: RunId;
  readonly startedAt: UtcMillis;
  readonly completedAt: UtcMillis;
  readonly expectedSlots: readonly SlotId[];
};

type MemberDocumentV1 = {
  readonly slotId: SlotId;
  readonly attempt: {
    readonly originRunId: RunId;
    readonly attemptId: AttemptId;
  };
};

type AttemptDocumentV1 = {
  readonly attemptId: AttemptId;
  readonly originRunId: RunId;
  readonly outcome: "completed" | "errored" | "cancelled" | "interrupted";
};
```

所有 Core document 都 exact decode。数组按 canonical identity 排序，并拒绝重复。没有
`members/<SlotId>.json` 表示 expected Slot 没有已发布的 Attempt；它不是可以由 reader 补出的
默认成功值。

Core 有以下不变量：

- 一个 `expectedSlots` 项最多有一个 Member。
- Member 只引用同一 Record 中已经封口的精确 Attempt。
- Attempt 只存放在 `originRunId` 的目录中；其 Core identity 必须与目录相同。
- origin Run 中每个 Attempt 恰有一个 origin Member；后续 Run 只写 reference Member。
- writer 只能引用其 read selection 中的已发布 Attempt，所以新 Run 不会形成 future reference 或环。

Experiment、Eval、matcher、当前输入、缓存命中、通行率、排名和页面模型不进入 Core。它们要么是
固定 Attachment 事实，要么是 Record 之上的行为或派生结果。

## 五个固定 Attachment family

每个 owner 对每个 family 至多有一个 envelope。`attachment.json` 保存 family 与 schema identity；
`payload.json` 和 `blobs/` 共同形成它的 immutable closure。

| schema identity | owner | exact payload root | 写入语义 |
|---|---|---|---|
| `niceeval.assertions/v1` | origin Attempt | `AssertionsDocumentV1` | Assertion producer 封口的 criterion、material、coverage、Evidence 和 result |
| `niceeval.observability/v1` | origin Attempt、Run | `AttemptObservabilityAttachmentV1` 或 `RunObservabilityAttachmentV1` | collector 封口的对话、命令、用量、时间、诊断与 OTel 归一事实 |
| `niceeval.file-changes/v1` | origin Attempt | `FileChangesAttachmentV1` | Sandbox diff collector 封口的按路径变化序列 |
| `niceeval.sources/v1` | origin Run | `SourcesAttachmentV1` | Runner 封口的源码闭包 manifest 与 own blobs |
| `niceeval.artifacts/v1` | origin Attempt、Run | `ArtifactsAttachmentV1` | NiceEval artifact collector 封口的有类型文件 |

`AssertionsDocumentV1` 的 criterion、Evidence 和局部错误规则由
[Assertions architecture](../assertions/architecture.md) 单独拥有。Observability 的精确 shape 在
[Observability Attachment](architecture/observability-attachments.md) 单独拥有。本页定义其余 family
的 durable 边界。

```ts
type FileChangesAttachmentV1 = {
  readonly collection: CollectionStateV1;
  readonly changes: readonly FileChangeV1[];
};

type FileChangeV1 = {
  readonly changeId: FileChangeId;
  readonly path: CanonicalProjectRelativePath;
  readonly kind: "created" | "modified" | "deleted" | "unavailable";
  readonly before: FileRevisionV1 | null;
  readonly after: FileRevisionV1 | null;
};

type FileRevisionV1 =
  | {
      readonly kind: "text";
      readonly sha256: Sha256Digest;
      readonly byteLength: NonNegativeSafeInteger;
      readonly content: RecordBlobRef | null;
    }
  | {
      readonly kind: "binary" | "elided";
      readonly byteLength: NonNegativeSafeInteger;
    };

type ArtifactsAttachmentV1 = {
  readonly collection: CollectionStateV1;
  readonly artifacts: readonly ArtifactV1[];
};

type ArtifactV1 = {
  readonly artifactId: ArtifactId;
  readonly mediaType: string;
  readonly label: string;
  readonly byteLength: NonNegativeSafeInteger;
  readonly sha256: Sha256Digest;
  readonly content: RecordBlobRef;
};
```

`FileChangeId`、`ArtifactId`、`mediaType`、`label`、path、digest 和 `CollectionStateV1` 都使用
family 的 exact decoder。`changes` 和 `artifacts` 按 identity 排序且拒绝重复。`unavailable` 是一次
collector 已知无法形成该路径事实的状态；它不把未读取的路径写成空 diff。text content 只有在
已保存时才持有 ref；binary 或被大小策略省略的 content 不伪造 blob。

### Sources manifest

`niceeval.sources/v1` 保存当时的源码闭包，不从 reader 所在 worktree、网络或 package installation
补读内容。

```ts
type SourcesAttachmentV1 = {
  readonly items: readonly SourceItemV1[];
};

type SourceItemV1 = {
  readonly sourceItemId: SourceItemId;
  readonly path: CanonicalProjectRelativePath;
  readonly sha256: Sha256Digest;
  readonly content: RecordBlobRef;
};
```

`path` 使用 `/` 分隔，不以 `/` 开头，且没有空、`.` 或 `..` segment。`sourceItemId` 不是数组下标、
path、digest 或 blob key 的函数。每个 item 的 `sha256` 等于自身 blob 的 exact bytes；reader 验证
后才将 Sources 视为可用。

Attempt 的 source site 或 diagnostic frame 只能以 schema-declared identity join 这个 origin Run 的
item。join 不是跨 owner blob capability，也不把 path、host handle 或 storage address 交给 Attempt。
后续 Run 引用历史 Attempt 时，沿 Attempt 的 `originRunId` 读取 Sources；不会复制、借用或替换该
closure。

## Attachment closure 与读取状态

一个 closure 有效，当且仅当：

- payload 的每个 blob ref 有且只有一个同目录 blob；
- 每个 blob key 恰被该 payload 引用一次；
- ref、key、bytes 和 envelope 都属于同一个 owner 与 family；
- exact payload、family decoder 和每个 family 的局部不变量都通过。

缺 key、多 key、重复 key、手写 key、跨 owner ref 或 root 外路径使 Attachment 为 `invalid`。
它不会产生“可用但少一个 blob”的值。I/O 和 permission failure 不是 `invalid`，而是在值形成前的
typed `RecordReadError`。

reader 把 `available` value 形成 deep-frozen JSON snapshot，并 materialize 所有 blobs。随后 blob
capability 只从内存返回 defensive copy，不会重新打开 storage 或产生 Stream。单个 family 的
`not-recorded`、`unsupported` 或 `invalid` 只影响请求它的 query；不能反过来污染已有效的 Core。

## 惰性读取与 coordination

`RecordReadSession` 打开时只验证 root 与 current format。`selectRuns()` 扫描 `runs/*/complete`，并
读取选择所需的最小 Run Core 与 Member identity。它形成的 `RecordSelection` 只保存 RunId、SlotId、
预期分母和问题；不会把 Attempt、OTel、Evidence、diff 或 blob 复制进内存。

读取 session 持有 shared read lease，Run writer 持有 shared append lease。它们可以并行，maintenance
lease 则与两者互斥。新的 Run 在 selection 形成后封口，不会加入这次选择，但下一次选择可以看到它。
verified-read cache 只能省 I/O，不能成为 candidate、absence 或 latest 的权威依据。

“两个 Invocation 是否会重复执行同一 logical Slot”由 Experiment 和 Coordination 的 execution claim
解决。claim 在 dispatch 时取得，writer 在承载新 Attempt 的 Run durable seal 后才释放。这个状态不进入
portable Record。

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

1. `createRun()` 排他创建新目录，并写本 Run 的 mutable draft 内容。
2. `createAttempt()` 为每个实际执行的 Attempt 排他创建目录；固定 collector 在内存收集并封口其 family。
3. `referenceAttempt()` 只写 Member reference，不复制历史 Attempt 或 Attachment。
4. `seal()` 拒绝新 mutation，等待既有 Attempt 和 collector 停稳，并验证 Core、references 和 closure。
5. `seal()` 在短暂 `Effect.uninterruptibleMask` 中 final flush/close、排他创建 `complete`，并同步 consume writer。

第 5 步前的 typed failure、defect、interruption 或进程退出都不发布 Run。directory 保留为 incomplete，
以便 `niceeval clean` 明确处理。第 5 步后 Run 已发布；即使 receipt 未被观察到，也不会撤销事实。
finalizer 只释放 lease 和 handle，绝不删除目录。

## 显式 migration 与 Git 恢复

`niceeval.record/v1` 和五个 `/v1` family 是首个支持 schema，migration 链为空。普通 reader、writer、
`show`、`view` 和 `exp` 只接受这个格式。`niceeval migrate` 对完整 v1 返回 `already-current`；任何
非支持 Core 或 family schema 返回 `unsupported-format`。两种结果都不改盘，普通访问也不把另一种
schema 解码成 v1 值。

发布 v2 时，NiceEval 必须同时提供固定、相邻的 v1→v2 migration。步骤只依赖已保存的 Core、
固定 family payload 和 own blob closure；它不调用第三方 converter，也不从当前工作树、网络或运行时
算法补写历史事实。v1 reader 因此只解码 exact v1 bytes。

maintenance 在首次写 portable byte 前完成 Git preflight。Record 位于 Git worktree，完整 portable
inventory 由 HEAD 跟踪，index 与 worktree 对该 inventory 干净，且 `migration.in-progress` 不存在。
计划还绑定 repository identity、HEAD、Record path、`recordId`、source inventory 与 NiceEval migration
implementation identity。

执行按以下顺序：

```text
Git 与 Record preflight
        ↓
create + sync migration.in-progress
        ↓
逐个相邻步骤原地迁移
        ↓
完整校验 Core、五个 family 与 blob closure
        ↓
remove + sync migration.in-progress
```

NiceEval 不创建 staging、backup、rollback、root replacement 或恢复日志。任何中断或失败保留 marker，
并使普通打开 fail closed。恢复的唯一操作是用 Git 完整恢复 `.niceeval/record` 的历史字节，再重新规划
和执行 migration。

## 变化归属

| 变化 | 归属 | Record 动作 |
|---|---|---|
| matcher、计划、reuse 条件或 Report 组件改变 | behavior / Analysis / Report | 不改 Record，必要时更新行为 identity |
| 从已保存事实计算新的统计或视图 | Analysis / Projection | 不改 Record |
| 新增不可恢复事实 | NiceEval fixed family | 明确新增或演进一个固定 family schema |
| 固定 family 的字段、单位、cardinality 或 closure 语义改变 | NiceEval Record | 发布相邻 schema migration |
| Core identity、owner、引用、目录或原子提交边界改变 | NiceEval Record | 发布相邻 Record migration |

新增 Query、Measure、页面、组件、输出媒介或 Adapter mapper 不能推动 Record migration。它们只能消费
NiceEval 已发布的当前数据面。
