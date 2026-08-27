# PLAN-4 —— Cases

本页说明 root-wide SQLite 怎样兑现共同 [Cases](../../CASES.md)。

| Case | 路径 |
|---|---|
| RS1 | Rich fact 编成 canonical payload bytes并在短事务中提交 Attachment row；seal 后按 owner/family index 读回。 |
| RS2、RS13 | Input Stream 进入 bounded chunk row batch；整体 digest/length 单独保存，stream reader 按 ordinal 交付。 |
| RS3–RS5 | `append` / `appendAll(Stream)` 先 encode immutable snapshot，再经 bounded worker batch 进入 ordinal rows；cap 与 limitation 保持 logical fields，Attempt complete 等待 backlog 并关闭 collection state。整体 `read()` 有 admission 上限，`openCollection()` 按 row 流式读取。 |
| RS6 | 多进程连接共享 WAL writer；ProjectDatabase 的 Host-only coordination-table per-root writer admission、单 ticket 单 bounded batch、busy wait 与 deadline共同保证进展并形成 typed contention。 |
| RS7 | Fault points 包括 row batch、WAL sync、sealing、final commit、backup 与 receipt；reader 只选择 sealed status。 |
| RS8 | owner/family 与 content ordinal index 提供局部读取；未请求 Attachment 和未消费 Content 不取 BLOB。 |
| RS9、RS16 | SQLite structure check 与 Run Seal logical inventory分别检测 structure、missing、extra、digest 和截断。 |
| RS10 | Unknown family 使用 generic Attachment/item/reference/content rows；snapshot 和 migration 不调用 family Schema。 |
| RS11 | ProjectDatabase 的 Host-only coordination-table snapshot barrier 停止新事务并排空当前事务，再由 backup 固定 target；随后释放 source，在 target 删除 incomplete closure 与 local coordination 并 `VACUUM INTO` sealed-only snapshot。Operational database 不直接进入 copy/Git。 |
| RS12 | Disk、I/O、WAL、backup 或 seal resource failure 不切换 sealed status，也不形成成功 receipt。 |
| RS14、RS17 | Row、entry、chunk、inventory ceiling 与 SQLite page grouping 保持 Host 私有；validator 分 batch 流式遍历。 |
| RS15 | byteLength 只查 metadata；bytes/text 在分配前 admission，stream 继续按 chunk rows 成功读取。 |
| RS18 | 原子 enqueue 前取消不产生 sequence；enqueue 后 command 留在 backlog。完整 command identity 让 commit 后、ack 前终止可以安全重读；identity/digest conflict fail closed。 |
| RS19 | final Seal transaction 内终止会回滚所有 Seal rows并保留 `sealing`；ordinary reader 不可见，recovery finalizer 重验后只 seal 一次。Physical migration 保留 `LogicalSealIdentity`。 |
| RS20 | `UserDatabase` central backend 静态组合第一方 feature Repository；每个 Repository 就近拥有相邻 migration、固定 operation 与 typed decoder，central owner 只提供短事务 authority。没有 State module/SPI、lifecycle DSL、通用 SQL executor 或动态注册；Docker/E2B cache registry、Incus allocation/artifact ledger、user-level lease/coordination 与 credential reference 都不使用长期 JSON sidecar，secret 不入库。cache Repository failure 不成为其它 durable Repository 的逻辑前置。 |

采用收据必须使用真实 Node/SQLite driver、跨进程 writer、进程终止和 filesystem fault。In-memory SQLite 或单 connection fake 不能证明 RS6、RS7、RS11、RS12、RS18 与 RS19。

RS7、RS11、RS18 与 RS19 的真实 SQLite / child-process 收据见
[SQLite publication protocol](../../../../research/record-storage/sqlite-publication-protocol-receipt.md)。
RS6 与 RS11 的真实跨进程 FIFO / barrier 收据见
[SQLite Coordination](../../../../research/record-storage/coordination/sqlite-coordination-receipt.md)。
