# PLAN-3：SQLite inventory + 外部 Content packs —— Use Case

契约单源在 [README](../README.md)、[Library](../library.md)、[Architecture](../architecture.md) 与 [Lifecycle](../lifecycle.md)。
本页只把共同 [Cases](../../CASES.md) 代入本候选。

| Case | 本候选路径 |
|---|---|
| RS1 | rich payload 进入 generic SQLite row；没有 Content 时不创建 pack range |
| RS2 | 大于旧 64 MiB 的 Content 跨至少两个 external data packs；writer/stream reader只持有 bounded buffer/page |
| RS3 | 每次 append 插入 SQLite item row；Attempt complete 写 state；public read形成完整 array |
| RS4 | 真实 item-count/bytes/nodes/depth cap check 在 insert 前执行；超 cap 不写 row，state 保存 partial limitation |
| RS5 | retained rows保持；Attempt interrupted 写 logical capture limitation |
| RS6 | 不同 Run 使用独立 actor/directory；同 Run database 与 pack I/O 受同一个 Host backpressure policy约束 |
| RS7 | data/index/catalog/Seal rollover、small roots、fsync 与 database draft只在 staging；完整 directory validation 后才 rename |
| RS8 | requested Attachment query不触碰无关 rows；Content handle消费时才读取 external ranges |
| RS9 | database、descriptor、index、range、reference 或 Seal 任一不一致都使 Run invalid |
| RS10 | migration 按 generic DB inventory和 authenticated external ranges流式复制 unknown family |
| RS11 | active DB/WAL/packs位于 portable root 外；whole-Run directory rename 是 publication commit |
| RS12 | metadata export、pack fsync、directory fsync 或 rename failure 都不产生成功 receipt |
| RS13 | 三个 Content 通过同一 external index 跨 rolling packs 保存；总量超过 128 MiB 不改变 SQLite descriptor 或成功条件 |
| RS14 | 小 Content 共享 external members 与 generic descriptors；结构 ceiling 在下一 row/range 前 fail closed，不形成领域 partial |
| RS15 | `content.byteLength` 不读 packs；整体读取 admission 被拒绝时仍可 stream，Attachment 保持 available |
| RS16 | rolling Seal 与 directory merge拒绝 extra/missing/truncated；ordinary requested row不冒充完整 Run validation |
| RS17 | external range index 与 Seal inventory可以跨多个 metadata pages；SQLite 只保留小 association |

本候选在契约上可以兑现共同 Cases，但不因此获得对等采用地位。
只有 PLAN-1 framing/RS3 失败且 item-level lazy reader成为产品目标时，SQLite item store的收益才足以支付双 storage protocol 成本。
