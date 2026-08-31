# Run 架构

Run Core 拥有 Run、expected slot、slot binding、Attempt publication、Run state 与 deletion tombstone。
Experiment 拥有计划、absence reason 与复用资格；Inspection 拥有固定 cutoff 下的读取和聚合。SQLite adapter
实现事务与持久化，但不进入公开领域 API。

## Canonical Record 与运行中状态

每个项目只有一个 canonical `.niceeval/record.sqlite`。Run create、运行中的 Attempt aggregate、Attachment 与 Content
都写入这一份 ProjectDatabase。已发布 Attempt、Member、Run close、recovery 与 deletion 也写入同一文件。
产品与内部 adapter 都不得为 Run、Attempt 或 publication 建立第二份 SQLite。中间态由行状态、Run writer generation
与 project barrier 隔离，不由文件边界隔离。

未发布 aggregate 的所有可变行都携带 `runId`、`attemptId` 与 `writerGeneration`。每次 mutation 在数据库事务内验证 project
barrier 为 `open`、Run 为 `active`、generation 匹配，并要求 Attempt 为 `staging` 或 `sealing`。任一条件不符都返回具名失败；
published aggregate 在数据库层不可再写。Inspection、reuse、Run show/list 与 reference lookup 只能从 cutoff 内的
publication/binding 读取 closure。未发布、sealing、旧 generation 遗留或晚于 cutoff 的 rows 都不可见。

operational mutation sequence 与 publication revision 分离。staging append 不推进公开 revision；Run create、Attempt
publication、reference binding、Run close/recover 与 deletion 才推进 publication clock。崩溃留下的运行中 rows 是明确的
operational state，不会因存在于 canonical database 就成为公开事实。

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

事务前先在短事务中增量写入 aggregate，并在事务外流式形成 closure manifest 与 digest。publication transaction 验证 Run
仍为 `active`、writer generation 匹配、Attempt 为 `sealing`、manifest 与引用闭包完整、slot 为空。随后一次
`BEGIN IMMEDIATE` 冻结 aggregate、提交 `AttemptPublicationIdentity` 与 origin binding，并取得同一个 revision。

事务前崩溃时公开结果没有该 Attempt；提交后崩溃时公开结果完整包含它。迟到 append、旧 generation、重复 publish 与 command
retry 都不能修改已发布 closure。

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

成功删除在 canonical SQLite 的一个事务中移除该 Run 的可删 rows，并发布带 revision 的 deletion tombstone。
事务回滚时公开事实不变；提交后新 cutoff 不再看到该 Run 或其 origin Attempts。删除始终保持 reference 检查的线性化边界，
不建立 private database、不替换 canonical 文件。

## Portable gate 与不可信输入

ProjectDatabase 有 `open`、`draining` 与 `portable` barrier state。所有 writer mutation 在事务内验证 barrier；portable gate
以 project-wide CAS 从 `open` 进入 `draining`，从此拒绝新的 Run 与 mutation。它等待当前调用者已经接纳的短事务和 Run
受控收口；存在其它仍存活的 owner 时 fail closed，死亡 owner 必须先以精确 owner identity recovery。gate 或 recovery 崩溃后
保留可精确恢复的 `draining`，不得按 TTL、PID 或启动时自动解锁。

gate 删除全部未发布 aggregate 与临时 coordination rows，再把 portable generation、cutoff、schema fingerprint 与 gate
identity 写入 canonical metadata。新 baseline 从创建起强制 `PRAGMA secure_delete=ON`，每次 writer open 也必须验证它。

schema 拒绝 virtual table、external-content table 与未知 storage object。Host 随后关闭所有 writer、checkpoint 并 truncate WAL，
再以内建 hostile read-only 路径重开同一个文件。

重开必须验证 baseline、SQLite integrity、foreign key 与 publication closure。它还要验证 portable barrier、publication cutoff，
并确认没有 active owner、未发布 aggregate 或 coordination 工作态。
任何步骤失败都不得把文件宣称为 portable。

成功后的 canonical 文件自身就是可移动 artifact，不生成 Snapshot、export、另一份 SQLite 或整库重写。下一次 Run create 在
同一事务中把 portable generation 切换为新的 `open` operational generation；从该 commit 起旧 portable receipt 不再代表当前
文件。运行中数据库可以被 Inspection 读取，但不得宣称 portable。

新 baseline 使用不可与旧 Record 混淆的 format identity 与 schema fingerprint。路径不存在时只通过 bootstrap transaction 创建；
路径存在时必须精确匹配，否则只读 fail closed，不 migration、不改写原文件、不 converter、不 compat read。旧正式 schema、空或部分
SQLite、伪造 revision/fingerprint、额外 schema object 与旧 WAL/SHM 组合都不得被修改或接受。

从 `--record` 打开的外部 SQLite 始终是 hostile import。source adapter 只读打开，先校验精确 current baseline、SQLite
完整性和全部领域不变量，再允许 Inspection；绝不执行 migration、repair、SQL fallback 或部分读取，也不把外部文件变成
项目 canonical Record。旧 schema fail closed，并要求在原项目用 current NiceEval 重新运行。
