**相关文档**：[README](README.md) · [Goals](GOALS.md) · [Cases](CASES.md) · [Decision](DECISION.md)

# Limits

| ID | 共同约束 |
|---|---|
| L1 | Record root 是用户可整体复制并交给 CLI 的 opaque directory；Git 是常见运输方式，但 Git 对体积或文件数的拒绝不改变 Record validity |
| L2 | rich family 通过 `defineAttemptRecord` / `defineRunRecord` create-once write；Content 与 reference 只能在 matching owner session mint |
| L3 | Attempt Record collection 只接受 context-free plain-data item；`start/append` 在 Attempt complete 时封成一份 logical Attachment value |
| L4 | collection reader 返回完整 `{ collection, items }` value；本决策不能假设公开 item cursor 或分页 API 已存在 |
| L5 | collection cap、`retained` / `omitted` receipt、complete/partial 与 interruption limitation 是业务可观察语义，不能被物理 storage 改写 |
| L6 | 并发 append 的数组顺序是 Host mutex 的线性化顺序；业务顺序由 item 自带的 session/turn index 或稳定 ID 表达 |
| L7 | payload JSON 上限为 4 MiB；Core 不限制单 logical Content、Attachment Content 合计或 Run Content 合计；family `maximumBytes` 只表达该字段真实的领域值约束，省略即没有 family byte cap |
| L8 | durable JSON 另有 depth、node、array、key 与 string 上限；resource limit 是具名 failure，不自动变成业务 partial |
| L9 | 现行 writer 会把 Content Stream 全部合成一个 `Uint8Array`；simple collection 也先在内存保存完整安全前缀 |
| L10 | blob Roadmap 已固定 logical Content 与 physical segments 分离、Attachment closure 自包含、producer 不选择 chunk |
| L11 | durable bytes 与 unknown family 都是不可信输入；第三方 family 不能提供 path、SQL、table、index 或 storage capability |
| L12 | published Run immutable；ordinary read 不静默 migration，显式 migration 使用 copy-on-write 与相邻转换链 |
| L13 | SQLite 同一 database 同时只有一个 writer；transaction 期间 journal/WAL sidecar 是 database state 的组成部分 |
| L14 | Node v24 的 `node:sqlite` public API 是同步 API，没有 incremental BLOB handle；大 Content 需要 Host 自己形成 bounded chunk rows |
| L15 | SQLite final snapshot、directory manifest 与 Content pack 都是 storage protocol；SQLite transaction 不能代替 outer publication commit |
| L16 | Content handle、durable member count/bytes、index/catalog page 与 entry、frame/segment、Seal inventory、depth、nodes、path、safe integer 与 offset 仍受 storage-neutral 结构 ceiling 保护；这些 ceiling 约束协议形状，不恢复 64/128 MiB 产品 cap |
| L17 | cancellation、filesystem quota、disk full 与 typed I/O failure 可以终止未发布 write；它们不形成 portable identity，也不能让已发布的大 Run 被误报为 corruption |
| L18 | RS3 的目标 collection cap 必须容纳 50,000 个固定 tiny items；item count 以外仍同时受实测 encoded bytes、nodes 与 depth cap 约束，当前 4,096 / 768 KiB 只是实现事实 |
| L19 | 同一 storage revision 的 reader、publisher 与 migration 强制相同结构 ceiling；rollover threshold、buffer 与 cap 内 grouping 保持 Host 私有，不能改变同一 published closure 的 validity |
| L20 | 失败分三层：digest、缺失、额外、截断或非法 codec 是 published corruption；超出本 storage revision 结构 ceiling 是 structure invalid；内存、时间、取消、disk、inode 与 I/O 是本机 admission/resource failure |
| L21 | writer 保留 `content.text`、`content.bytes` 与 `content.stream`；reader 保留 `content.text`、`content.bytes`、`content.stream` 并提供不读取 bytes 的 logical `byteLength`；整体读取没有公开 `maximumBytes` 参数 |

## 候选清单

- [PLAN-1](PLAN-1/README.md)：canonical JSON envelope、Host 私有 framed pack sets 与 whole-Run directory rename。
- [PLAN-2](PLAN-2/README.md)：历史上的单 SQLite application file；它不能同时满足 durable-member ceiling 与无 Run Content cap。
- [PLAN-3](PLAN-3/README.md)：条件后备；SQLite 保存 logical inventory 与 collection item，Content 进入同一 Run directory 的外部 rolling packs。

全 JSON 不是候选。
它要求 binary base64、整体 encode/decode 与 append 重写，已经与 L7–L10 的真实失败和有界内存目标冲突。

外部事实与版本证据见
[便携格式](../../research/record-storage/portable-formats.md)、
[Artifact systems](../../research/record-storage/artifact-systems.md) 和
[Eval platforms](../../research/record-storage/eval-platforms.md)。
