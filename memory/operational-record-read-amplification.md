# Operational Record 读取重复验证全部历史

真实项目的 582 MB Record（11 Runs、283027 collection items）上，show 约 13.5 秒，其中重复 Seal、Content 与 collection 全量验证约占 81%。底层 reader 另做 quick_check / foreign_key_check，Inspection 预解码全部附件并重复拼装成员。

Host 自己的 project writer 已在 publication / seal 事务验证闭包。采用的边界是：operational reader 信任 Host-owned ProjectDatabase，保留精确 schema、migration readiness、legacy fail-closed 和 BEGIN pinned cutoff。实际读取 Core、Attachment 时继续严格 decode、校验摘要与关系。外部与捕获 Record、migration、seal/recovery 和完整性维护继续 full verification；不能把项目 reader 的信任扩展到未经导入的外部文件。

精确 locator / Run / Experiment 按目标选择 Core，并按使用惰性加载附件；当前 Results 可以读取全部 Core，但不预解码无关附件。成员、来源 Attempt 和资源 Slot 用共享 Map 索引；View generation 轮询只读 publication clock。惰性附件沿用同一 session 的关闭与截止期限检查，当前评估中的 I/O 用 Effect.try 保留失败通道。

回归通过公开 CLI 和自定义 Adapter 创建真实发布结果，比较加入两个含 60000 条 trace event 的无关 Attempt 前后的 locator、Run、Experiment 读取成本，不窥探 SQLite。原候选的 locator 从 437 ms 升至 6067 ms，违反 before * 2 + 750 ms 的包络；正式 red 绑定本 Problem epoch 0。外部损坏 Record 的 fail-closed 另由既有 source-diagnostics owner 验证。

本轮在只读源的临时副本比较三个命令，show 为 12.90 → 1.10 秒、locator 为 10.61 → 0.47 秒、Experiment 为 15.43 → 1.98 秒；输出逐字节相同。对应峰值 RSS 为 508 → 221 MiB、333 → 194 MiB、433 → 295 MiB。这是固定 Record 的本机测量，不是浏览器、CI 或所有规模下的复杂度证明。

仍需区分 payload 放大与 metadata 扫描。sealed cutoff 的 count 与 Experiment metadata 过滤仍随 Run 数增长，现有 schema 没有 Experiment 索引；本轮不改物理 schema。reuse/carry 的 captureReaderSnapshot 与 reuse-plan 仍构造全部历史快照，需要另行明确 scoped snapshot 的资源所有权。E2B cache generation 使用 MAX(generation)，没有相应索引；这里只取得静态成本证据，未测延迟。以上均不应被表述为已经实现严格 O(目标 Run 数) 的总成本。
