# SQLite 存储与资源生命周期

本页定义内部 SQLite adapter 的物理策略，不增加公共 Record writer 或 SQL API。
数据库归属见[持久化与 Repository 边界](../../../architecture.md#持久化与-repository-边界)。
Run 状态、Attempt publication、portable gate 与迁移继续由 [Run 架构](README.md) 定义。

## 逻辑事实与物理行

ProjectDatabase 使用仓库拥有的 STRICT schema、固定 prepared statements 与 typed row decoder。
Core、附件、collection item、reference、Content chunk 与 publication closure 都在同一数据库中。
family 不拥有 table；Host 按通用字段保存未知 family 的原始 bytes 与引用关系，不要求先解码其业务 Schema。

Content metadata 保存逻辑 identity、byte length、整体 digest 与 chunk count。
chunk rows 按 Content identity 与 ordinal 唯一排列，单行受内部结构上限保护。
输入 Stream 的 chunk 不决定持久 ordinal、row size 或事务边界；物理分块不改变逻辑 bytes、digest 或 family revision。
作者不选择 path、table、index、pragma、transaction 或 chunk size。

Host 在接纳前验证并冻结 command identity、canonical bytes 与 digest。
mailbox 同时按 encoded bytes 和 command count 施加 backpressure，不通过丢弃 item 取得进展。
builder 与 Content source 在事务外消费一次；SQLite busy retry 只重新提交冻结 command，不重新执行作者代码。
已接纳 command 属于所属 Attempt 的 backlog，取消调用方等待不能撤回它。

同一 command identity 的重试只有在完整 identity 与 digest 一致时才能返回已提交结果。
commit 后、ack 前的进程终止不改变提交事实；无法确认的 commit 必须重读确认，不能猜成功。
identity 冲突或后台 storage failure 使所属 writer fail closed，不能静默少写后发布完整 closure。
未发布与已发布 facts 的可见性遵守 [Attempt publication](README.md#attempt-publication)，不由物理文件或 chunk 的存在决定。

## 写入进展与事务

持续写入由每个进程至多一个 dedicated storage worker 负责，避免同步 SQLite 长期阻塞运行主线程。
多个本机进程共享 WAL；任一时刻只持有一个短 write transaction。
网络、Provider、模型、Sandbox 与 producer 等待都在事务外，Content 按有界 row/byte batch 提交并释放锁。
WAL 只用于具备相应 shared-memory 与 locking 语义的本机 filesystem。

SQLite file lock 不提供公平性。
worker 在尝试 write lock 前先进入 ProjectDatabase 内 Host-owned coordination tables 的 FIFO writer admission。
每个进程至多一个 waiter，每张 ticket 只执行一个有界 batch；提交后交还 ticket，有 backlog 时重新排队。
取消、deadline 或经证明的 owner 终止均释放或回收 admission；后续健康 waiter 继续前进。
owner 终止证明遵守 [Run recovery](lifecycle.md)，不能用 TTL 或 PID 猜测代替。

同一 operation deadline 约束 admission 与 SQLite busy wait；耗尽形成具名 contention failure，不形成业务 partial。
writer admission、portable barrier 与协调事实都属于内部 SQLite adapter，不通过 JSON sidecar、第二份数据库或通用锁 API 暴露。
portable gate 仍按 [Run 架构](README.md#portable-gate-与不可信输入) 拒绝活动工作，不把 admission 队列排空视为 gate 成功。

## 按需读取与验证

短生命周期 query/show 直接打开 read-only connection，完成固定查询后关闭，不启动 storage worker。
持续 Inspection session 也不长期持有 read transaction；固定 cutoff 后只读所需的 immutable facts。
family 查询使用 owner/family index，只有消费 Content 时才按 ordinal 增量读取 chunk，并在交付后释放临时 buffer。
整体 bytes/text 读取在分配前执行 admission；拒绝整体读取不能把有效 Content 判为 corruption。

hostile reader 使用 exact schema allowlist、runtime limits、defensive mode 与 `trusted_schema=OFF`。
它关闭 extension loading，将 `ATTACH` limit 设为零，并以 authorizer 拒绝 DDL、写入及非 `main` database access。
SQLite integrity 不能代替 publication closure、Content length/digest 与引用的验证。
本机 operational 信任与外部输入的验证强度分别遵守 [Inspection 读取边界](../../inspection/architecture.md#读取信任与成本)。

50,000 items 与合计 144 MiB Content 的功能依据见[SQLite 采用收据](../../../research/record-storage/root-wide-sqlite-receipt.md)。
它证明增量处理、完整性与资源生命周期，不构成 heap、RSS、latency、throughput、database growth 或 Git growth SLO。

## 跨库汇合与子集导出

跨库汇合由 `run import` 驱动。它先以只读 defensive reader 验证外部单文件 Record 的 Schema、publication closure 与 Content digest。
验证通过后，在 ProjectDatabase 的短事务内增量写入选定 Run、Planned attempt、Attempt immutable closure、family facts 与对应 Content chunks。
若目标库已存在相同 Run ID 且各字段散列一致，判定为幂等跳过；若 Run ID 冲突但内容不一致，则完整回滚并报告具名错误。
提交后更新当前 ProjectDatabase 的发布时钟，使汇入事实对后续 Inspection 与缓存复用立即生效。

子集导出由 `run export` 驱动。它接收显式 Run ID 列表，提取目标 Run 及其传递依赖的全部 Attempt、family facts 与 Content chunks。
导出直接写入独立的全新单文件 SQLite 数据库，并封口为自洽的 Record publication envelope。
导出文件不包含未选中的历史 Run、临时 coordination 状态与未引用的 chunk，确保离线交付独立可用。
