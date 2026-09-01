# Run 架构

Run Core 拥有 Run、expected slot、slot binding、Attempt publication、Run state 与 deletion tombstone。
Experiment 拥有计划、absence reason 与复用资格；Inspection 拥有固定 cutoff 下的读取和聚合。SQLite adapter
实现事务与持久化，但不进入公开领域 API。

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

`AttemptPublicationEnvelope` 是这次提交的穷尽闭包。它包含 Core outcome、Assertions source receipt 与
Runner Activities source receipt。其它成员是 Attempt-owned source receipts、manifest、immutable blob
references、publication identity 和 origin binding。

每个 source receipt 必须明确是 `complete | partial | not-recorded`；缺少 receipt 不是空集合。reuse 所需
source 不为可验证终态时，该 Attempt 仍可查询，但不得自动 carry。

blob bytes 先以 content-addressed immutable object 持久化、同步并校验。随后同一个 SQLite transaction 提交
envelope、全部 references、slot binding 与唯一 revision。未被已提交 envelope 引用的 blob 不是公开事实，可由
内部 GC 回收。v1 不允许 publication 后向同一 Attempt 晚发附件；需要补充事实时创建新的 Attempt，而不是改写旧
revision。

事务前崩溃时公开结果没有该 Attempt；事务提交后崩溃时公开结果完整包含它。Member 不会先于 Attempt closure
可见，后台 staging、reservation 和未提交事务没有 publication revision。

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

`revision` 是一个 `storeGeneration` 内由 Record storage adapter 唯一分配的全局 commit sequence。
它不是各表或各 Attachment owner 的局部版本。reader 在固定 generation 的单个 read snapshot 中取得 cutoff。

Run Core、Attempt envelope、source receipt、binding、close 与 tombstone 都只在自己的
`publishedRevision <= cutoff.revision` 时可见。旧 revision 永不原地更新。

Inspection 在开始时固定一个 cutoff，只读取 revision 不大于该值的事实。晚于 cutoff 创建的 Run 不存在；晚于
cutoff 的 binding 仍为 pending；晚于 cutoff 的 close 不会让旧结果提前看到终态。continuation token 与 View
generation 都绑定同一 cutoff；无法在当前 generation 继续时返回 restart-required。

## 删除不变量

Run 只拥有自己的 origin Attempts，不拥有引用来的 Attempt。删除只接受 exact 终态 Run；`active` Run 必须先经
有证据的 recovery 收口。delete 与 reference binding 共用序列化边界，并在事务内重验目标 Run 与所有 origin
Attempts 的 incoming references。

reference 先提交时，delete 拒绝并列出依赖 Run 与 Attempt locator；delete 先提交时，后续 binding 返回
`source-run-deleted`。删除 reference-only binding 不影响 origin Attempt。v1 不提供 force 或 cascade。

成功删除以带 revision 的 tombstone 线性化。新 cutoff 不再看到该 Run 或其 origin Attempts；已经固定的旧 cutoff
由内部 generation retention 保持可读，安全后才物理回收。
