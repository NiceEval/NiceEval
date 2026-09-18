# PLAN-2：host-managed static finite projection graph

作者在任何 I/O 前声明封闭的 projection graph。节点只包含 package access、同步 projector 与静态依赖；
host 验证图、预算读取、并发调度并返回同样的 closed `ProjectedSample` values。

```ts
const facts = defineProjectionGraph({
  otel: project(otelAccess, otelProjector),
  assertions: project(assertionsAccess, assertionsProjector),
});

const result = yield* sample.projectGraph(facts);
```

公开调用面只接受封闭图：

```ts
interface ProjectionNode<OwnerKind, Payload, Value, LayoutState> {
  readonly access: PackageAccess<OwnerKind, Payload, LayoutState>;
  readonly project: (available: RecordAttachmentValue<Payload>) => Value;
  readonly dependsOn: readonly ProjectionNodeId[];
}

interface AnalysisSampleHandle<View> {
  projectGraph<Graph extends ProjectionGraph>(
    graph: ClosedProjectionGraph<Graph>,
  ): Effect.Effect<ProjectedGraph<View, Graph>, ProjectionGraphError | RecordReadError | ProjectionLimitError>;
}

type ProjectedNode<View, Node> = Node extends ProjectionNode<
  infer OwnerKind,
  unknown,
  infer Value,
  infer LayoutState
> ? ProjectedSample<View, OwnerKind, Value, LayoutState> : never;

type ProjectedGraph<View, Graph extends ProjectionGraph> = {
  readonly [Key in keyof Graph]: ProjectedNode<View, Graph[Key]>;
};
```

`defineProjectionGraph` 检查 key 唯一性与依赖闭包，并产生不能由作者伪造的 closed brand。结果保存每个节点的
closed `ProjectedSample`；它不暴露 scheduler、reader 或 graph callback。

运行中不得根据某个 payload 新增 package dependency。条件分支必须在 definition 中形成有限候选，并由静态
selection 输入激活；payload-dependent branch 属于 PLAN-1。

本候选让 host 在 I/O 前知道 closure，可以提供全图 limit、去重和调度保证。代价是作者必须学习声明图，
普通控制流不能直接决定读取。若同时把 direct calls 暴露为同级逃生口，静态闭包保证即告失效；因此两项是
互斥的官方 authoring contract，不是“基础 API 加可选糖”。

## 生命周期与失败

definition 可跨 execution 复用，不保存 reader 或 Sample。execution 在 live handle 的 Scope 内绑定 Sample，
先验证整图，再按预算取得 snapshot leases；所有节点停稳后释放 raw references。

cycle、unknown dependency、动态节点与 Sample token 错配是 `ProjectionGraphError`。Record 读取和 limit 保持
typed Effect error，package 六态仍是节点数据。一个节点的 projector defect 进入 Effect Cause；本方案不额外
承诺 consumer-local failure isolation。

## Cases

- P1：host 合并十个 slots 的相同 owner read，但仍产生十个 entries。
- P2：未读取 excluded、not-recorded 与 core-invalid，included 节点保留完整读取状态。
- P3：Sources 条件必须在 definition 时形成有限 selection；payload-dependent 新节点被拒绝。

## Limits 与扩展

graph node count、depth、单 package closure、并发 lease 与总预算在执行前验证。第三方通过 typed node 与同步
projector 扩展；不能注册运行时 reader callback。官方 API 不提供 direct execution 旁路。
