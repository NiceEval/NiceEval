# Record 架构

Record 只保存已经发布的运行事实。它冻结身份、owner、精确引用与发布结构；
业务事实全部是版本化的 owner-local `RecordAttachment`。

Record 不包办执行、沿用、分析或报告。Assert-first API、Plugin、reuse planning、
Calculation 与页面可以演进，不因此扩张 Record Core。

## 两个物理边界

| 边界 | 内容 | 是否携带与进 Git |
|---|---|---|
| portable Record | `record.json`、已完成 Run、Core 与 Attachment closure | 可以整体复制或纳入 Git |
| local operation state | session、maintenance lock、writer lock 与 cache | 不属于 Record；不复制、不分享、不进 Git |

默认 portable root 是 `<project>/.niceeval/record/`。Library 的 `root` 参数表示实际
Record root。

锁由平台为同一个 canonical root 协调。它们只协调善意的 NiceEval 进程，不构成 hostile
filesystem 的安全边界。

`RecordRoot` 是 host-local operation parameter。constructor 只接受 lexical-normalized
absolute path 或 file URL，且不 realpath 或承诺 hostile symlink defense。

portable layout 只编码 root-relative segments；host absolute root 不进入磁盘 identity。

未完成 Run 的目录可能短暂出现在 portable root，但它不是 portable Record 的逻辑成员。
复制或 Git 操作遇到它时，目标 reader 同样忽略它并给出 `incomplete-run` warning。

## 什么叫事实

事实不等于未经计算的原始输入。一个值可以进入 Record，前提是它描述当次已经发生、
观察或决定的结果；离线复核不能可靠地从当前源码重新得到它；它有明确 owner 与 schema
identity；producer 在 Run 完成前已经形成它。

因此 AssertionResult、Verdict、Score、Eligibility、Conversation 与 Diagnostics 都可以是
事实。通过率、latest selection、reuse gap 与页面 route 由上层重新计算。

Record 只保证结构可验证，不保证 producer 的业务判断真实。一个完整 Run 仍可能含错误
Verdict；这与磁盘损坏是两件事。

## 三个演进边界

```text
behavior identity
  Assert-first、Plugin、matcher、reuse policy
                 │ 持久语义不变
                 ▼
RecordAttachment schema identity
  一个 owner-local payload 与 blob closure 的 shape 和语义
                 │ Core 公理不变
                 ▼
Record format identity
  owner、引用、目录、完成标识与 Core shape
```

| identity | 冻结什么 | 何时换 identity |
|---|---|---|
| behavior identity | 当前输入、配置与沿用安全语义 | 可观察行为或 reuse 条件改变 |
| `RecordAttachmentSchemaId` | 一份 Attachment payload 与 blob closure 的 shape、语义 | payload、ref 解释或 closure 语义改变 |
| `RecordFormatId` | Core、owner、引用、目录与完成判断 | 任一 Core 公理改变 |

RecordAttachment projector 是代码，不是 durable identity。它只解释一个明确 owner 的一个
Attachment；不选择 Run、不计算通过率，也不判断 reuse。

## Durable Record 布局

```text
record/
├─ record.json
├─ runs/
│  └─ <RunId>/
│     ├─ run.json
│     ├─ members/
│     │  └─ <SlotId>.json
│     ├─ attempts/
│     │  └─ <AttemptId>/
│     │     ├─ attempt.json
│     │     └─ attachments/
│     │        └─ <RecordAttachmentName>/
│     │           ├─ attachment.json
│     │           ├─ payload.json
│     │           └─ blobs/<opaque-key>
│     ├─ attachments/
│     │  └─ <RecordAttachmentName>/
│     │     ├─ attachment.json
│     │     ├─ payload.json
│     │     └─ blobs/<opaque-key>
│     └─ complete
└─ migration.in-progress        仅 migration 期间存在
```

`complete` 是零字节文件。writer 在关闭并 flush Run 的全部其它 durable 内容后，以
exclusive create 最后建立它。它是唯一发布信号，不是 hash，也不验证内容。

`migration.in-progress` 预期也为零字节。它不是普通 layout 成员：只要存在，不论其内容，
整个 root 都 fail closed 为 `record-migration-interrupted`。

完成标识存在后 writer 不再修改该 Run。reader 在实际读取时仍会精确验证 Core、引用与每个
请求的 Attachment。

### 完成标识与局部隔离

reader 枚举 `runs/` 时先检查 `complete`：

| 现场 | 公开结果 |
|---|---|
| 没有 `complete` | 不算 Run；从 candidates、Sample 与 reuse 中排除，并返回 `incomplete-run` warning |
| `complete` 存在，Core 有效 | 可读 published Run |
| `complete` 存在，Core 无效 | 该 Run 是 `RecordCoreRead.core-invalid` |
| Core 有效，某个 Attachment 无效 | 只有该 Attachment 是 `invalid` |
| `migration.in-progress` 存在 | root 不可读，返回 `record-migration-interrupted` |

显式选择未完成目录对应的 RunId 时，它仍不是已发布 Run。selection 返回
`not-recorded`，并保留 root 级 `incomplete-run` warning。

`niceeval clean` 取得 writer lock 后列出未完成目录。确认后只删除仍没有 `complete`
的目录；有完成标识但 Core invalid 的 Run 不属于 clean 范围。

## Core v1

Core 只保存所有 reader 都必须理解的身份、分母、owner 与引用。

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
};
```

这些文档全部 exact decode，未知字段即 invalid。数组按 canonical identity 排序并拒绝重复。

Core v1 不保存 ExperimentId、EvalId 与 SlotId 的业务映射。它也不保存 Evaluation 类型、
执行方式、Assertions、Verdict、Score、Eligibility、Plugin、Config、Conversation、
Diagnostics 或 Sources；这些都是具名 Attachment。

### Core 引用不变量

- 每个 `expectedSlots` 项最多有一个 Member；没有 Member 表示该 slot 没有已发布事实。
- Member 只能指向同一个 Record 中已有完成标识的精确 Attempt。
- Attempt 只物理存放在它的 origin Run 下，`originRunId` 必须与目录 owner 一致。
- origin Run 中每个 Attempt 恰有一个 origin Member；其它 Run 只保存 reference Member。
- writer 只能引用 write session 打开时冻结的已发布 Run，因此新 Run 不会形成未来引用或环。

`Member.kind` 不存在。采用原因属于 Run-owned Attachment；reuse planning 从它和当前 policy
形成判断，不写回 Core。

## RecordAttachment 与完整 blob closure

RecordAttachment 是挂在一个 Run 或 Attempt 上的具名、版本化数据。它不是事件流、
跨 owner 引用或开放字段袋。

```ts
type RecordAttachmentEnvelopeV1 = {
  readonly name: RecordAttachmentName;
  readonly schemaId: RecordAttachmentSchemaId;
};
```

每个 Attachment 有 exact JSON 的 `attachment.json`、`payload.json` 与零份或多份
`blobs/<opaque-key>`。同一 owner 内，一个 `RecordAttachmentName` 最多出现一次；目录
不存在表示 `unavailable`。

`RecordBlobRef` 是 package-minted opaque capability。definition 的 `blobRefs(payload)`
必须穷尽 payload 内的 refs。generic writer 只接受同一次 write builder 新建的 refs 和
对应 Stream；持久化时把它们编码为 owner-local opaque keys。

一个 closure 只有同时满足下列条件才有效：

- payload 的每个 ref 都有一个且仅有一个对应 blob key；
- 每个 blob key 都恰被 payload 的 `blobRefs` 引用一次；
- 没有手写 key、无效 ref、跨 owner ref、跨 Attachment ref 或 root 外 path；
- exact payload、envelope、key 集合与 bytes 的归属相互一致。

缺 key、多 key、重复 key、非法 ref 或任意 closure mismatch 都使该 Attachment 为
`invalid`。它们不会产生一个可用但少 blob 的 value。EIO 或 permission 则是
`RecordReadError`，因为 read Effect 无法取得并 materialize 足以形成该 durable value 的
bytes。

### 内建 RecordAttachment

| owner | RecordAttachment | 保存什么 |
|---|---|---|
| Run | `niceeval.evaluations/v1` | Slot 与 Evaluation 类型等定义期事实 |
| Run | `niceeval.membership-provenance/v1` | reference Member 的采用原因 |
| Run | `niceeval.sources/v1` | 当次输入源码与 manifest |
| Attempt | `niceeval.assertions/v1` | 规范化 AssertionResult |
| Attempt | `niceeval.verdict/v1` | 所有 Pass/Score Attempt 的四态 Verdict |
| Attempt | `niceeval.score/v1` | Score Eval 的独立得分 |
| Attempt | `niceeval.eligibility/v1` | reuse 所需的当时资格事实 |

这张表描述 owner，不要求 generic writer 知道这些名字。

### RecordAttachment projector 与读取状态

projector 只解释一个 owner 的一份 Attachment：

```text
owner + RecordAttachmentProjector
  → RecordAttachmentRead<Payload>
```

`readRunAttachment` 与 `readAttemptAttachment` 在返回 `available` 前读取、验证并
materialize 全部 blob bytes。

它们也把 decoded JSON payload 递归 deep-freeze 为 package-owned snapshot。JSON boundary
没有 native bytes。

`available` 包含该 payload 与同步、只读、完整的 `RecordAttachmentBlobs`。`bytes(ref)`
从内存 snapshot 返回 defensive copy，不触发 I/O 或 Stream。

错误或伪造 ref 同步返回 `Either.left(record-blob-handle-invalid)`，不属于
`RecordReadError`。missing directory 是 `unavailable`。

known old schema 到 current 的每条相邻边都有 converter 时是
`migration-required`。known path 命中 `not-losslessly-migratable` 边时是
`migration-unavailable`。

projector 只同步消费这个一次构成的 snapshot。它不重新打开 storage，也不获得 Stream。

unknown family 或 schema 一律是 `unsupported`。envelope、payload、ref、blob 或 schema
decode 失败是 `invalid`。验证先于 migration state，因此一个有坏 closure 的旧
Attachment 仍是 `invalid`，不是 `migration-required` 或 `migration-unavailable`。

这些状态是成功数据。Projection 原样消费它们，因此一个 Attachment 的问题不会把 Sample
的 Core state 改成 invalid。projector callback 的意外 throw 是 defect；interruption 始终
沿 Effect Cause 传播。

## Frozen view、锁与 Effect

`RecordReader` 与 `RecordWriteSession.view` 共享同一个 `FrozenRecordView` contract：
`runs`、`run`、`attempt`、`readRunAttachment` 与 `readAttemptAttachment` 都在一次
snapshot 中解释。write session 的 view 只含打开时已完成的历史 Run，不含自己的 drafts。

view、frozen Run、frozen Attempt 与 drafts 都有 nominal brand 和 runtime exact-identity
registry。来自另一个 snapshot 或 session 的 handle、伪造对象与 closed Scope 的调用返回
稳定 typed error。package registry 的内部矛盾才是 defect。

`Effect.Scope` 能约束正常调用的 composition，却不能静态证明 capability 的 generative
lifetime。每次使用都在 runtime 检查 Scope 与 exact identity，因此逃出 Scope 的 JavaScript
value 不会变成有效 handle。`RecordAttachmentValue` 是例外：它已在 read Effect 内完整
materialize，decoded JSON payload 已由 package deep-freeze，reader Scope 关闭后仍是可同步
消费、不可借 mutation 改写的自包含内存值。

锁只协调善意的 NiceEval 进程：

| 操作 | maintenance lock | writer lock |
|---|---|---|
| reader / show / view | shared | 否 |
| writer / exp | shared | exclusive |
| clean | shared | exclusive |
| migrate | exclusive | 不另取 |

reader 与 writer 可以并发。writer lock 保证只有一个进程创建 Run；完成标识保证 reader
不读取中间状态。migration 修改已发布数据，因此与其它操作互斥并在 busy 时 fail fast。

| 情况 | 表达方式 |
|---|---|
| Core、Attachment 或引用损坏 | 成功 ADT |
| incomplete Run | reader warning |
| 形成 available 前的 I/O、permission、busy、closed Scope、错误 frozen handle、旧 Core major | Effect typed error |
| `available` 后的错误或伪造 blob ref | `bytes(ref)` 的同步 `Either.left(record-blob-handle-invalid)`，不触发 I/O |
| Library 不变量、registry 矛盾或 callback throw | defect |
| fiber 取消 | interruption，保留 Cause |

平台依赖使用精确 `Context.Tag`：`RecordFileSystem`、`RecordMaintenanceLock`、
`RecordWriterLock`、`RecordEntropy`、`RecordGit` 与 `RecordMigrationRegistry`。

## 直接写入与发布状态机

`EvaluationRecordContract` 属于 Evaluation producer。它在调用 generic writer 前验证
Evaluation 的业务事实，例如 AssertionResult、Verdict、Score、Slot 映射、Sources 与
Membership Provenance。

generic writer 不验证这些领域组合，也不知道内建 Attachment 名称。它只验证 Core shape、
owner、typed definition、exact encoding、完整 owner-local blob closure 与精确引用。

一次 `RecordWriteSession` 直接写入 `runs/<RunId>/`，不使用 staging root：

1. 分配 RunId 并 exclusive create 目标目录；
2. 在 `open` draft 中写入 Run Core、origin Attempt、Member 与 typed Attachment；
3. 每个 `record<E, R>` 消费捕获的 blob Stream，并返回 `RecordWriteError | E`；
4. `publish` 同步进入 `publishing`，拒绝新 mutation，并等待在飞 mutation；
5. marker 前完成所有普通写入、Core/reference/closure validation 与 receipt 构造；
6. 用短暂 `Effect.uninterruptibleMask` final flush/close、exclusive create `complete`；
7. 同一不可中断区域把 draft 同步标为 `published` 并 consume。

状态只能是 `open → publishing → published`，或在 marker 前的 failure、defect、
interruption 后到 `failed`。`failed` draft 不可重用。finalizer 绝不删除 incomplete
directory；`niceeval clean` 是唯一的显式删除路径。

第 6 步前发生 interruption、I/O failure 或进程退出时，目录保持未完成。它不会被读取或
reuse；后续命令给出 warning，用户可用 `niceeval clean` 删除。

第 6 步后 Run 已发布。即使 fiber 在 receipt 被观察到前被 interrupt，后续 reader 仍以
`complete` 为准。`complete` 后没有可失败的业务步骤。

Scope release finalizer 只释放锁和 handle。它的失败不能返回为 typed business error，也
不能静默消失：实现保留受控 diagnostic cause 后把它作为 defect 传播。

## 显式 migration

普通 reader 只接受 current Record Core major。已知旧 major 返回
`record-migration-required`；future 或 foreign major 返回 `record-format-unsupported`。
open 从不自动改写磁盘，也不提供 compat reader。

Core migration 只注册相邻 converter：

```text
niceeval.record/v1 → niceeval.record/v2 → niceeval.record/v3
```

每个 Attachment family 也只登记相邻关系，并且每条边恰有一个 converter 或
`not-losslessly-migratable` 声明。converter 接收完整 `RecordAttachmentValue<From>`；其
source payload 是 package-owned、deep-frozen JSON snapshot，converter 不能靠 mutation
影响其它 consumer。它从只读 `bytes(ref)` 取得 source bytes，再通过新的
`RecordBlobSource` 与 target builder mint 新 refs、target Stream 和 target bytes。

converter 可以保留、删除、改名或转换 blob。old ref 与手写 path 不属于 target builder，
不能冒充 target ref。callback throw 是 defect；`Effect.fail(e)` 保留 explicit `E`；
interruption 保留 Cause。`R = never` 只表示没有 NiceEval Layer requirement，不能承诺
没有 ambient I/O。第三方 converter 是受信任 extension。

`not-losslessly-migratable` 的 Attachment 保留 exact bytes，reader 对 current family
返回 `migration-unavailable`。它不是可重试的 migration 工作，也不显示
`niceeval migrate` 提示。

### Git safety、preflight 与 sentinel

migrate 在任何写入前完成 preflight：

1. 确认 `migration.in-progress` 不存在；
2. exact decode source Core 与可识别 Attachment envelope 和 closure；
3. 找到 Core 与每个可迁移 Attachment 的完整相邻 converter 链；
4. 列出每个不可无损迁移边与 unknown Attachment；
5. 验证 ID、owner 与路径可以保持，且 target 没有 identity 或目录冲突；
6. 检查 portable root 的 Git restore point。

Git 检查要求 `.niceeval/record` 的全部内容均被当前 commit 跟踪，且工作区没有 modified、
deleted、untracked 或 ignored 内容。无法证明时，交互 CLI 必须确认；非交互调用必须传
`--yes`。preflight 失败不修改文件。

第一次修改 portable bytes 前，migration exclusive create 并 sync root 下的零字节
`migration.in-progress`。Core migration 与 Attachment-only migration 都遵循这一条。

随后写入并 sync 全部 target Core、Attachment 与 blob bytes。target `record.json` 总是
最后写入并 sync，即使其 bytes 与 source 相同。最后删除并 sync sentinel；只有这时 root
才重新可读。

sentinel 存在时，普通 open、plan 与 migrate 都返回
`record-migration-interrupted`。中断、converter failure 或 I/O failure 不自动 rollback、
不自动删除 sentinel，也不自动重跑。用户从 Git 或自己的备份恢复；Record 不另存副本、
`out` directory、compat reader 或 durable migration history。

unknown Attachment 在 Core owner 仍可表达时原样保留并保持 `unsupported`。无法保持它的
owner 时，preflight 拒绝整次 migration。`migration-unavailable` 与 `unsupported` 不可
混同，二者都不是 plan failure。

## 普通项目范围

Record v1 面向受信任用户的普通有界项目。它不定义极端规模或恶意 filesystem 协议。

JSON Attachment 是有界、自包含值。reader 在形成 value 时把 JSON payload deep-freeze，
并 materialize 完整 binary closure；内部 `Stream` 只用于 Run 目录扫描、写入、migration
与形成读取 snapshot 的 blob I/O。它不构成 Attachment value API，也不进入 Sample、
Projection 或 Report 的值。

ID 与 Attachment name 经过 portable segment codec。停稳 root 可以跨机器复制并由 current
reader 解释。

## 变化归属

| 变化 | 归属 | 是否改变 Record Core |
|---|---|---|
| Assert-first 作者 API 或 matcher 重构，但规范持久语义不变 | producer/API | 否 |
| matcher、early stop、score 算法改变 | behavior identity | 否 |
| 新增 Diagnostics 或 Plugin 数据 | 新 Attachment | 否 |
| Attachment payload、blob ref 或 closure shape 改变 | 新相邻 Attachment schema | 否 |
| typed view 改变 | 新 projector/API | 否 |
| membership 采用原因增加 | provenance Attachment | 否 |
| owner、引用、Core shape 或完成判断改变 | 新 Record major | 是，显式 migrate |

判断顺序是：先问当时持久化的事实是否改变，再问 Attachment shape 或 closure 是否改变，
最后问所有 reader 都必须理解的 Core 公理是否改变。

migration 的存在不是把业务字段写入 Core 的理由。
