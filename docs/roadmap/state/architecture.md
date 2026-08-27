# State —— Architecture

## 数据关系

```text
provider-issued StateProviderIdentity
  └─ Cohort
      └─ StateRegionRef (same Cohort, provider, namespace, schema)
          ├─ StatePersistenceBoundary (sandbox surfaces / external resource)
          └─ StateCheckpointRef (exact checkpoint, optional contentDigest)
              └─ exact expected predecessor ──> fenced commit
                                                   └─ exact new checkpoint ref

Run slot ──> StateExecution ──> StateCommitReceipt
```

`StateProviderIdentity` 穷尽 provider、namespace、Cohort 与 schema。`StateRegionRef` 在这四项上再绑定 Region；
`StateCheckpointRef` 再绑定 exact checkpoint。所有 component 都是 provider-issued opaque handle，因而作者的
字符串、路径或自制 object 不能冒充 identity。

```ts
type StateExecutionReceiptV1 =
  | {
      readonly schema: "niceeval.state/v1";
      readonly executionId: StateExecutionId;
      readonly target: StateRegionRef;
      readonly persistenceBoundary: StatePersistenceBoundary;
      readonly mutations: readonly StateMutationClassification[];
      readonly expected: ComparableExpectedPersistence;
      readonly comparability: { readonly kind: "comparable" };
      readonly commits: readonly StateCommitReceipt[];
      readonly terminal:
        | "committed"
        | "rejected"
        | "restore-failed"
        | "commit-indeterminate"
        | "scope-failed";
    }
  | {
      readonly schema: "niceeval.state/v1";
      readonly executionId: StateExecutionId;
      readonly target: StateRegionRef;
      readonly persistenceBoundary: StatePersistenceBoundary;
      readonly mutations: readonly StateMutationClassification[];
      readonly expected: ExpectedPersistence;
      readonly comparability: {
        readonly kind: "debug";
        readonly reasons: NonEmptyReadonlyArray<StateDebugReason>;
      };
      readonly commits: readonly StateCommitReceipt[];
      readonly terminal:
        | "committed"
        | "rejected"
        | "restore-failed"
        | "commit-indeterminate"
        | "scope-failed";
    };
```

`commits` 按提交尝试顺序保存。一个 execution 一旦进入 `debug`，`comparability` 不能再变为 `comparable`。
该约束独立于 provider 后续能否给出 digest 或声明能力。

## 持久边界与污染分类

Experiment 或 Trajectory 只能通过 `StateProvider.bind()` 绑定预期持久 Region。Provider 签发的 boundary 与
`StateRegionRef` 使用相同完整 identity；Runner 不接受作者自填排除路径。Sandbox path surface 只匹配规范化的
exact/subtree 虚拟路径；external-resource surface 不匹配 Sandbox filesystem。

Sandbox isolation 以实际 mutation observation 对 boundary 分类。boundary 内是 `intentional-state`，boundary 外是
`unexpected-mutation`，观察不完整是 `classification-unavailable`。实现删除仅从首题/后续题 Verdict 序列推断
`sandbox-reuse-contamination` 的启发式；没有 mutation evidence 就不得声称污染。

分类与 failure 是正交维度。即使 mutation 位于预期 Region 内，access denied 和 restore/reset failure 仍按原 owner
进入 receipt/diagnostic。symlink escape、cleanup failure、isolation failure 与 commit indeterminate 也原样保留，
并阻止不安全后继。

## Digest 与 comparability

`StateCheckpointRef.contentDigest` 是唯一公开 digest 字段。可比较 reference 必须带它；debug reference 可以省略它。
Runner 在首次 acquire 评估 provider 给出的 digest、CAS、同一 `commitId` 的 idempotency 与 fencing guarantee：

- 四项都满足时，execution 可以从 `comparable` 开始。
- 任一项不能满足时，execution 从 `debug` 开始，并保存相应的封闭 `StateDebugReason`。
- 之后 restore 或 commit 边界收到没有 `contentDigest` 的 ref，也会降为 `debug`。

debug 是 execution lifetime 的单调降级，不是重新获取 digest 后可以修复的标签。

## Exact restore

`ExpectedPersistence.kind: "restore"` 和 `StateLease.restore({ checkpoint })` 都显式接收一份 exact
`StateCheckpointRef`。provider 验证它与 lease 的 provider、namespace、Cohort、schema、Region 完全一致，且在
实际 Sandbox 或外部状态载体已经取得后执行 restore。

fresh start 的 `expectedPredecessor` 固定为 `null`。restore 的 `expectedPredecessor` 固定为完整传入的
`StateCheckpointRef`，其中包含 Cohort、Region 和 digest（若可比较）。Runner 不在 restore 与 commit 之间替换
这份 value。

## Commit、fence 与对账

Runner 在提交前 mint 一个 `StateCommitId`，并将 lease 的 fence 与完整 `StateCheckpointRef | null`
`expectedPredecessor` 一并交给 provider。provider 原子检查完整 identity、predecessor 与 fence；三项成立才写入
新 state 并签发 `newCheckpoint`。

每份 `StateCommitReceipt` 无论 accepted、rejected 或 indeterminate，均回显 `commitId`、完整
`expectedPredecessor`、`newCheckpoint` 与 `fencing` outcome。accepted receipt 在 comparable 分支的
`newCheckpoint.contentDigest` 必填；若没有 digest，receipt 与 execution 必须使用 debug 分支。

同一 `commitId` 是幂等键。网络断开、超时或响应丢失时，provider 可给出 indeterminate receipt。Runner 仅能在
同一 Scope 内，以同一 `commitId`、同一完整 predecessor、同一 fence 对账；得到 accepted receipt 才能继续。
确定 not-committed、对账仍 indeterminate 或发生 `StateCommitIndeterminate` typed failure 都停止 execution，不能
换 ID 重写、猜测 new checkpoint 或继续后继工作。

## Scope 与错误边界

选中的 StateProvider 是 Effect v4 `Context.Service`。Node application 在 invocation 的 composition edge 用一个 `Layer`
提供该 service。core operation 保留 service requirement，不在 `bind`、`acquire`、restore、commit 或 reconciliation 内重复
provide。provider SDK 的可拒绝 Promise 只在边界一次以 `Effect.tryPromise` 适配为 [Library](library.md) 中封闭的
`StateFailure`。内部不调用 `runPromise`，也不把 `unknown` 传入业务层。

一条 state execution 由 `Effect.scoped` 建立一个 Effect v4 `Scope.Scope`。`acquire()` 在该 Scope 登记 lease release
与 provider finalizer。

已取得 lease 的 restore、commit 与 reconciliation 留在同一 scoped program 内运行。它们不把 Scope 伪装成每个
operation 的独立 requirement。

Scope 以成功、typed failure 或 interruption 结束时都触发 release 与已登记 finalizer。finalizer 失败形成 `scope-failed`，
不会删除已得到的 commit receipt，也不会把未知 commit 写成已提交。

## 不变量

- core 不构造、解码或以作者字符串替代 provider-issued handle。
- `StateCheckpointRef.contentDigest` 在 comparable 分支必有；debug 可以省略，但 comparability 绝不恢复。
- restore、commit 与 reconcile 的 predecessor 都是完整 `StateCheckpointRef | null`，不存在隐式指针。
- 每份 commit receipt 都回显 commit ID、完整 predecessor、new checkpoint 与 fencing outcome。
- indeterminate 只能以同一 `commitId` 对账；无法确定时停止。
- `sharedState.key` 协调生命周期，fence 决定写入权。
- 预期状态只来自 provider-issued boundary；分类不删除任何 access/reset/isolation failure。

## 迁移边界

持久化入口只接受本页的 `ExpectedPersistence` 与 `StateCheckpointRef`。任何不带 provider、namespace、Cohort、
schema 与 Region 的历史 key、可变文件名或无 fence 写回都被拒绝；迁入者必须由 provider 签发 exact handle，或
新建 fresh Cohort。读取器将缺少 digest 的旧 reference 表示为 debug，而不是补写或猜算 digest。
