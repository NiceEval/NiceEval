# PLAN-4 —— Lifecycle

## Initialize 与 open

首次 create 以 private schema transaction 建立 `record.sqlite`，写入 format identity、storage revision 和初始 migration identity。并发首次 create 由 SQLite create/open 结果与 NiceEval schema identity共同裁决，不能由最后写入者取代先创建的 identity。

ordinary open 验证 database header、format identity、storage revision 与固定 schema allowlist。它不自动 migrate，也不在启动时扫描全部 Run 或执行全库完整验证。

## 并发运行

多个 `niceeval exp` 进程可以在同一 project root 创建不同 Run。每个进程打开自己的 connection 和 dedicated storage worker；SQLite WAL 协调 reader 与短 write transaction。

```text
process A: append A1 ─ commit ─ append A2 ─ commit
process B:        wait ─ append B1 ─ commit
process C: read sealed Run throughout
```

write lock 的持有范围只是 bounded row batch。模型调用、Sandbox 执行、capture 等待与 Content source backpressure 都发生在 transaction 外。

storage worker 先取得 per-root writer admission，再尝试 SQLite write lock。
每张 admission ticket 只允许一个 bounded batch；batch commit 后必须交还，不能在同一 ticket 内连续清空整个 Run 的 backlog。

取消发生在 command 原子 enqueue 前时不产生 sequence；发生在 enqueue 后时只取消调用方等待，已经接纳的 command 仍属于 Attempt backlog。Process 在 commit 后、ack 前崩溃时，recovery 用完整冻结 command identity 重读 committed row；完全匹配返回成功，不同 identity 或 digest 返回 conflict。

不同 NiceEval 版本先比较 storage revision。Current writer 遇到 predecessor 返回 migration-required；旧 writer 遇到 newer schema 返回 unsupported。Schema migration 必须等待所有 append/read session 退出并取得 exclusive maintenance lease。

## Seal

Attempt complete 先封口各自 Attachment 与 collection state。Run finalizer 停止新的 producer command，把 Run 切到 `sealing`，随后流式验证 closure。

最终短 transaction 重新验证 writer generation 和 inventory identity，写 Seal rows并切到 `sealed`。Crash 发生在 Seal row insert 后、`COMMIT` 前时，SQLite 回滚全部 Seal rows并保留 `sealing`；ordinary reader 不可见，recovery finalizer 重新验证后恰好 seal 一次。Commit 后 reader 可以完整看到 sealed Run。Receipt 发生在 commit 后，receipt 丢失不改变 Run validity。

## Snapshot、copy 与 Git

活动 database 的 raw main-file copy 不受支持。
Host snapshot 先按 root bytes、可用空间、观测 throughput 与 caller deadline 做 preflight，再取得 per-root snapshot barrier。

Barrier 先阻止所有新 write transaction 进入 admission，再等待已经开始的真实 SQLite transaction commit 或 rollback。Mailbox 中尚未开始的 command 留在 backlog，不被误算成 in-flight transaction。

barrier 内只使用 SQLite backup 形成目标 database；backup 运行在可终止的 maintenance unit 中。backup 完成后立即释放 source barrier，让 producer 的 storage backlog 继续前进。随后在独立 target 删除 `open` / `sealing` closure、用 `VACUUM INTO` 重写 sealed-only database、验证 exact Seal、checkpoint并关闭。
producer 可以继续模型或 Sandbox 工作，但 storage command 在 barrier 释放前排队；deadline 到达时 snapshot 返回 typed contention failure。

实测中 backup 在 1,000 个连续外部 transaction 下 restart 1,001 次，只在 writer 停止后完成。
因此本候选不允许无 barrier 的 backup 依赖偶然 quiet window。

普通 filesystem copy 或 Git 操作只接受 Host 已经关闭并验证的 sealed-only snapshot。Operational `record.sqlite` 不因 writer 停稳就自动变成 share-safe bytes；SQL `DELETE` 也不能证明 free pages 不含未发布材料。

Git 可以保存 sealed-only snapshot，但 binary diff 和分支 conflict 是本候选的已知代价。Git merge 不能成为 row merge protocol。

## Maintenance

Maintenance 取得 exclusive lease 后执行：

- 删除经过重验仍为 `open` / `sealing` 的 incomplete rows；
- 规划并应用 schema/family migration；
- 形成 snapshot；
- 导入并验证外部 snapshot；
- 运行 full integrity 与 logical closure validation；
- 按明确命令执行 checkpoint 或空间回收。

只改 metadata 的相邻 schema migration 可以使用 exclusive transaction。
需要 rebuild 大表或改写大量 family bytes 时，maintenance 形成 copy-on-write target，验证成功后才原子替换 source。

ordinary read 不删除 rows、不 checkpoint、不 migrate，也不把 cache 写回 portable database。

## 退出与 crash recovery

正常退出先停止新 write command，等待当前短 transaction，关闭 read session，再关闭 database connection。最后一个 WAL connection 可以完成 SQLite 自己的 cleanup。

进程崩溃后，第一个 opener 可能执行 WAL recovery并短暂持有 exclusive lock；其它进程把这段状态视为可等待的 contention。Recovery 后仍只有 `sealed` Run 对 ordinary reader 可见。
