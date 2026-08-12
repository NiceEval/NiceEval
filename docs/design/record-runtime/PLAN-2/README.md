# PLAN-2：统一 RecordAccessRuntime substrate

application/CLI host 为 canonical Record root 建立一个 outer `RecordAccessRuntime`。它统一 root identity、runtime
registry、private snapshot generation allocator、lock authority 与 exact-content verified cache，但不长期持有
maintenance lease。

业务 consumer 不接收 runtime。host 从同一 underlying identity 取得不同 nominal facets，再把
`FrozenRecordView` 或更窄 capability 交给 reuse planning、Analysis 与 Report execution。

## Host facets

```ts
declare const recordAccessRuntimeTypeId: unique symbol;
declare const recordSnapshotSourceTypeId: unique symbol;
declare const recordInvocationAccessTypeId: unique symbol;
declare const recordMaintenanceAccessTypeId: unique symbol;

interface RecordSnapshotSource {
  readonly [recordSnapshotSourceTypeId]: typeof recordSnapshotSourceTypeId;
  readonly withSnapshot: <A, E, R>(
    use: (view: FrozenRecordView) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | RecordOpenError | RecordReadError, R>;
}

interface RecordInvocationAccess extends RecordSnapshotSource {
  readonly [recordInvocationAccessTypeId]: typeof recordInvocationAccessTypeId;
  readonly withWriteSession: <A, E, R>(
    use: (session: RecordWriteSession) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | RecordOpenError | RecordWriteError, R>;
}

interface RecordMaintenanceAccess {
  readonly [recordMaintenanceAccessTypeId]: typeof recordMaintenanceAccessTypeId;
  readonly inspect: RecordMaintenanceInspect;
  readonly clean: RecordClean;
  readonly planMigration: RecordMigrationPlanning;
  readonly migrate: RecordMigrationExecution;
}

interface RecordAccessRuntime {
  readonly [recordAccessRuntimeTypeId]: typeof recordAccessRuntimeTypeId;
  readonly snapshots: RecordSnapshotSource;
  readonly invocation: RecordInvocationAccess;
  readonly maintenance: RecordMaintenanceAccess;
}

declare const openRecordAccessRuntime: (input: {
  readonly root: RecordRoot;
}) => Effect.Effect<
  RecordAccessRuntime,
  RecordAccessRuntimeOpenError,
  Scope.Scope | RecordFileSystem | RecordMaintenanceLock | RecordWriterLock | RecordEntropy
>;
```

`openRecordAccessRuntime` 只 canonicalize root、绑定 runtime registry，并初始化 generation allocator 与 cache。
它不读取 portable Record，也不在无 lease 时保留 current-format 或 sentinel 判断。每个子操作取得自己的 locks
后，才执行完整 open 与 operation-specific bootstrap。

facets 有 package-minted nominal identity，不能结构性伪造或由弱 facet 转成强 facet。Report host 只持
`RecordSnapshotSource`；Invocation coordination 持 `RecordInvocationAccess`；maintenance CLI 才持
`RecordMaintenanceAccess`。reuse planner、Analysis selection、Projection、Report author callback 与 Attempt
execution 都不得取得任何 facet。

## Snapshot 与 generation

`withSnapshot` 在内部 child Scope 取得 shared maintenance lease，并执行 current-format 与 sentinel 检查。
随后 mint 一个 runtime-private generation，再冻结 Run membership、warnings 与 owner handles。callback 结束后
释放 lease 并关闭 generation。

`withWriteSession` 按 shared maintenance → exclusive writer 的固定顺序取锁，并自行 mint
`session.view` generation。它不接受调用方已有 view。publish 不刷新任何 generation，也不把 draft 加入 view。

generation 是 nominal runtime identity，不是 durable revision、公开整数或可比较的新旧版本。逃出 callback 的
view 继续由 runtime exact-identity 与 closed-state 检查拒绝。

## Verified read cache

runtime 可以跨 generations 保存 package-private `VerifiedRecordPackageMaterial`。key 包含 owner/schema
identity、exact envelope/payload bytes 与完整有序 blob closure；它是 host-local cache identity，不进入 Record
或公开 API。

读取顺序固定为：

1. 当前 snapshot 在自己的 lease 下验证 owner handle，并从当前 published layout 定位 package。
2. 读取并证明 exact content identity。
3. 只用该 identity 查询 verified material。
4. 为当前 generation 形成 `RecordAttachmentRead` 与 self-contained value，不复用 owner handle。

Run enumeration、warnings 与 path 到 current content 的映射不能跨 generation 缓存。read state、handles、
drafts、leases、incomplete Run、local writer session 与 migration 中间态同样不能缓存。cache hit、miss、
eviction 和大小不可观察。

## Invocation → Report lifecycle

```text
RecordAccessRuntime
  ├─ withWriteSession
  │    session.view → reuse planning → gaps → Attempt execution → publish
  │    close：释放 writer + maintenance
  └─ withSnapshot
       new FrozenRecordView → Analysis → Projection → ReportExecution
       close：释放 maintenance；ReportExecution 保持普通自包含值
```

官方 invocation→report 路径先关闭 write session，再创建 Report snapshot。底层锁仍允许 reader/writer 并发，
但官方路径不延长 writer lock。长寿 `view` host 每次 rebuild 使用独立 `withSnapshot`；last-good execution 不持
Record capability。

## 错误与关闭

每个子操作保留现有 open/read/write/maintenance typed errors。outer runtime 关闭后请求新 snapshot/session
返回 `record-runtime-closed`；已经逃出的 view/handle 使用既有 closed/invalid error。cache 或 registry 内部矛盾
是 defect，interruption 保持 Cause。

普通 read/write facets 不自动 migrate。所有子 Scope 关闭后，即使 runtime/cache 仍存活，exclusive maintenance
仍可取得；runtime 本身不能成为 migration busy 原因。

## Cases

- RR1：write session 关闭后从同一 runtime 开新 snapshot，才能看到刚发布 Run。
- RR2：outer runtime 长寿，但 rebuild 间没有 lease，因此空闲时不阻止 migrate。
- RR3：exact content 相同时复用 verified material，同时为每个 generation 重建 owner handles。
- RR4：path 或 migration 变化后必须重新证明 exact identity，旧 cache 不能直接命中。
- RR5：并发 writer 的 draft 不在 snapshot membership 中。
- RR6：runtime 存活不让 closed generation 复活。
- RR7：无活跃子 Scope 时 maintenance facet 可以取得 exclusive lock。

## 取舍

本方案真正统一的是 host-level root resource ownership，不是 reuse 与 Report 的领域查询。它增加 runtime、facets、
child Scope 与 cache identity 的实现复杂度，换取同一 host operation 内正式的 root authority 和安全 material
sharing guarantee。
