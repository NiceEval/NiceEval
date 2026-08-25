# PLAN-1：JSON envelope + Host 私有 packs —— Use Case

契约单源在 [README](../README.md)、[Library](../library.md)、[Architecture](../architecture.md) 与 [Lifecycle](../lifecycle.md)。
本页只把共同 [Cases](../../CASES.md) 代入本候选。

| Case | 本候选路径 |
|---|---|
| RS1 | 小型 rich payload 进入独立 canonical payload object；write/read logical value 不需要 item/content pack |
| RS2 | 私有 member ceiling 强制一个 Content 跨至少两个 packs；writer 与 stream reader 只持有 bounded buffer |
| RS3 | 每次 append 立即写 item frame/index；Attempt complete 只写 collection envelope；public read 形成完整 array |
| RS4 | 真实 item-count/bytes/nodes/depth cap check 在 frame append 前执行；超 cap 不写 frame，封口 envelope 保存 partial limitation |
| RS5 | 已写 prefix 保持不变；Attempt interrupted 在 envelope 加 capture limitation |
| RS6 | 不同 Run 各自写 directory；同 Run ordinal 由 owner mutex 分配，pack I/O 与 rollover 由 Host queue 调度 |
| RS7 | rollover/new-pack/first-segment/index/close/fsync/Seal 的 partial bytes 只在 staging；rename 后 recovery 只重验 destination |
| RS8 | reader 只打开 selected Attachment；未消费 Content 不打开 pack ranges；collection read 仍读取完整 item pack set |
| RS9 | envelope、frame、index、segment、reference 或 Seal digest 不一致都使 closure invalid |
| RS10 | maintenance 按 Seal inventory 复制 unknown envelope、pack 与 index bytes，不解释 family Schema；digest-file → rolling converter 也走同一 generic byte-preserving 路径 |
| RS11 | active staging 在 portable root 外；whole-Run directory rename 是 publication commit |
| RS12 | disk/fsync/rename failure 保留旧 published facts，并返回具名 storage failure |
| RS13 | 三个 logical Content 按同一 content index 跨 rolling packs 保存；总量超过 128 MiB 不改变 handle、family revision 或成功条件 |
| RS14 | 小 Content 共享 Attachment-local members；结构 cap 在创建下一 entry/range 前 fail closed，不形成新 logical Attachment 或领域 partial |

本候选完整兑现所有 Cases。
采用前的 spike 还必须提供：

- custom framing/index verifier 与 pack corruption fault injection；
- rollover file count 与 many-small-Content index ceiling；
- 50,000 item full-read RSS/latency；
- 144 MiB aggregate Content receipt。
