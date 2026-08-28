# Run Lifecycle

本页拥有 Run Host、Runner、Inspection 与内部持久 adapter 之间的跨 owner 顺序。

## 创建与执行

```text
Invocation starts
  → create Run: freeze expected slots + invocationId + writer generation
  → publish origin/reference slot bindings independently
  → close Run: terminal state + absence reasons
  → return InvocationReceipt at one PublicationCutoff
```

Run create 一旦提交就进入 `run list`。Attempt 可以分批进入内部 staging；只有 publication transaction 提交后才
公开。Run close 不重新发布或撤销 Attempt，它只冻结终态和剩余 slot 的 absence reasons。

正常退出停止新的 reservation，等待已经接纳的 Attempt publication，再提交 Run close。SIGINT 尽力发布已经完成的
Attempt，把没有 publication 的 slot 以 `interrupted-before-publication` 收口，并返回 `interrupted` receipt。

## 崩溃与 recovery

SIGKILL 可能留下 `active` Run，但不会产生半个公开 Attempt。普通读取继续展示该 Run、已发布 Attempt 与 pending
slots，不根据时间推断 owner 已死。

`run recover` 必须取得 owner 已终止的可验证证据。它以 CAS 推进 writer generation，先永久 fence 旧 writer，再在
同一受保护流程中把 Run 收口为 `interrupted` 并为 pending slots 写 absence reasons。证据不足时 fail closed；没有
TTL、heartbeat expiry 或“看起来很久”接管。

旧 generation 无论迟到多久都不能发布 Attempt。所有终态也拒绝任何 generation 的新写入。recovery 是领域状态收口，
不会删除 Run 或 Attempt。

## 删除与 retention

`run delete` 只处理已收口 Run。它与 reference binding 串行化，事务内检查 incoming references 并发布 tombstone。
存在依赖时零删除；用户需要先显式删除依赖 Run。

正在使用旧 PublicationCutoff 的 reader 可以继续完成。SQLite generation、旧版本 retention、migration、checkpoint、
空间回收与 staging GC 都由内部 adapter 自动管理，不形成 `record clean`、`record migrate` 或 snapshot 用户流程。
