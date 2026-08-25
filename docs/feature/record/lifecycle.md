# Record Lifecycle

本页拥有跨 Record Host、Coordination、capture authority、maintenance 与 CLI 的运行顺序。

## Initialize 与 ordinary open

首次 create 用 private schema transaction 建立 `.niceeval/record/record.sqlite`，写 format identity、storage revision 与初始
migration identity。并发首次 create 由 SQLite create/open 结果与 exact NiceEval schema identity 裁决，后来的 opener 不能取代
已有 identity。

ordinary open 验证 header、format identity、storage revision、schema allowlist 与当前 operation 所需 index。它不自动 migrate、
不扫描所有 Run、不做全库 integrity check，也不删除 incomplete rows。

## Write timeline

```text
capture fiber
  → encode immutable command
  → bounded count+bytes mailbox admission ack
  → dedicated storage worker
  → per-root writer admission ticket
  → bounded batch short transaction
  → durable result
  → Attempt backlog fence
  → Run sealing validation
  → final Seal transaction
```

多个 `niceeval exp` process 可以在同一 store 创建不同 Run。每个 process 只有一个 worker；SQLite WAL 协调 read 与 short write，
Coordination FIFO admission 防止一个 process 连续占有 writer。一个 ticket 只提交一个 bounded batch。

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
  → snapshot barrier blocks new write transactions
  → drain only in-flight SQLite transaction
  → SQLite backup fixes source view
  → release source barrier and resume backlog
  → delete open/sealing closure in target
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

相邻 metadata schema migration 可使用 exclusive short transaction；大表 rebuild 或大量 family rewrite 形成 copy-on-write
target，完整验证、fsync 后才替换 stable source。physical-only migration 保留 `LogicalSealIdentity`；family/data migration 重建
logical closure 与 Seal。

ordinary read 不删除、不 checkpoint、不 migrate，也不把 cache 写进 Record。

## Shutdown 与 crash recovery

正常退出先停止新 admission，等待当前 transaction 与已接纳 backlog，完成或失败 Attempt fence，关闭 read Scope，再关闭 worker
与 connection。进程崩溃后，SQLite WAL recovery 可以短暂占有 exclusive lock；其它 process 把它视为有 deadline 的 contention。

recovery 后仍只有 `sealed` Run 对 ordinary reader 可见。command commit 后 ack 前退出由 frozen identity 重读确认；Seal transaction
commit 前退出整体 rollback，commit 后 receipt 丢失不撤销 publication。
