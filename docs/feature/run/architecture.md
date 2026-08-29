# Run 架构

Run Core 拥有 Run、expected slot、slot binding、Attempt publication、Run state 与 deletion tombstone。
Experiment 拥有计划、absence reason 与复用资格；Inspection 拥有固定 cutoff 下的读取和聚合。SQLite adapter
实现事务与持久化，但不进入公开领域 API。

## Canonical Record 与 staging

每个项目只有一个 canonical `.niceeval/record.sqlite`。它既是运行中可读的产品事实，也是 graceful close 后可直接复制的
portable artifact；产品只定义这一种 Record 身份。canonical database 物理上只包含已提交的
Run create、已发布 Attempt、Member、Run close 和 deletion。execution reservation、未 publication Attempt、writer lease、
mailbox、心跳与进程协调都属于 operational state，不得写入 canonical database。

大型内容和待发布 Attempt 可以先写入与 canonical database 分离的 private staging。staging 没有 publication revision，
不能被 Run、Inspection、reuse 或用户工具读取，也不能在 crash 后晋升为事实。打开项目时只按 owner identity 删除遗留 staging；
无法由 canonical facts 证明的内容一律丢弃。

## 身份与固定计划

`runId` 与 `attemptId` 是全局唯一且不可变的领域身份。`slotId` 只标识一个 Run 在创建时冻结的 expected
位置，不能充当 Attempt identity。Run create transaction 同时提交完整 expected slots、`invocationId`、
初始 `active` state、writer generation 与 publication revision；未提交的候选 Run 不存在。

一次 execution reservation 可以在内部取得 candidate attempt identity，但 publication 前不进入 list、locator、
Inspection 或 reuse。失败后的重试创建新的 attempt identity。

## Attempt publication

origin publication 是一个短事务。它必须同时：

1. 验证 Run 仍为 `active`、writer generation 匹配且 slot 为空；
2. 提交 immutable Attempt closure 与 `AttemptPublicationIdentity`；
3. 写入该 slot 的 origin binding；
4. 取得单调 publication revision。

事务前崩溃时公开结果没有该 Attempt；事务提交后崩溃时公开结果完整包含它。Attempt closure 的全部 rows 与内容引用、
publication identity 和 origin binding 在这一次事务中共同提交；Member 不会先于 Attempt closure 可见。后台 staging、
reservation 和未提交事务没有 publication revision。

carry 与 accept 不复制 Attempt。reference binding transaction 只允许引用已经发布、且通过当次 policy 资格检查的
Attempt，并在目标空 slot 原子写入 `{ attemptId, originRunId, originSlotId, publicationIdentity, action }`。
origin publication 与 reference binding 竞争同一个 slot CAS，恰有一个可以成功。origin Run 是否已经收口不改变
Attempt identity；即使 origin Run 仍为 `active`，已发布 Attempt 也可以被引用。

## Run 收口与 absence

`expected` 始终是 Run create 时的完整逻辑计划，也是 coverage 分母。`published` 表示 cutoff 前已经绑定到可读
Attempt 的 slot，origin 与 reference 都计入；`missing = expected - published`，永不补零或伪造失败 Attempt。

`active` Run 的 missing slot 统一显示为 `pending`。Run close transaction 原子提交终态与所有剩余 slot 的
`absenceReason`，两者取得同一 publication revision。终态永久拒绝任何新 binding。

Experiment 定义的 absence reason 闭集为：

```ts
type RunAbsenceReason =
  | "early-exit-satisfied"
  | "budget-exhausted"
  | "stopped-by-failure"
  | "interrupted-before-publication"
  | "dispatch-failed";
```

`early-exit-satisfied` 表示按策略完成，不构成结果缺口。其它 reason 保留自己的 incomplete 或 error 含义。
Pass/Score 指标只以已发布且相应指标 available 的 Attempt 为指标分母；coverage 始终同时交付
`published / expected`。

## PublicationCutoff

Run create、每次 origin/reference binding、Run close 与 Run deletion 都取得单调 commit revision。公开事实以
append-only event 或等价的可版本化表示保存，必须能按以下边界重建：

```ts
interface PublicationCutoff {
  readonly storeGeneration: string;
  readonly revision: number;
}
```

Inspection 在开始时固定一个 cutoff，只读取 revision 不大于该值的事实。晚于 cutoff 创建的 Run 不存在；晚于
cutoff 的 binding 仍为 pending；晚于 cutoff 的 close 不会让旧结果提前看到终态。continuation token 与 View
generation 都绑定同一 cutoff；无法在当前 generation 继续时返回 restart-required。

## 删除不变量

Run 只拥有自己的 origin Attempts，不拥有引用来的 Attempt。删除只接受 exact 终态 Run；`active` Run 必须先经
有证据的 recovery 收口。delete 与 reference binding 共用序列化边界，并在事务内重验目标 Run 与所有 origin
Attempts 的 incoming references。

reference 先提交时，delete 拒绝并列出依赖 Run 与 Attempt locator；delete 先提交时，后续 binding 返回
`source-run-deleted`。删除 reference-only binding 不影响 origin Attempt。v1 不提供 force 或 cascade。

成功删除不在当前 SQLite 文件里原地拆除事实。adapter 从当前 canonical database 建立 private generation，应用删除并完成
全库验证，再以文件级原子替换发布新 generation。替换前 crash 只留下待删除的 private generation；替换后新 reader 只会
打开完整的新 generation。已经持有旧 generation 的 reader 可以完成，安全后才回收旧文件。新 cutoff 不再看到该 Run 或其
origin Attempts；替换仍发布带 revision 的 deletion tombstone，并保持 reference 检查的线性化边界。

## Portable gate 与不可信输入

受控 CLI 退出先停止新 publication，完成已接纳的 publication 和 Run close，再关闭所有 writer。adapter 随后 checkpoint 并
truncate WAL，以内建只读路径重新打开 `.niceeval/record.sqlite`，验证 current schema、引用闭包、publication 单调性和领域
不变量。任何步骤失败都使退出失败，且不得把文件宣称为 portable；成功后 canonical 文件自身就是可移动 artifact，不需要
导出或封装。

从 `--record` 打开的外部 SQLite 始终是 hostile import。source adapter 只读打开，先校验精确 current schema、SQLite
完整性和全部领域不变量，再允许 Inspection；绝不执行 migration、repair、SQL fallback 或部分读取，也不把外部文件变成
项目 canonical Record。旧 schema fail closed，并要求在原项目用 current NiceEval 重新运行。
