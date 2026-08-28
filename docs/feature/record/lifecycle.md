# Record Lifecycle

本页拥有跨 Record Host、Coordination、capture authority、maintenance 与 CLI 的运行顺序。

## Initialize 与 ordinary open

首次 create 用 private transaction 从全局 migration 1 顺序执行到 current，写 format identity、每步 migration receipt、storage revision
与 Host-only coordination tables。并发首次 create 由 SQLite create/open 结果与 exact NiceEval schema identity 裁决，后来的
opener 不能取代已有 identity。

ordinary open 验证 header、format identity、storage revision、schema allowlist 与当前 operation 所需 index。它不自动 migrate、
不扫描所有 Run、不做全库 integrity check，也不删除 incomplete rows。

## Write timeline

```text
capture fiber
  → encode immutable command
  → bounded count+bytes mailbox admission ack
  → dedicated storage worker
  → ProjectDatabase Host-only coordination-table writer admission ticket
  → bounded batch short transaction
  → durable result
  → Attempt backlog fence
  → Run sealing validation
  → final Seal transaction
```

多个 `niceeval exp` process 可以在同一 store 创建不同 Run。每个 process 只有一个 worker；SQLite WAL 协调 read 与 short write，
ProjectDatabase Host-only coordination-table FIFO admission 防止一个 process 连续占有 writer。一个 ticket 只提交一个 bounded batch。

builder、Schema encode、Stream consumption、provider、Sandbox 与模型工作都在 transaction 外。worker 可以把多个 admitted
command 合为一个 batch；batch boundary 由 Host 的 row/byte budget 决定，不由 producer 的 Stream chunk 决定。

取消发生在原子 enqueue 前时不产生 sequence；enqueue 后只取消调用方等待，command 留在 backlog。每个 append 的成功 ack
只证明 admission。`attempt.complete()` 关闭新 admission、等待所有已接纳 sequence durable、传播后台 failure，并拒绝未 close
collection。只有所有 Attempt fence 成功后，`run.seal()` 才能把 Run 改为 `sealing`。

finalizer 在 transaction 外流式验证 Core、generic Attachment rows、items、references、Content length/digest、unknown family
inventory 与候选 Seal。最终短 transaction 重验 writer generation 和 inventory identity，写全部 Seal rows 并切到 `sealed`。
ordinary reader 要么看不到 Run，要么看到完整 sealed closure。

## Read timeline

短 `query` 直接打开 read-only connection，执行 fixed operation 后关闭。持续 View session 也只保存 logical cutoff，
detail operation 每次短暂重开 immutable facts，不长期保持 read transaction。

whole-value `read()` 先检查 admission；大 collection 通过 `openCollection()` 返回 self-scoped Stream。每次执行 Stream 取得
generation lease 和自己的 connection，分页交付后释放 buffer；Content Stream 同样按 bounded chunk rows 工作。提前停止、错误、
中断或 Scope close 都关闭 connection 与 lease。

## Snapshot timeline

```text
preflight
  → Host-only SQLite coordination-table snapshot barrier blocks new write transactions
  → drain only in-flight SQLite transaction
  → SQLite backup fixes source view
  → release source barrier and resume backlog
  → delete open/sealing closure and local coordination rows in target
  → VACUUM INTO sealed-only target
  → exact schema + Seal validation
  → checkpoint + close
  → RecordSnapshot
```

deadline 或资源预算无法满足时返回 `record-snapshot-busy`，不产生半有效 Snapshot。普通 filesystem copy 不能替代此流程。

## Migration 与 maintenance

schema/family migration、Snapshot 与外部 Snapshot import 都要求 exclusive maintenance lease。
full integrity/closure validation、checkpoint、space reclaim 与删除重验后仍 incomplete 的 rows 也使用同一 lease。
migration 必须等全部 writer/read generation lease 释放。

每个全局编号 migration 使用独立 transaction，转换、postcondition、receipt 与 revision 推进共同 commit；maintenance lease 在步骤间不释放。
未来大表 rebuild 或大量 family rewrite 才另行引入 copy-on-write target。physical-only migration 保留 `LogicalSealIdentity`；logical-data migration 重建
logical closure 与 Seal。

ordinary read 不删除、不 checkpoint、不 migrate，也不把 cache 写进 Record。

`UserDatabase` open 在业务请求前执行数据库级全局编号序列，显式 maintenance 调用同一 runner。
`0.14.0` 从真正空库执行全局 migration 1，不接纳 0.13.x predecessor。
它在同一 transaction 内建立所有第一方最终 schema、写全局 receipt 并设置 format identity。

unknown/future repository、ledger/schema 不一致或 allowlist 外对象全部 fail closed。
共享 SQLite 文件层面的 corruption、disk-full、WAL 或 lock failure 仍会按资源 failure 影响它们。
v2 不提供 raw UserDatabase portable backup。

## Shutdown 与 crash recovery

正常退出先停止新 admission，等待当前 transaction 与已接纳 backlog，完成或失败 Attempt fence，关闭 read Scope，再关闭 worker
与 connection。进程崩溃后，SQLite WAL recovery 可以短暂占有 exclusive lock；其它 process 把它视为有 deadline 的 contention。

recovery 后仍只有 `sealed` Run 对 ordinary reader 可见。command commit 后 ack 前退出由 frozen identity 重读确认；Seal transaction
commit 前退出整体 rollback，commit 后 receipt 丢失不撤销 publication。
