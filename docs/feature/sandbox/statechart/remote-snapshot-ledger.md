# 远端 snapshot 账本

远端 Provider 的 Before cache 快照由一份账本管理：生产者持有发布权，命中的运行与启动的实例各持一份保护，旧快照在没有保护后回收；创建结果不明时按名称对账，结算窗口内查不到并不证明快照不会迟到。这一页用模型检查器核对[远端 snapshot 缓存](../architecture/remote-snapshot-cache.md)与[数据模型](../data-model.md)的规则。

## 规则

### 只有当前持有发布权的运行能发布 {#OnlyCurrentLeasePublishes}

发布权过期后，迟到的答复不能让原运行发布快照。

### 命中与保护一起取得 {#ReadyWithOwnHold}

运行取得命中结果的同时取得自己对这份快照的保护。

### 实例可能还在时不删快照 {#NoDeleteWithLiveSandboxHold}

实例的删除没有确认之前，保留它所用的快照。

### 结果不明的创建在窗口结束前保留登记 {#UnknownRequestRetainedUntilSettle}

创建结果不明时保留登记；确认按名称查不到的查询，必须在结算窗口结束之后发出。

### 退役的快照最终结算 {#RetiredSnapshotEventuallySettles}

旧快照不再受保护、远端最终给出确定结果、回收能继续时，最终被删除或确认不存在。

## 模型

```statechart spec="../tla/remote-snapshot-ledger/publication/Publication.tla" config="../tla/remote-snapshot-ledger/publication/publication.cfg" view="../tla/remote-snapshot-ledger/publication/view.ts" out="../tla/remote-snapshot-ledger/publication/out/publication" digest="sha256:f1f3e3fdb8f65d65dac99b2d4f5d574dcf6b53cf89677c9b0f40fd3fb2cc70cc"
```

```statechart spec="../tla/remote-snapshot-ledger/reconciliation/Reconciliation.tla" config="../tla/remote-snapshot-ledger/reconciliation/settlement.cfg" view="../tla/remote-snapshot-ledger/reconciliation/view.ts" out="../tla/remote-snapshot-ledger/reconciliation/out/settlement" digest="sha256:8f718d8dd3cdb316039a440c664b011c0be2aa2144d8eb154d9a639c8f0fd615"
```

同一个 key。第一块是两轮生产者、一次发布权过期与接管、旧代的一次实例创建与回收；第二块是结果不明、迟到的 Ready、Pending、结算窗口与下一轮回收。两块都允许为同一 key 预约新一代。各自的规则都成立。

## 按路径重放的测试

`test/integration/remote-snapshot-ledger.test.ts` 在真实 SQLite 与受控的 Provider 上重放两条路径：实例删除失败后，重复关闭已关闭的 Scope 曾误解除实例的保护，快照随后被删；窗口内发出的空查询在窗口结束后才回复，曾被当作“查不到”完成结算，迟到出现的快照再也删不掉。现在关闭结算后才解除保护，查询开始时间在发出前取得。

## 动作与代码

路径以 `packages/niceeval/src/sandbox/remote-snapshot/` 为根。

| 动作 | 代码 |
| --- | --- |
| 预约、过期、接管 | `ledger-storage.ts` |
| 发布、拒绝迟到发布、命中并保护 | `preparer.ts`；`ledger-storage.ts` |
| 交接给实例、实例启动与删除 | `preparer.ts` 的实例 Scope；`ledger-storage.ts` |
| 退役、回收领取与删除 | `ledger-storage.ts`；`preparer.ts` |
| 记录请求、结果不明、按名称对账 | `preparer.ts`；`ledger-storage.ts`；`../instabox/snapshot-driver.ts` |

## 模型没有覆盖的部分

真实云服务、多个 key、具体 Provider 的查询语义与时钟误差。
