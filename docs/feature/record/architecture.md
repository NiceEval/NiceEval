# Record 架构

Record 只保存已经发布的运行事实。它冻结身份、owner、精确引用和发布结构；业务事实全部是版本化的 `RecordAttachment`。

Record 不包办执行、沿用、分析或报告。Assert-first API、Plugin、reuse planning、Calculation 和页面可以演进，不因此扩张 Record Core。

## 两个物理边界

| 边界 | 内容 | 是否携带与进 Git |
|---|---|---|
| portable Record | `record.json`、已完成 Run、Core 与 `RecordAttachment` | 可以整体复制或纳入 Git |
| local operation state | session、maintenance lock、writer lock 与 cache | 不属于 Record；不复制、不分享、不进 Git |

默认 portable root 是 `<project>/.niceeval/record/`。Library 的 `root` 参数表示实际 Record root。

未完成 Run 的目录可能短暂出现在 portable root，但它不是 portable Record 的逻辑成员。复制或 Git 操作遇到它时，目标 reader 同样忽略它并给出 `incomplete-run` warning。

锁由平台为同一个 canonical root 协调。锁不进入 Record format，也不构成用户之间的安全边界。

## 什么叫事实

事实不等于未经计算的原始输入。一个值可以进入 Record，前提是它描述当次已经发生、观察或决定的结果；离线复核不能可靠地从当前源码重新得到它；它有明确 owner 和 schema identity；producer 在 Run 完成前已经形成它。

因此 AssertionResult、Verdict、Score、Eligibility、Conversation 与 Diagnostics 都可以是事实。通过率、latest selection、reuse gap 和页面 route 由上层重新计算。

Record 只保证结构可验证，不保证 producer 的业务判断真实。一个完整 Run 仍可能含错误 Verdict；这与磁盘损坏是两件事。

## 三个演进边界

```text
behavior identity
  Assert-first、Plugin、matcher、reuse policy
                 │ 持久语义不变
                 ▼
RecordAttachment schema identity
  一个 owner-local payload 的 shape 与语义
                 │ Core 公理不变
                 ▼
Record format identity
  owner、引用、目录、完成标识与 Core shape
```

| identity | 冻结什么 | 何时换 identity |
|---|---|---|
| behavior identity | 当前输入、配置与沿用安全语义 | 可观察行为或 reuse 条件改变 |
| `RecordAttachmentSchemaId` | 一份 RecordAttachment payload 的 shape 与语义 | payload shape 或解释改变 |
| `RecordFormatId` | Core、owner、引用、目录与完成判断 | 任一 Core 公理改变 |

RecordAttachment projector 是代码，不是 durable identity。它只解释一个明确 owner 的一个 RecordAttachment；不选择 Run、不计算通过率，也不判断 reuse。

## Durable Record 布局

```text
record/
├─ record.json
└─ runs/
   └─ <RunId>/
      ├─ run.json
      ├─ members/
      │  └─ <SlotId>.json
      ├─ attempts/
      │  └─ <AttemptId>/
      │     ├─ attempt.json
      │     └─ attachments/
      │        └─ <RecordAttachmentName>/
      │           ├─ attachment.json
      │           ├─ payload.json
      │           └─ blobs/**
      ├─ attachments/
      │  └─ <RecordAttachmentName>/
      │     ├─ attachment.json
      │     ├─ payload.json
      │     └─ blobs/**
      └─ complete
```

`complete` 是零字节文件。writer 在关闭并 flush Run 的全部其它 durable 内容后，最后以 exclusive create 建立它。它是唯一的发布信号，不是 hash，也不验证内容。

完成标识存在后 writer 不再修改该 Run。reader 在实际读取时仍会精确验证 Core、引用与每个请求的 RecordAttachment。

### 完成标识与局部隔离

reader 枚举 `runs/` 时先检查完成标识：

| 现场 | 公开结果 |
|---|---|
| 没有 `complete` | 不算 Run；从 candidates、Sample 与 reuse 中排除，并返回 `incomplete-run` warning |
| `complete` 存在，Core 有效 | 可读 published Run |
| `complete` 存在，Core 无效 | 该 Run 是 `RecordCoreRead.core-invalid` |
| Core 有效，某个 RecordAttachment 无效 | 只有该 RecordAttachment 是 invalid |

显式选择未完成目录对应的 RunId 时，它仍不是已发布 Run。selection 返回 `not-recorded`，并保留 root 级 `incomplete-run` warning。

`niceeval clean` 取得 writer lock 后列出未完成目录。确认后只删除仍然没有完成标识的目录；有完成标识但 Core invalid 的 Run 不属于 clean 范围。

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

Core v1 不保存 ExperimentId、EvalId 与 SlotId 的业务映射。

它也不保存 Evaluation 类型、执行方式、Assertions、Verdict、Score、Eligibility、Plugin、Config、Conversation、Diagnostics 或 Sources。这些都是具名 RecordAttachment。

### Core 引用不变量

- 每个 `expectedSlots` 项最多有一个 Member；没有 Member 表示该 slot 没有已发布事实。
- Member 只能指向同一个 Record 中已有完成标识的精确 Attempt。
- Attempt 只物理存放在它的 origin Run 下，且 `originRunId` 必须与目录 owner 一致。
- origin Run 中每个 Attempt 恰有一个 origin Member；其它 Run 只保存 reference Member，不复制 Attempt。
- writer 只能引用 write session 打开时冻结的已发布 Run，因此新 Run 不会形成向未来引用或环。

`Member.kind` 不存在。采用原因属于 Run-owned RecordAttachment；reuse planning 从它和当前 policy 形成判断，不写回 Core。

## RecordAttachment

RecordAttachment 是挂在一个 Run 或 Attempt 上的具名、版本化数据。它不是事件流、跨 owner 引用或开放字段袋。

```ts
type RecordAttachmentEnvelopeV1 = {
  readonly name: RecordAttachmentName;
  readonly schemaId: RecordAttachmentSchemaId;
};
```

每个 RecordAttachment 都有 exact JSON 的 `attachment.json` 与 `payload.json`。同一 owner 内，一个 `RecordAttachmentName` 最多出现一次；目录不存在表示 unavailable。

RecordAttachment definition 同时拥有 exact JSON encoder 与 decoder。payload 可以保存对同一 RecordAttachment 目录中 `blobs/**` 的引用。writer 验证这个 owner-local closure；blob 不能引用其它 RecordAttachment、其它 owner 或 root 外路径。

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

projector 只解释一个 owner 的一个 RecordAttachment：

```text
owner + RecordAttachmentProjector
  → RecordAttachmentRead<Value>
```

```ts
type RecordAttachmentRead<Value> =
  | { readonly state: "available"; readonly value: Value }
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

- missing directory 是 `unavailable`；
- 已知旧 schema 到 current 的每条相邻边都有 converter 时是 `migration-required`；
- 已知旧 schema 的路径命中 `not-losslessly-migratable` 边时是 `migration-unavailable`；
- unknown family 或 schema 一律是 `unsupported`；
- envelope、payload、blob 或 schema decode 失败是 `invalid`。

这些状态是成功数据。Projection 原样消费它们，因此一个 RecordAttachment 的问题不会把 Sample 的 Core state 改成 invalid。projector callback 的意外 throw 是 defect；interruption 始终沿 Effect Cause 传播。

## 写入与发布

`EvaluationRecordContract` 属于 Evaluation producer。它在调用 generic writer 前验证 Evaluation 的业务事实，例如 AssertionResult、Verdict、Score、Slot 映射、Sources 与 Membership Provenance。

generic writer 不验证这些领域组合，也不知道内建 RecordAttachment 名称。它只验证 Core shape、owner、typed definition、exact encoding、owner-local blob closure 和精确引用。

一次 `RecordWriteSession` 在 Scope 内取得 shared maintenance lock 与 exclusive writer lock。它冻结打开时已经完成的 Run，供 reuse planning 使用。新 Run 直接写入 `runs/<RunId>/`：

1. 分配 RunId 并 exclusive create 目标目录；
2. 写入 Run Core、origin Attempt、Member 与 typed RecordAttachment；
3. 验证 generic writer 的结构不变量；
4. 关闭并 flush 已写文件；
5. 最后 exclusive create 零字节 `complete`；
6. 返回 receipt，并永久 consume draft。

第 5 步以前发生 interruption、I/O failure 或进程退出时，目录保持未完成。它不会被读取或 reuse；后续命令给出 warning，用户可用 `niceeval clean` 删除。

第 5 步以后 Run 已发布。即使调用 fiber 在 receipt 返回前被 interrupt，后续 reader 仍以完成标识为准。

## Reader、锁与 Effect

锁只协调善意的 NiceEval 进程：

| 操作 | maintenance lock | writer lock |
|---|---|---|
| reader / show / view | shared | 否 |
| writer / exp | shared | exclusive |
| clean | shared | exclusive |
| migrate | exclusive | 不另取 |

reader 与 writer 可以并发。writer lock 保证只有一个进程创建 Run；完成标识保证 reader 不读取中间状态。migration 修改已发布数据，因此与其它操作互斥并在 busy 时 fail fast。

文件、锁、Scope、I/O 与 interruption 进入 Effect。平台依赖使用精确 `Context.Tag`：`RecordFileSystem`、`RecordMaintenanceLock`、`RecordWriterLock`、`RecordEntropy`、`RecordGit` 和 `RecordMigrationRegistry`。

reader 不要求 entropy，普通 read 不要求 writer capability。Effect 只在 CLI/application 边界运行；内部不得调用 `Effect.runPromise` 或建立第二套 runtime。

| 情况 | 表达方式 |
|---|---|
| Core、RecordAttachment 或引用损坏 | 成功 ADT |
| incomplete Run | reader warning |
| I/O、权限、busy、closed Scope、旧 Core major | Effect typed error |
| Library 不变量破坏 | defect |
| fiber 取消 | interruption |

## 显式 migration

普通 reader 只接受 current Record Core major。已知旧 major 返回 `record-migration-required`；future 或 foreign major 返回 `record-format-unsupported`。open 从不自动改写磁盘。

Core migration 只注册相邻 converter：

```text
niceeval.record/v1 → niceeval.record/v2 → niceeval.record/v3
```

每个 RecordAttachment family 也为它声明的相邻版本关系登记且只登记一种边：

```text
niceeval.verdict/v1 → converter → niceeval.verdict/v2
niceeval.sources/v2 → not-losslessly-migratable → niceeval.sources/v3
```

family 缺少相邻边、重复边、分叉或跳过版本时无效。converter 只能读取 exact old value，确定性地产生 exact new value；它不能读取当前 Eval、项目源码、网络或进程变量，也不能重新运行业务算法。

新字段无法从旧事实得到时，target schema 可以如实表达 legacy unavailable。否则边必须声明 `not-losslessly-migratable`。migrate 保留原 RecordAttachment bytes；reader 对请求 current family 的 consumer 返回 `migration-unavailable`，而不伪造值。

unknown RecordAttachment 在 Core owner 仍可表达时原样保留。它始终是 `unsupported`，不能被重新标为 `migration-unavailable`。

### Git safety 与 preflight

migrate 在第一次写入前完成全部 preflight：

1. exact decode source Core 与可识别的 RecordAttachment envelope；
2. 找到 Core 和每个可迁移 RecordAttachment 的完整相邻 converter 链；
3. 列出每个 `not-losslessly-migratable` 边和 unknown RecordAttachment；
4. 验证 ID、owner 与路径可以保持，且目标没有 identity 或目录冲突；
5. 检查 portable root 的 Git restore point。

Git 检查要求 `.niceeval/record` 的全部内容均被当前 commit 跟踪，且工作区没有 modified、deleted、untracked 或 ignored 内容。无法证明时，交互 CLI 必须确认；非交互调用必须传 `--yes`。

preflight 失败不修改文件。migrate 原地取得 exclusive maintenance lock，并按相邻步骤写出有效下一版本。某一步中断后，普通 reader 拒绝解释混合 root；用户从 Git 或自己的备份恢复。

迁移不创建新 Run，不改变仍表示同一对象的 RecordId、RunId、SlotId 或 AttemptId，也不保存 durable migration history。

## 普通项目范围

Record v1 面向受信任用户的普通有界项目。它不定义极端规模或 hostile filesystem 协议。

JSON RecordAttachment 是有界、自包含值。内部 `Stream` 只用于 Run 目录扫描和 blob I/O；它不构成 RecordAttachment payload API，也不进入 Sample、Projection 或 Report 的值。

ID 与 RecordAttachment name 经过 portable segment codec。blob reference 只能留在所属 RecordAttachment 的目录 closure 内；停稳 root 可以跨机器复制并由 current reader 解释。

## 变化归属

| 变化 | 归属 | 是否改变 Record Core |
|---|---|---|
| Fact-first → Assert-first | producer/API | 否 |
| matcher、early stop、score 算法改变 | behavior identity | 否 |
| 新增 Diagnostics 或 Plugin 数据 | 新 RecordAttachment | 否 |
| RecordAttachment payload shape 改变 | 新相邻 RecordAttachment schema | 否 |
| typed view 改变 | 新 projector/API | 否 |
| membership 采用原因增加 | provenance RecordAttachment | 否 |
| owner、引用、Core shape 或完成判断改变 | 新 Record major | 是，显式 migrate |

判断顺序是：先问当时持久化的事实是否改变，再问 RecordAttachment shape 是否改变，最后问所有 reader 都必须理解的 Core 公理是否改变。

migration 的存在不是把业务字段写入 Core 的理由。
