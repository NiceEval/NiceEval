# 共享状态租约

一个 Experiment 用到的全部共享状态组成一个租约集合：一次取得、一起换代、一起释放。原进程死亡后，操作员显式恢复：先关闭原 Run，再执行登记的 after 补偿，最后释放整组。规则来自[数据模型](../data-model.md)的取得、正常释放与显式恢复三节。

## 规则

### 等齐所需状态后一次取得，整组释放 {#WholeSet}

一个 Experiment 的全部 key 在同一次事务里取得；有任一 key 被占用就零修改、零部分持有。释放时整组一起释放。

### 失去租约后的迟到写入无效 {#NoLateWrite}

原持有者失去租约后，它迟到的心跳、释放或更新不能改变新持有者的记录。

### 有限竞争最终结束 {#Settles}

请求有限、每个持有者都能正常结束时，所有等待最终结束。

### 集合与成员同时换代 {#WholeSetGeneration}

接手或释放时，集合与每个成员在同一次提交中推进 generation，不出现只换了一部分成员的状态。

### 恢复成功时原 Run 已关闭 {#RecoveryClosesRun}

显式恢复返回成功时，租约绑定的原 Run 已经是终态。

### 原 Run 关闭后才执行 after {#AfterFollowsRun}

已登记的 after 补偿只在原 Run 关闭之后开始。

### 确认 after 与移除登记一起提交 {#RetirementIsAtomic}

after 成功的确认与删除对应的精确登记在同一事务里提交。

### after 确认后不再重跑 {#NoReplayAfterRetirement}

after 一经确认，之后再有人接手也不会再次执行它。确认之前中断时，下一个接手者会重新执行同一补偿，所以 after 必须可以安全重试。

## 取得与释放

```statechart spec="../tla/shared-state-lease/acquire/LeaseCAS.tla" config="../tla/shared-state-lease/acquire/lease-after.cfg" view="../tla/shared-state-lease/acquire/view.ts" out="../tla/shared-state-lease/acquire/out/lease-after" digest="sha256:a65a3cc4dae5d3a1fcdd2bf4980938fc6aa91558fd43e3e9219e98dd27958e0d"
```

三个 Experiment 分别请求 {1,2}、{2,3}、{3,1}，两两交叉，每个只申请一次。`WholeSet`、`NoLateWrite` 与 `Settles` 成立。读前代、等待轮询与失败重试合并为一步；取消等待、资源名额与收尾失败不在模型内。图按等待数量合并不同 Experiment，隐藏拒绝迟到写入与终态自循环。

## 显式恢复

```statechart spec="../tla/shared-state-lease/recovery/Recovery.tla" config="../tla/shared-state-lease/recovery/recovery-after.cfg" view="../tla/shared-state-lease/recovery/view.ts" out="../tla/shared-state-lease/recovery/out/recovery-after" digest="sha256:d743d605a7c5d2b533a40afbe5a9505293d2f6fe8f0c7dccd0f9a52cc6b39893"
```

```statechart spec="../tla/shared-state-lease/recovery-no-after/Recovery.tla" config="../tla/shared-state-lease/recovery-no-after/recovery-no-after.cfg" view="../tla/shared-state-lease/recovery-no-after/view.ts" out="../tla/shared-state-lease/recovery-no-after/out/recovery-no-after" digest="sha256:444c9697fb0eca932f77730593d46669d416486b238dff89157f7d1e55fed2cd"
```

模型从原进程已停止、集合仍被持有、原 Run 仍在运行开始：一个三成员集合，两个恢复者，最多两次恢复中断。第一块有登记的 after，第二块是没有登记的纯自动 State 集合。恢复类规则在两块都成立；第二块没有 after 可执行，相关规则自然成立。

公开返回“已恢复”与释放整组合为一步。取证、双确认、Run writer 换代、State 保存对账与 after 的外部副作用都在图上的步骤内部。缺操作员、取证不足或缺必需的 after 时允许一直等待。

## 修复前的路径

```statechart spec="../tla/shared-state-lease/recovery-before/Recovery.tla" config="../tla/shared-state-lease/recovery-before/recovery-before.cfg" view="../tla/shared-state-lease/recovery-before/view.ts" out="../tla/shared-state-lease/recovery-before/out/recovery-before" digest="sha256:3b78be7b691242acf4f3c25fd05e0315431b54331aae35a7471b976b8fb4756c"
```

这一块把修复前“不先关闭 Run”的顺序放进现行集合结构，保留两条最短路径：

- [AfterFollowsRun](#AfterFollowsRun)：原进程已停止 → 接手租约 → 启动 after，原 Run 仍在运行。
- [RecoveryClosesRun](#RecoveryClosesRun)：接着确认 after、移除登记 → 释放整组，原 Run 仍在运行。

修复提交 `3864ba6ef` 之前，真实接口上观察到 after 执行后恢复返回 `recovered`，同一 Run 仍为 `active`。回归测试 `test/process/state-lease-set.test.ts` 在 after 运行期间断言 Run 已是 `interrupted`；`test/process/shared-state-lease-tla-repro.test.ts` 分别在 after 确认后停止正常持有者与恢复进程，各只留下一次 after 记录。

## 动作与代码

路径以 `packages/niceeval/src/` 为根。

| 动作 | 代码 |
| --- | --- |
| 取得集合 | `runner/run.ts` 传入全部 key 与 Run；`runner/shared-state-lease.ts` 读取并等待；`record/sqlite/state-lease-repository.ts` 一次事务写集合 |
| 正常释放 | `runner/run.ts` 收尾后释放；`runner/shared-state-lease.ts` 与 `record/sqlite/state-lease-repository.ts` 校验全部成员后写 free |
| 迟到写入 | `runner/shared-state-lease.ts` 的心跳；`record/sqlite/registry-repository.ts` 只接受当前 head |
| 接手租约 | `experiment/host/teardown.ts` 校验 selector 与确认；`runner/shared-state-lease.ts` 核对 token 与终止证据后换代 |
| 关闭原 Run | `run/host/lifecycle-adapter.ts` 的正式 Run recovery；`run/storage/sqlite.ts` 拒绝旧 writer 并提交 `interrupted` |
| 执行与确认 after | `experiment/host/teardown.ts`；`record/sqlite/state-lease-repository.ts` 与 `record/sqlite/registry-repository.ts` 同事务删除登记 |
| 释放整组 | `experiment/host/teardown.ts`；`record/sqlite/state-lease-repository.ts` |

## 模型没有覆盖的部分

独立的 Run recovery、原 Run 已是其它终态、正常持有者路径上的 after 提交、取消重叠等待（回归见 `test/process/state-lease-set.test.ts`）、事务回滚，以及全部 State 写入命令的迟到形态。
