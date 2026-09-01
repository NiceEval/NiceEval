# Run Lifecycle

本页拥有 Run Host、Runner、Inspection 与内部持久 adapter 之间的跨 owner 顺序。

## 创建与执行

```text
Invocation starts
  → one transaction creates active Session + Runs + expected slots + case-lock generations
  → publish origin/reference slot bindings independently
  → close Run: terminal state + absence reasons
  → return InvocationReceipt at one PublicationCutoff
```

Run create 与 active Invocation Session 一旦共同提交就分别进入 `run list` 与 `session list`。
Attempt 可以分批进入内部 staging；只有 publication transaction 提交后才公开。

staging aggregate 与已发布事实位于同一个 canonical `.niceeval/record.sqlite`。两者由状态、writer generation 与 publication
revision 隔离，不得建立 per-Run、per-Attempt、Session 或 lock SQLite/sidecar。
长期持有的 case-lock 或 Session authority 不持有长 SQLite transaction；每次观察或 mutation 都以短事务重验 exact identity 与 generation。
Run close 不重新发布或撤销 Attempt，只冻结终态与剩余 absence reasons。

正常退出停止新的 reservation，等待已经接纳的 Attempt publication，再提交 Run close。

SIGINT 与 SIGTERM 走同一受控路径：发布已经完成的 Attempt，并把没有 publication 的 slot 以 `interrupted-before-publication` 收口。
它返回 `interrupted` receipt，并在同一收尾路径把 Session 收口为 durable Invocation projection。
随后关闭 writer、checkpoint 并 truncate WAL，再以内建只读路径重开 canonical database。
只有 schema、引用闭包、publication 和领域不变量验证全部通过，CLI 才成功交付 receipt 与 portable Record。

## 崩溃与 recovery

SIGKILL 可能在 ProjectDatabase 中留下 `active` Run 与未发布 aggregate，但不会产生半个公开 Attempt。普通读取继续展示
Run、已发布 Attempt 与 pending slots，不根据时间推断 owner 已死，也不在打开时删除或晋升运行中 rows。

`run recover` 必须取得精确 process identity 已终止的可验证证据。它以两阶段、可重试的 `active → recovering → interrupted` 收口。
第一笔短事务 fence owner generation 并写入精确 recovery actor。第二笔短事务在 actor/generation 仍匹配时删除仅属该 owner 的未发布 aggregate。
第二笔事务也写 recovery receipt，并把 Run 与 pending-slot absence reasons 共同收口。

任一步崩溃留下 `recovering`，只能由新的精确 recovery actor 重试，不能把它猜回 active 或 free。证据不足时 fail closed；没有 TTL、heartbeat expiry 或“看起来很久”接管。

旧 generation 无论迟到多久都不能发布 Attempt。所有终态也拒绝任何 generation 的新写入。recovery 是领域状态收口，
不会删除 Run 或 Attempt。

## 删除与 retention

`run delete` 只处理已收口 Run。它与 reference binding 串行化，事务内检查 incoming references 并发布 tombstone。
存在依赖时零删除；用户需要先显式删除依赖 Run。

删除在 canonical `.niceeval/record.sqlite` 的一个事务中验证引用、删除可删 rows 并发布 tombstone。
事务前 crash 不改变事实；事务提交后，新的 PublicationCutoff 不再读取该 Run。删除不产生另一份 SQLite。

Record open 只接受精确 current schema。旧 schema、未知 schema 和缺少当前 publication 不变量的 database 都 fail closed，
不做 compat read、migration 或修补；原项目必须用 current NiceEval 重新运行。若旧 locks 或 sessions rows 非空，任何 writer
mutation 都 fail closed：不迁移、不自动删除、也不以新格式改写。checkpoint、空间回收、generation lease 与 staging GC 都由内部 adapter 管理，不形成 maintenance 命令。
