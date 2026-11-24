# Run 的状态

一次 Invocation 先一起创建 Session、全部 Run 与预期位置，再逐个发布 Attempt，最后收口 Run 与 Session。原进程可能在任意一步退出，接替者用精确恢复收口；用户也可能在 Session 尚未收口时删除 Run。这一页用模型检查器穷举这些交错，核对 [Run](README.md) 与[生命周期](architecture/lifecycle.md)的规则。

## 发布与回执

### 首次看到时 Run 已完整 {#NoPartialRunCreate}

第一次能读到本次运行时，全部 Run 及各自完整的预期位置已经可读。

### 被中断的执行不再发布通过 {#NoCancelledSuccess}

先被中断的在途执行不会再发布通过结果；已经确定结果的执行仍可发布原结果。

### 位置只承载真实结果 {#NoInventedResult}

公开位置只承载该位置已经确定并完整发布的执行结果；没有执行结果的位置保持缺失。

### 回执与结果一致 {#ReceiptMatches}

回执列出这次调用实际创建的全部 Run，按回执的读取版本能读到对应结果；正常回执要求全部 Run 已收口。

### 先收尾再生成回执 {#NoEarlyReceipt}

Runner 生成回执前先完成这一轮收尾，并取得读取版本。

### 有限工作最终结算 {#Progress}

有限工作在可执行的步骤继续时，最终结算为回执、失败或进程退出。

```statechart spec="./tla/publication/Publication.tla" config="./tla/publication/final-receipt-2.cfg" view="./tla/publication/view.ts" out="./tla/publication/out/final-receipt-2" digest="sha256:b78f6bea879f369789596c9c5b7e43afed70ecbf1c2010e7529e5d90d13562a4"
```

两个 Run，各一个预期位置，六条规则都成立。状态数超过图的规模上限，只显示检查报告。回执检查到 Runner 内部取得读取版本为止；之后 CLI 只在 portable Record 校验通过后才成功交付（回归见 `test/process/record-portable-gate.test.ts`）。

## 精确恢复

### 收口后结果完整 {#DurableCoverage}

Run 收口后，原来可读的位置仍有结果，其余每个位置都有缺失说明。

### 原进程活着时不接管 {#NoLiveTakeover}

原运行进程活着、或尚未证明它已终止时，其它进程不能接管。

### 终态不回退 {#TerminalStable}

已收口的 Run 不会回到运行中。

### Run 最终收口 {#AllRunsClose}

取证可用、至少一个接替者存活、就绪的执行或恢复都得到机会时，Run 最终收口。

### Session 最后收口 {#SessionLast}

正常收尾或精确恢复时，Session 收口前所属 Run 都已是终态；恢复最后一个未收口的 Run 时，两个终态一起提交。

### 恢复开始后旧写入无效 {#FencedSetImmutable}

恢复开始后，原进程迟到的发布不能改变该 Run 的已发布结果。

### 恢复与旧请求最终结算 {#RecoveryFinishes}

原进程的终止可以证实、接替者与在途请求都能继续时，恢复和旧请求最终结算。

```statechart spec="./tla/recovery/Runs.tla" config="./tla/recovery/r-small.cfg" view="./tla/recovery/view.ts" out="./tla/recovery/out/r-small" digest="sha256:d5364d1963af3550a302d980490b5c5447a5719367c675ef9e256e5a68a91896"
```

```statechart spec="./tla/recovery-resume/Runs.tla" config="./tla/recovery-resume/r-resume.cfg" view="./tla/recovery-resume/view.ts" out="./tla/recovery-resume/out/r-resume" digest="sha256:4a275dcef8b844ace17dd7667930768c337090f4df66038ca215967f8b60ad4c"
```

```statechart spec="./tla/late-writer/LateWriter.tla" config="./tla/late-writer/fence-2.cfg" view="./tla/late-writer/view.ts" out="./tla/late-writer/out/fence-2" digest="sha256:e6fbca941bd708ae4bb83b2e18da6e833f1006fc7d30aab529193fe4bfaa5cdb"
```

第一块是两个进程、一个 Run、两个位置。第二块是三个进程、同一 Session 的两个 Run，最终事务可以失败一次，检查同一 Host 能续办自己已经开始的恢复；状态数超过图的规模上限，只显示检查报告。修复 `6432f6190` 之前，这种续办会被当作其它活动进程拒绝，回归见 `test/process/run-recovery-retry-tla-repro.test.ts`。第三块是原进程与恢复者各有一个已发出、未结算的请求。三块的规则都成立。

## 删除

### 只删除已收口的 Run {#DeleteTerminal}

只有已收口的 Run 可以删除。

### 保留最后一个恢复入口 {#RecoveryEntryPreserved}

Session 尚未收口时，至少保留一个能用来恢复它的 Run。

### Session 最终收口 {#AllSessionsClose}

原运行能正常完成，或它的终止可以证实且恢复得到机会时，Session 最终收口。

```statechart spec="./tla/delete-session/Runs.tla" config="./tla/delete-session/r-session.cfg" view="./tla/delete-session/view.ts" out="./tla/delete-session/out/r-session" digest="sha256:498b83528d9fd612a04dcdf3d6f0a6f6ee7d7cc9d689c3a7551b0155212d54db"
```

三条规则都成立。回归 `test/process/run-delete-session.test.ts` 验证：Session 未收口时删除最后一个 Run 被拒绝，原命令退出后仍拒绝，精确恢复后可以删除。

## 动作与代码

路径以 `packages/niceeval/src/` 为根。

| 动作 | 代码 |
| --- | --- |
| 创建 Session、Run 与预期位置 | `runner/record.ts`；`runner/session.ts`；`record/sqlite/coordination-repository.ts` |
| 发布 Attempt、拒绝旧写与重复 | `run/storage/sqlite.ts` 的发布事务 |
| 正常封口与收口 | `runner/record.ts`；`run/storage/sqlite.ts`；`experiment/host/operations.ts` 收口 Session |
| 中断、记录缺失、回执 | `runner/run.ts` 的派发中断与读取版本；`runner/record.ts` |
| 精确恢复的两笔事务、失败与续办 | `run/host/runtime.ts`；`run/host/lifecycle-adapter.ts`；`run/storage/sqlite.ts`；`record/sqlite/coordination-repository.ts` |
| 删除 | `run/host/runtime.ts`；`run/host/lifecycle-adapter.ts`；`run/storage/sqlite.ts` 的删除事务 |

## 模型没有覆盖的部分

取消路径、incoming references 与引用删除（回归见 `test/integration/record-references.test.ts`）、Case lock、State 对账与租约、精确的 Session 取证算法、取证永久不足时的合法等待、网络协议与闭包内容。

[SessionLast](#SessionLast) 只覆盖正常收尾与精确恢复：普通执行失败时 Host 会把 Session 记为 `incomplete`，受控中断中的局部写入失败可能留下活动的 Run，这些情形不在模型内。
