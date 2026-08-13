# Record → Analysis → Report —— Library

本页定义三层组合所需的调用面。RecordAttachment definition、install / write authority、`ctx.record()` 与
converter 的完整契约仍由 [RecordAttachment 作者 API](../record-attachment-authoring/library.md) 单独拥有。

`niceeval/record` 是作者面，`niceeval/record/host` 是 authority 更强的 host 子路径。子路径只隔离导出权限；两者
仍使用同一套 Record storage、validators、locks、snapshot generations 与 writer kernel。

`RecordAttachmentDefinition` 描述 owner、版本族、current 与相邻 migration。`ctx.record()` 接受的是 current
payload；读取 `available` 后得到的 `RecordAttachmentValue` 才是 payload 与 own blob closure 的不可变自包含实例。
两者都不是整个 Record。

## Record host runtime

`niceeval/record/host` 只向 application 与 CLI host 提供 root runtime。所有 facet 都有 package-minted nominal
identity；结构相同的对象不能冒充，也不能从弱 facet 转成强 facet。

```ts
interface RecordSnapshotSource {
  readonly withSnapshot: <A, E, R>(
    use: (view: FrozenRecordView) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | RecordOpenError | RecordReadError, R>;
}

interface RecordInvocationAccess extends RecordSnapshotSource {
  readonly withWriteSession: <A, E, R>(
    use: (session: RecordWriteSession) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | RecordOpenError | RecordWriteError, R>;
}

type RecordMigrationPlanning = () => Effect.Effect<
  RecordMigrationPlan,
  RecordMigrationPlanError,
  never
>;

type RecordMigrationExecution = (input: {
  readonly plan: RecordMigrationPlan;
  readonly authorization:
    | { readonly state: "git-restore-point" }
    | { readonly state: "accept-data-loss" };
}) => Effect.Effect<
  RecordMigrationReceipt,
  RecordMigrationError,
  never
>;

interface RecordMaintenanceAccess {
  readonly inspect: RecordMaintenanceInspect;
  readonly clean: RecordClean;
  readonly planMigration: RecordMigrationPlanning;
  readonly migrate: RecordMigrationExecution;
}

interface RecordAccessRuntime {
  readonly snapshots: RecordSnapshotSource;
  readonly invocation: RecordInvocationAccess;
  readonly maintenance: RecordMaintenanceAccess;
}

declare const openRecordAccessRuntime: (input: {
  readonly root: RecordRoot;
}) => Effect.Effect<
  RecordAccessRuntime,
  RecordAccessRuntimeOpenError,
  Scope.Scope | RecordFileSystem | RecordMaintenanceLock |
    RecordWriterLock | RecordEntropy
>;
```

`openRecordAccessRuntime()` 只绑定 canonical root 与本地资源。真正读取、写入或维护发生在 facet 的 child Scope；
outer runtime 空闲时不持有 maintenance lease。

runtime 已绑定 root、filesystem、lock authority 与 installed registry，因此 `planMigration()` 不再接收另一个 root，
`migrate()` 也只接受由同一 runtime mint 的 opaque plan。plan 绑定的 root snapshot、registry 或 Git inspection 变化后，
execution 返回 `record-migration-plan-stale`；调用者不能把另一个 runtime 的 plan 结构性拼进来。

`RecordInvocationAccess` 是写入加 snapshot 的强 facet。Invocation 可以在 write session 内用 `session.view` 做 reuse
planning，也可以在 session 关闭后通过继承的 `withSnapshot()` 打开 fresh view。

## Producer 写入面

第三方作者只使用 `niceeval/record` 的 `defineRecordAttachment()`、producer write grant 与 owner-local
`ctx.record()`。内建 package 使用私有 official definition、显式 built-in grant 与 package-private
`ctx.recordEffect()`。

两种 facade 都提交同一个 canonical command：

```text
definition + encoded domain payload + owner-local context lease
  → exact-grant admission
  → owner/name reservation
  → immutable plain-data snapshot
  → blob closure validation
  → tracked Effect command
  → generic writer
```

`ctx.recordEffect()` 不是第二个 writer。它只让 Effect-native 内建 producer 进入同一 command kernel，并保持
typed failure、defect、interruption 与 Scope 生命周期。

## Analysis：唯一 Projection 执行入口

一个 `RecordAttachmentProjector` 先绑定某个 owner 的只读 family，再由三种 factory 固定 logical access：

```ts
declare const attemptSlotProjection: <Value>(
  projector: RecordAttachmentProjector<"attempt", Value>,
) => RecordProjection<"attempt-slot", Value>;

declare const attemptOriginRunProjection: <Value>(
  projector: RecordAttachmentProjector<"run", Value>,
) => RecordProjection<"attempt-origin-run", Value>;

declare const selectedRunProjection: <Value>(
  projector: RecordAttachmentProjector<"run", Value>,
) => RecordProjection<"selected-run", Value>;
```

PLAN-1 只有一个公开执行 primitive：

```ts
declare const projectAnalysisSample: <
  Access extends ProjectionAccess,
  Value,
>(input: {
  readonly sampleHandle: AnalysisSampleHandle;
  readonly projection: RecordProjection<Access, Value>;
}) => Effect.Effect<
  ProjectedSample<Access, Value>,
  RecordReadError | ProjectionLimitError
>;
```

普通 Analysis 脚本可以用普通控制流决定下一次调用。每次调用从同一个 `AnalysisSampleHandle` 绑定的 frozen view
读取，返回 closed `ProjectedSample`；它不新建 snapshot、generation 或 maintenance lease。

## Analysis：Relations 与 Derivation

关系定义是可复用纯值，执行只消费 closed projections：

```ts
type RelationAssembler<Inputs, Cell> = (
  inputs: SameSample<Inputs>,
) => ExhaustiveRelationValue<Cell>;

declare function defineRelationAssembler<Inputs, Cell>(input: {
  readonly inputs: ProjectionShape<Inputs>;
  readonly assemble: RelationAssembler<Inputs, Cell>;
}): RelationAssemblerDefinition<Inputs, Cell>;

declare function executeRelationAssembler<Inputs, Cell>(input: {
  readonly definition: RelationAssemblerDefinition<Inputs, Cell>;
  readonly projections: Inputs;
}): Effect.Effect<
  ExhaustiveRelationValue<Cell>,
  RelationInputError | RelationOutputError
>;
```

host 在调用 assembler 前核对 SameSample identity，返回后核对完整 population。unmatched、ambiguous、input
state 与 relation coverage 是成功值中的数据，不能靠少返回 cell 缩小分母。

Derivation 使用普通函数，并返回普通 TypeScript value。值若声称具有统计或完整度口径，其具名 shape 必须显式携带
observed、denominator、state、issues 与 refs。host 不从 Projection coverage 猜业务分母，也不要求不存在的 metric
constructor。

## Report 的 consumer-local input manifest

`reportInputs()` 只属于 `niceeval/report`。它保存有限的 `RecordProjection` declarations，让 Report host 在任何
Page、Calculation 或 renderer callback 前执行同一个 `projectAnalysisSample()` kernel。

```ts
const inputs = reportInputs({
  assertions: attemptSlotProjection(assertionsProjector),
  diff: attemptSlotProjection(agentWorkspaceDiffProjector),
});
```

manifest 不是通用 Projection graph。它没有节点依赖、runtime branch、graph brand 或公开 scheduler。Report host
可以去重相同 declaration identity，但去重次数、verified-cache hit 与物理读取次数都不可观察。

Report host 无条件保留 Sample denominator、ProjectedSample entries、Attachment 六态、coverage、migration 提示与
execution problems。作者 callback 只能消费已经形成的 closed values；不能再调用 reader、projector 或 migration。

## Capability 可见性

| 调用者 | 可见 capability | 明确不可见 |
|---|---|---|
| application / CLI host | 与任务匹配的 runtime facet | producer context 内部 grant |
| Invocation coordination | `RecordInvocationAccess` | raw path、maintenance converter internals |
| Eval / Experiment / linked Plugin occurrence | owner-local `ctx.record()` | root runtime、owner-wide allowlist、official writable definitions |
| built-in domain adapter | 私有 definition、built-in grant、`ctx.recordEffect()` | generic draft、raw writer bypass |
| Analysis | `AnalysisSampleHandle`、Projection 与 closed values | write session、maintenance facet、path |
| Report author callback | manifest 已形成的 closed values | `FrozenRecordView`、Sample handle、reader 与 migration |
