# PLAN-2：一 Run 一 SQLite application file —— Use Case

本页保留历史映射，并显式列出本候选不能兑现的共同 Cases。

契约单源在 [README](../README.md)、[Library](../library.md)、[Architecture](../architecture.md) 与 [Lifecycle](../lifecycle.md)。
本页只把共同 [Cases](../../CASES.md) 代入本候选。

| Case | 本候选路径 |
|---|---|
| RS1 | rich payload 作为 canonical opaque bytes row写入；logical API 不出现 SQL |
| RS2 | chunk rows 可以滚动，但 final DB 不能跨 durable members；任意增长最终撞到单文件 ceiling，本候选不能兑现 |
| RS3 | 每次 append 插入 item row；Attempt complete 写 collection inventory；public read 查询并形成完整 array |
| RS4 | 真实 item-count/bytes/nodes/depth cap check 在 insert 前完成；超 cap 不插入，state row 保存 partial limitation |
| RS5 | retained rows保持；Attempt interrupted 在 logical collection state 添加 capture limitation |
| RS6 | 不同 Run 各自 actor/DB；同 Run actor公平串行 bounded statements |
| RS7 | chunk row/index transaction、export、fsync 与 rename fault 只产生 absent 或完整 final database |
| RS8 | fixed query 只读 requested Attachment；Content chunks 在 handle 被消费时读取；collection read 仍取全部 rows |
| RS9 | database integrity、row/chunk digest、reference 或 Seal 失败都使 closure invalid |
| RS10 | exporter 按 generic rows和 raw bytes/chunks复制 unknown family，不解释业务字段 |
| RS11 | active DB/WAL 在 portable root 外；Git/copy 只见 no-replace rename 后的 final file |
| RS12 | exporter、临时空间、fsync 或 rename failure 返回 publication failure；旧 facts不变 |
| RS13 | 三个 Content 分别形成 ordered chunk rows；总量超过 128 MiB 不阻止 logical Attachment finalize 或 final export |
| RS14 | 小 Content 共用 generic content/chunk tables；结构 cap 在下一 row 前 fail closed，不形成新 logical Attachment 或领域 partial |
| RS15 | logical length 可从 row 读取，whole-value read admission 可与 validity 分开；这不修复 final DB 单文件上限 |
| RS16 | SQLite integrity 与 exact schema可以识别部分损坏，但 filesystem extra-member Case 与单文件 publication 不是 rolling Seal 协议 |
| RS17 | chunk/index rows 可增加，final SQLite member不能 rollover；本候选不能兑现 metadata/member rollover |

本候选不能兑现 RS2 与 RS17，因此退出 live 比较。
历史风险仍包括：

- actor fairness、流式路径与 hostile ordinary open；
- fixed exporter 与 Seal 正确性；
- 144 MiB aggregate Content 与 many-small-Content ceiling；
- publication crash matrix。
