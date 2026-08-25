# PLAN-1：JSON envelope + Host 私有 packs —— Use Case

契约单源在 [README](../README.md)、[Library](../library.md)、[Architecture](../architecture.md) 与 [Lifecycle](../lifecycle.md)。
本页只把共同 [Cases](../../CASES.md) 代入本候选。

| Case | 本候选路径 |
|---|---|
| RS1 | 小型 rich payload 直接进入 envelope；write/read logical value 不需要 pack |
| RS2 | Content source 进入 bounded segment buffer 和 `content.pack`；read 按 index 顺序消费 ranges |
| RS3 | 每次 append 立即写 item frame/index；Attempt complete 只写 collection envelope；public read 形成完整 array |
| RS4 | cap check 在 frame append 前执行；超 cap 不写 frame，封口 envelope 保存 partial limitation |
| RS5 | 已写 prefix 保持不变；Attempt interrupted 在 envelope 加 capture limitation |
| RS6 | 不同 Run 各自写 directory；同 Run ordinal 由 owner mutex 分配，pack I/O 由 Host queue 调度 |
| RS7 | rename 前所有 partial bytes 只在 local staging；rename 后 recovery 只重验 destination |
| RS8 | reader 只打开 selected Attachment；未消费 Content 不打开 pack ranges；collection read 仍读取完整 item pack |
| RS9 | envelope、frame、index、segment、reference 或 Seal digest 不一致都使 closure invalid |
| RS10 | maintenance 按 Seal inventory 复制 unknown envelope、pack 与 index bytes，不解释 family Schema |
| RS11 | active staging 在 portable root 外；whole-Run directory rename 是 publication commit |
| RS12 | disk/fsync/rename failure 保留旧 published facts，并返回具名 storage failure |

本候选完整兑现所有 Cases。
需要用 spike 证明的是 custom framing/index verifier、file-count、50,000 item read latency 与 pack corruption fault injection。
