# PLAN-3：SQLite inventory + 外部 Content packs —— Use Case

契约单源在 [README](../README.md)、[Library](../library.md)、[Architecture](../architecture.md) 与 [Lifecycle](../lifecycle.md)。
本页只把共同 [Cases](../../CASES.md) 代入本候选。

| Case | 本候选路径 |
|---|---|
| RS1 | rich payload 进入 generic SQLite row；没有 Content 时不创建 pack range |
| RS2 | 私有 member ceiling 强制一个 Content 跨至少两个 packs；writer 与 stream reader 只持有 bounded buffer |
| RS3 | 每次 append 插入 SQLite item row；Attempt complete 写 state；public read形成完整 array |
| RS4 | 真实 item-count/bytes/nodes/depth cap check 在 insert 前执行；超 cap 不写 row，state 保存 partial limitation |
| RS5 | retained rows保持；Attempt interrupted 写 logical capture limitation |
| RS6 | 不同 Run 使用独立 actor/directory；同 Run database 与 pack I/O 受同一个 Host backpressure policy约束 |
| RS7 | rollover/new-pack/first-segment/index/close/fsync 与 database draft 只在 staging；完整 directory validation 后才 rename |
| RS8 | requested Attachment query不触碰无关 rows；Content handle消费时才读取 external ranges |
| RS9 | database、descriptor、index、range、reference 或 Seal 任一不一致都使 Run invalid |
| RS10 | migration 按 generic DB inventory和 raw pack ranges复制 unknown family |
| RS11 | active DB/WAL/packs位于 portable root 外；whole-Run directory rename 是 publication commit |
| RS12 | metadata export、pack fsync、directory fsync 或 rename failure 都不产生成功 receipt |
| RS13 | 三个 Content 通过同一 external index 跨 rolling packs 保存；总量超过 128 MiB 不改变 SQLite descriptor 或成功条件 |
| RS14 | 小 Content 共享 external members 与 generic descriptors；结构 cap 在下一 row/range 前 fail closed，不形成新 logical Attachment 或领域 partial |

本候选在契约上可以兑现所有 Cases。
采用价值取决于 PLAN-2 的 Content chunk row/final export 是否出现真实瓶颈；没有该证据时，双 storage protocol 的复杂度缺少收益依据。
