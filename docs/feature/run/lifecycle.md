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
公开。staging 与 canonical `.niceeval/record.sqlite` 物理分离且从不成为 recovery source。Run close 不重新发布或撤销
Attempt，它只冻结终态和剩余 slot 的 absence reasons。

正常退出停止新的 reservation，等待已经接纳的 Attempt publication，再提交 Run close。SIGINT 与 SIGTERM 走同一受控
路径：发布已经完成的 Attempt，把没有 publication 的 slot 以 `interrupted-before-publication` 收口，并返回
`interrupted` receipt。随后关闭 writer、checkpoint 并 truncate WAL，再以内建只读路径重开 canonical database。只有
schema、引用闭包、publication 和领域不变量验证全部通过，CLI 才成功交付 receipt 与 portable Record。

## 崩溃与 recovery

SIGKILL 可能留下 `active` Run 和 private staging，但不会产生半个公开 Attempt。普通读取继续展示 canonical database 中的
Run、已发布 Attempt 与 pending slots，不根据时间推断 owner 已死；下次打开只删除遗留 staging。

`run recover` 必须取得 owner 已终止的可验证证据。它以 CAS 推进 writer generation，先永久 fence 旧 writer，再在
同一受保护流程中把 Run 收口为 `interrupted` 并为 pending slots 写 absence reasons。证据不足时 fail closed；没有
TTL、heartbeat expiry 或“看起来很久”接管。

旧 generation 无论迟到多久都不能发布 Attempt。所有终态也拒绝任何 generation 的新写入。recovery 是领域状态收口，
不会删除 Run 或 Attempt。

## 删除与 retention

`run delete` 只处理已收口 Run。它与 reference binding 串行化，事务内检查 incoming references 并发布 tombstone。
存在依赖时零删除；用户需要先显式删除依赖 Run。

删除在 private generation 中重写完整 database，验证后以文件级原子替换 canonical `.niceeval/record.sqlite`。替换前 crash
不改变 canonical facts；替换后新 reader 只打开完整的新 generation。正在使用旧 PublicationCutoff 的 reader 可以继续完成，
旧 generation 安全后才回收。

Record open 只接受精确 current schema。旧 schema、未知 schema 和缺少当前 publication 不变量的 database 都 fail closed，
不做 compat read、migration 或修补；原项目必须用 current NiceEval 重新运行。checkpoint、空间回收、generation lease 与
staging GC 都由内部 adapter 管理，不形成 maintenance 命令。
