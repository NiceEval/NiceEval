# PLAN-1：JSON envelope + Host 私有 packs —— Use Case

契约单源在 [README](../README.md)、[Library](../library.md)、[Architecture](../architecture.md) 与 [Lifecycle](../lifecycle.md)。
本页只把共同 [Cases](../../CASES.md) 代入本候选。

| Case | 本候选路径 |
|---|---|
| RS1 | 小型 rich payload 进入独立 canonical payload object；write/read logical value 不需要 item/content pack |
| RS2 | 大于旧 64 MiB 的 Content 跨至少两个 data packs；writer/stream reader 不形成完整数组，只持有 bounded buffer/page |
| RS3 | 每次 append 立即写 item frame/index；Attempt complete 只写 collection envelope；public read 形成完整 array |
| RS4 | 真实 item-count/bytes/nodes/depth cap check 在 frame append 前执行；超 cap 不写 frame，封口 envelope 保存 partial limitation |
| RS5 | 已写 prefix 保持不变；Attempt interrupted 在 envelope 加 capture limitation |
| RS6 | 不同 Run 各自写 directory；同 Run ordinal 由 owner mutex 分配，pack I/O 与 rollover 由 Host queue 调度 |
| RS7 | data/index/catalog/Seal rollover、small root、fsync 与 complete 的 partial bytes 只在 staging；rename 后 recovery 只重验 destination |
| RS8 | reader 只打开 selected Attachment；未消费 Content 不打开 pack ranges；collection read 仍读取完整 item pack set |
| RS9 | envelope、root、frame、page、segment、reference 或 Seal digest 不一致都使 closure invalid |
| RS10 | Host 按 authenticated inventory 在 `RecordSnapshot` 中保留 unknown envelope、root、pack 与 page bytes；v1 不导入 0.13.x digest-file bytes，也不提供 converter |
| RS11 | active staging 在 portable root 外；whole-Run directory rename 是 publication commit |
| RS12 | disk/fsync/rename failure 保留旧 published facts，并返回具名 storage failure |
| RS13 | 三个 logical Content 按同一 content index 跨 rolling packs 保存；总量超过 128 MiB 不改变 handle、family revision 或成功条件 |
| RS14 | 小 Content 共享 Attachment-local members；结构 ceiling 在下一 entry/range 前以 structure-invalid fail closed，不形成领域 partial |
| RS15 | `content.byteLength` 不打开 data；`bytes/text` admission 被拒绝时 Attachment 仍 available，`stream` 可以完整读取 |
| RS16 | full validator 流式 merge inventory 与 directory，拒绝 extra/missing/truncated；ordinary unrelated-family read 不冒充完整验证 |
| RS17 | harness 强制 range index 与 Seal inventory 分别跨多个 pages；reader 和 validator 正确遍历全部 closure，不暴露 page/segment |

本候选已经为所有 Cases 定义协议路径，但还没有取得采用收据。
采用前的 spike 还必须提供：

- custom framing/catalog/range/Seal verifier 与 pack corruption fault injection；
- rollover file count 与 many-small-Content index ceiling；
- 50,000 item 的完整 append、seal、admitted read 与 Stream read；
- 大于旧 64 MiB 的单 Content 与 144 MiB aggregate Content receipt；
- whole-value read admission 与 metadata rollover receipt。
