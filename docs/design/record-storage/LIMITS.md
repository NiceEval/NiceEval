**相关文档**：[README](README.md) · [Goals](GOALS.md) · [Cases](CASES.md) · [Decision](DECISION.md)

# Limits

| ID | 共同约束 |
|---|---|
| L1 | Record root 是用户可整体复制、提交 Git 并交给 CLI 的 opaque directory；用户不直接消费内部布局 |
| L2 | rich family 通过 `defineAttemptRecord` / `defineRunRecord` create-once write；Content 与 reference 只能在 matching owner session mint |
| L3 | Attempt Record collection 只接受 context-free plain-data item；`start/append` 在 Attempt complete 时封成一份 logical Attachment value |
| L4 | collection reader 返回完整 `{ collection, items }` value；本决策不能假设公开 item cursor 或分页 API 已存在 |
| L5 | collection cap、`retained` / `omitted` receipt、complete/partial 与 interruption limitation 是业务可观察语义，不能被物理 storage 改写 |
| L6 | 并发 append 的数组顺序是 Host mutex 的线性化顺序；业务顺序由 item 自带的 session/turn index 或稳定 ID 表达 |
| L7 | payload JSON 上限为 4 MiB；单 Content 上限为 64 MiB；一个 Attachment 的 Content 合计上限为 128 MiB |
| L8 | durable JSON 另有 depth、node、array、key 与 string 上限；resource limit 是具名 failure，不自动变成业务 partial |
| L9 | 现行 writer 会把 Content Stream 全部合成一个 `Uint8Array`；simple collection 也先在内存保存完整安全前缀 |
| L10 | blob Roadmap 已固定 logical Content 与 physical segments 分离、Attachment closure 自包含、producer 不选择 chunk |
| L11 | durable bytes 与 unknown family 都是不可信输入；第三方 family 不能提供 path、SQL、table、index 或 storage capability |
| L12 | published Run immutable；ordinary read 不静默 migration，显式 migration 使用 copy-on-write 与相邻转换链 |
| L13 | SQLite 同一 database 同时只有一个 writer；transaction 期间 journal/WAL sidecar 是 database state 的组成部分 |
| L14 | Node v24 的 `node:sqlite` public API 是同步 API，没有 incremental BLOB handle；大 Content 需要 Host 自己形成 bounded chunk rows |
| L15 | SQLite final snapshot、directory manifest 与 Content pack 都是 storage protocol；SQLite transaction 不能代替 outer publication commit |

## 候选清单

- [PLAN-1](PLAN-1/README.md)：canonical JSON/JSONL envelope、Host 私有 Content pack 与 whole-Run directory rename。
- [PLAN-2](PLAN-2/README.md)：generic SQLite tables 同时保存 rich payload、collection item、Content chunk 与 Seal，published Run 为单 final DB file。
- [PLAN-3](PLAN-3/README.md)：SQLite 保存 logical inventory 与 collection item，Content 进入同一 Run directory 的外部 pack。

全 JSON 不是候选。
它要求 binary base64、整体 encode/decode 与 append 重写，已经与 L7–L10 的真实失败和有界内存目标冲突。

外部事实与版本证据见
[便携格式](../../research/record-storage/portable-formats.md)、
[Artifact systems](../../research/record-storage/artifact-systems.md) 和
[Eval platforms](../../research/record-storage/eval-platforms.md)。
