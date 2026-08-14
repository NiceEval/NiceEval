# Record Host SDK（事实持久化宿主开发工具包）

本页是 `niceeval/record/host` 的单一契约。Record Model 拥有 schema、identity、已封口事实、RecordAttachment 与 Artifact；Record Host SDK 提供 snapshot、write 与 maintenance，并在实现内部管理锁、迁移、恢复和 verified cache。
普通应用作者不导入本页的写入或维护能力；他们只从 `niceeval` 使用 Assertion-first API。完整路径见 [Use Case](use-case/README.md)。

Record Host SDK 是 ① Record 的宿主调用面，不是第四层，也不提供 `niceeval/lock`、`ProgramStateSDK` 或 `LockSDK`。
只有 Application Host 可以使用它的 Scope-bound（绑定资源作用域）capability。

## 一条事实怎样定义、写入和保存

普通 Eval 作者用 Assertion API，不定义持久格式。领域 SDK 作者只能声明平台允许的 Metric、Score 或 Artifact token（数值、评分或材料令牌）；Record Model 仍拥有物理 schema。

```ts
const trajectory = defineArtifactCapture({
  id: "com.example.agent-trajectory",
  mediaType: "application/vnd.example.trajectory+json",
  required: true,
});
```

Application Host 打开一个 write facet（写入分权面）。Runner 为正在执行的 Attempt 签发受限 Capture；领域代码只封口已声明 token 对应的值：

```ts
const write = yield* record.write({ root, run });
const capture = yield* write.capture({ attempt });

const trajectoryRef = yield* capture
  .artifact(trajectory)
  .seal({ content: trajectoryBytes, evidence: evidenceRefs });

yield* write.sealRun({ run, attempts: [attempt], refs: [trajectoryRef] });
```

保存后不是一张任意扩展的 JSON（结构化数据）表，而是 owner-local attachment（归属者局部附件）与闭合材料引用：

```text
sealed Run Core（已封口运行核心）
└─ Attempt owner（单次执行归属者）
   └─ RecordAttachment
      ├─ SchemaId
      ├─ producer / definition identity
      ├─ typed payload（类型化载荷）
      └─ ArtifactRef ──▶ content-addressed blob（内容寻址材料）
```

小型结构化值放在 attachment payload；大型文本、二进制、图片和多文件 diff（差异）放入 blob，payload 只保留精确引用、媒体类型、大小和完整度状态。`sealRun()` 验证全部 owner、基数和引用闭包后原子发布。

## 一份旧 Record 怎样迁移

普通读取只接受当前 schema，不带历史 reader compatibility（读取兼容分支）。迁移由 Application Host 调用 `maintenance.migrate()`，其内部使用 Record Host SDK 的窄维护 facet：

```text
maintenance().inspect() / planMigrate()
        │ 释放 exclusive maintenance lock（独占维护锁）
        ▼
authorizationPort.authorize(plan summary)
        │
        ▼
maintenance().inspect() / applyMigrate()
        │ 重新检查 root、源格式和迁移集合
        ▼
Current Record（当前格式事实集）
```

转换只读取旧 Record 已保存的完整值，不能从工作目录、网络或运行中的 Adapter 补事实。staging validation（暂存区校验）失败时保留 source Record，不发布半成格式。

## 谁调用什么

| 角色 | 调用面 | 可以做什么 | 不能做什么 |
|---|---|---|---|
| 普通 Eval 作者 | `niceeval` | 在结果出现处登记 Assertion | 打开 Record、取得 writer、选择 SchemaId 或写入任意数据 |
| Assertion runtime | 内部 `AssertionCapture` | 封口 AssertionResult 与 Evidence | 选择其它 owner 或绕过完整度检查 |
| 官方 Adapter | 内部 `AdapterCapture` | 封口 OTel、Evidence、文件差异与官方诊断 | 注册任意附件、选择 blob key 或安装 converter |
| 领域 SDK | `niceeval/capture` | 声明固定 Metric、Score、Artifact token 并封口对应信封 | 定义任意持久化 JSON schema、直接写附件或提供迁移代码 |
| Application Host | `niceeval/record/host` | 在应用操作中取得快照、写入或维护 facet | 把 capability 传给 CLI、普通作者、Adapter 或 Report callback |

所有 Capture（采集能力）都是 Attempt-bound（绑定单次执行）且 token-bound（绑定声明 token）的能力。
它们没有全局入口，不能跨 Attempt、Run 或异步生命周期继续使用。

### Application Host 路由

CLI handler 只调用 `niceeval/application/host` 的 Application API（应用程序接口）。Application Host 在这些操作内部按需要使用 Record Host SDK；CLI 不直接取得该 SDK。

| Application Host 操作 | 使用的 Record Host SDK facet | 可见结果 |
|---|---|---|
| `experiments.list()` | 无 | 已加载的 Experiment 定义摘要 |
| `experiments.plan()` | `snapshot()` | 当前 sealed Record 的冻结视图与 reuse / gap 计划输入 |
| `experiments.run()` | `write()` / `capture()` | 新 Run 的写入与封口 |
| `experiments.accept()` | `write()` 的冻结 `view` | 同一锁作用域内完成预检与受控采用 |
| `reports.show()`、`reports.serve()`、`reports.export()` | `snapshot()` | 用于 Analysis 与 Report 的冻结事实 |
| `maintenance.migrate()` | 两次有界 `maintenance()` | 计划后释放锁、请求授权、重新取得锁并复检后迁移 |

## 受限 Capture

Application Host 先取得 write facet，再由 runner 为 Assertion runtime 和 Adapter mint 同一份受限能力。
Adapter 只使用这个 Capture，不直接调用 Record Host SDK。每个方法都对应一个固定信封，
而不是接收任意 key、JSON 或文件路径的写入器。

```ts
interface AttemptCapture {
  sealAssertion(input: AssertionResultCapture): Effect.Effect<void, CaptureError>;

  sealOtel(input: OTelCapture): Effect.Effect<void, CaptureError>;
  sealEvidence(input: EvidenceCapture): Effect.Effect<EvidenceRef, CaptureError>;
  sealFileDiff(input: FileDiffCapture): Effect.Effect<void, CaptureError>;

  metric<Token extends MetricCaptureToken>(
    token: Token,
  ): MetricCaptureSealer<Token>;

  score<Token extends ScoreCaptureToken>(
    token: Token,
  ): ScoreCaptureSealer<Token>;

  artifact<Token extends ArtifactCaptureToken>(
    token: Token,
  ): ArtifactCaptureSealer<Token>;
}
```

`sealAssertion()` 只接受已完成的 AssertionResult。`sealOtel()`、`sealEvidence()` 与
`sealFileDiff()` 只接受官方封闭输入。它们会归一化身份、脱敏、限制数量与大小，并把材料放入所属附件的 closure（引用闭包）。

领域 SDK 先在定义期建立 token：

```ts
declare function defineMetricCapture(
  input: MetricCaptureDefinition,
): MetricCaptureToken;

declare function defineScoreCapture(
  input: ScoreCaptureDefinition,
): ScoreCaptureToken;

declare function defineArtifactCapture(
  input: ArtifactCaptureDefinition,
): ArtifactCaptureToken;
```

token 固定 definition、producer identity、`required`、有限 label 或 rubric 集合，以及每个 Attempt 的封口义务。
`metric(token).seal()`、`score(token).seal()` 与 `artifact(token).seal()` 只接收各自固定的 seal input。
它们不能接受未经声明的新字段、自由可查询 metadata 或其它附件的写入权。

Capture 在封口时由 host 一次验证下列关系：

- token 属于正在执行的 Attempt 与声明它的 Eval 或 Plugin；
- owner、definition snapshot 与 producer snapshot 与注册时完全一致；
- Metric coordinate、Score rubric、Artifact item 与 Evidence ref 的 cardinality 合法；
- required token 恰好封口一次，optional token 也不能漏封、重复、越界或延后封口；
- 每个 blob、Artifact 与 Evidence 引用都闭合在所属附件中。

任何检查失败都返回 `capture-obligation-violation` 或 `capture-input-invalid`。host 不会保留一条已接受、
却缺少配对材料或 owner 的半成事实。

## `RecordHostSDK`

`RecordHostSDK` 只由 Application Host 在应用操作内部使用。它按 snapshot、write/capture 和 maintenance 分权。Model 不取得运行资源；SDK 不改变 Model 的持久语义。

```ts
interface RecordHostSDK {
  write(input: RecordWriteRequest): Effect.Effect<
    RecordWriteAccess,
    RecordWriteOpenError
  >;

  snapshot(input: RecordSnapshotRequest): Effect.Effect<
    CurrentRecordSnapshot,
    RecordSnapshotOpenError
  >;

  maintenance(input: RecordMaintenanceRequest): Effect.Effect<
    RecordMaintenanceAccess,
    RecordMaintenanceOpenError
  >;
}
```

三个方法都建立 Scope-bound（绑定资源作用域）facet。调用者没有 acquire 或 release 锁的 API；Scope finalizer
在 facet 关闭时释放所有内部资源。

`snapshot()` 自动取得 shared maintenance lock。Application Host 仅在 plan、show、serve
或 export 操作内部使用它，并把已封口 Run 的冻结视图交给后续内部流程。Analysis host 从它构造 Sample；
Report host 只消费 Analysis 的闭合输出。两者都不取得 writer、Capture 或 maintenance capability。

`write()` 自动取得 shared maintenance lock 和 exclusive writer lock。Application Host 仅在 run 或 accept
操作内部使用它，并建立一个 Run draft。`capture()` 属于这个 write facet，自动继承同一组锁，为实际 Attempt mint
`AttemptCapture`。它们在全部 owner-local（归属者内）附件通过验证后发布完整 Run，不能修改已封口 Run。

`maintenance()` 自动取得 exclusive maintenance lock。Application Host 仅在 migrate 操作内部使用它，
可以检查格式、形成迁移计划、应用获授权的计划及恢复中断的维护操作。它不能把维护能力交给 CLI、SDK、Adapter 或普通作者。

```ts
interface RecordWriteAccess {
  readonly view: FrozenRecordSnapshot;
  capture(input: AttemptDraftInput): Effect.Effect<
    AttemptCapture,
    RecordWriteError
  >;
  sealRun(input: RunSealInput): Effect.Effect<
    RecordSealReceipt,
    RecordWriteError
  >;
}

interface RecordMaintenanceAccess {
  inspect(): Effect.Effect<RecordFormatInspection, RecordMaintenanceError>;
  planMigrate(): Effect.Effect<RecordMigrationPlan, RecordMaintenanceError>;
  applyMigrate(
    plan: RecordMigrationPlan,
    authorization: RecordMigrationAuthorization,
  ): Effect.Effect<RecordMigrationReceipt, RecordMigrationError>;
}
```

`sealRun()` 是发布点。它先等待所有 Attempt Capture 停稳，再验证 owner、definition、producer、cardinality、
引用闭包与 Run 级附件。全部通过后才原子出现新的 sealed Record 状态；失败、中断或未封口义务都不会发布该 Run。

### 恢复与 verified Record cache

SDK 内部恢复只处理它自己留下的中断维护或未完成写入状态。它依据 durable session（持久会话）与发布标识的
穷尽组合，完成已经可证明的发布，或保留未完成状态供显式维护处理。它不会重新执行 Agent、Sandbox 或外部命令，
也不会从当前工作目录补齐事实。

verified Record cache 归 SDK 内部实现。它以精确 Record 内容身份缓存已验证的 Core、附件与 Artifact bytes，
并在 snapshot generation（快照代）结束时失效。cache 不保存 live Capture、writer、lock 或 maintenance authority。
Analysis executor（分析执行器）的 query 与 field 结果属于 Analysis execution cache，不进入 Record Host SDK。

## Attachment、Artifact 与文件差异状态

`RecordAttachment` 的读取状态表达整份附件能否形成可信快照：

```ts
type RecordAttachmentState =
  | { readonly state: "available" }
  | { readonly state: "unavailable"; readonly reason: AttachmentAbsenceReason }
  | { readonly state: "invalid"; readonly issues: readonly RecordIssue[] }
  | { readonly state: "unsupported"; readonly schemaId: SchemaId }
  | { readonly state: "migration-required"; readonly operation: "maintenance.migrate" }
  | { readonly state: "migration-unavailable"; readonly reason: string };
```

`available` 代表 envelope、payload 与全部引用闭包都已验证。`unavailable` 表示该 owner 没有这份数据族。
`invalid` 表示持久形状或闭包损坏。`unsupported` 表示 reader 不认识该 SchemaId。后两种 migration 状态只说明
已知旧形状与当前形状的关系，不能伪装成 `unavailable`。

Artifact 的材料状态与附件读取状态分开：

```ts
type ArtifactMaterialState =
  | { readonly state: "inline"; readonly mediaType: string; readonly content: string }
  | { readonly state: "blob"; readonly ref: ArtifactRef; readonly mediaType: string }
  | { readonly state: "partial"; readonly limitation: MaterialLimitation }
  | { readonly state: "elided"; readonly reason: ElisionReason }
  | { readonly state: "unavailable"; readonly reason: ArtifactAbsenceReason };
```

`partial` 与 `elided` 始终在读取结果和上层呈现中可见。它们不能被改写成空字符串、空数组或正常的零值。

文件差异的 metadata 总在附件 payload 中内联。内容状态遵守固定形状：

```ts
type FileDiffContent =
  | { readonly state: "inline"; readonly encoding: "utf-8"; readonly patch: string }
  | { readonly state: "artifact"; readonly ref: ArtifactRef }
  | { readonly state: "partial"; readonly limitation: DiffLimitation }
  | { readonly state: "elided"; readonly reason: DiffElisionReason }
  | { readonly state: "unavailable"; readonly reason: DiffAbsenceReason };
```

`inline` 只用于小型、完整、单文件 UTF-8 patch。大型、二进制或多文件差异使用 `artifact`，
由 Artifact blob 保存材料。`partial` 必须说明未采集的范围；`elided` 必须说明省略原因和已知大小。

## SchemaId 与迁移

SchemaId 同时冻结附件的 shape、owner 与语义。它不是显示版本，也不是 producer version。
producer 行为改变而持久语义不变时，保持 SchemaId；payload、引用闭包或语义改变时，发布相邻 SchemaId。

平台维护相邻格式边。一个迁移步骤只读取旧附件的完整冻结值，再构造新的 owner-local 附件；
它不能从当前工作目录、网络、另一附件或运行中的 Adapter 补齐事实。

第三方 SDK 不注册 converter。平台对已知格式提供迁移，未知附件只在能够无损保留时随根整体携带。
无法无损保留时，计划失败而 source Record 保持不变。

| error code | 含义 | 下一步 |
|---|---|---|
| `migration-required` | 已知旧格式有完整的相邻路径 | 调用 Application Host 的 `maintenance.migrate(request, authorizationPort)` |
| `migration-unavailable` | 已知旧附件没有无损路径 | 保留旧数据；从原始材料重新产生当前事实，或明确该结果不可用于当前 Analysis |
| `migration-interrupted` | 维护过程在发布前中断 | 从恢复点恢复，再重新形成计划 |
| `migration-plan-stale` | root、格式或已安装迁移集合已变化 | 重新运行迁移预检 |
| `record-format-unsupported` | 格式来自未来或其它系统 | 使用能理解该格式的工具 |

普通读取、Analysis 与 Report 遇到 `migration-required` 都停止在 Record 边界。它们不会自动改盘，
也不会把旧附件组成历史类型联合。
