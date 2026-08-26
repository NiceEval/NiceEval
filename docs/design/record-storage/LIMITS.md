**相关文档**：[README](README.md) · [Goals](GOALS.md) · [Cases](CASES.md) · [Decision](DECISION.md)

# Limits

| ID | 共同约束 |
|---|---|
| L1 | `ProjectRecordStore` 是本机 operational capability，不能复制、进入 Git 或作为 `--record` 输入；只有 Host 生成、物理移除未发布 bytes 并完整验证的 sealed-only `RecordSnapshot` 才是可搬运 Record |
| L2 | rich family 由 `Record.attempt` / `Record.run` 定义并经 owner-scoped `records.write` create-once 写入；Content 与 reference 只能在 matching owner session mint |
| L3 | Attempt Record collection 只接受 context-free plain-data item；`append` / `appendAll(Stream)` 增量写入，显式 `close(complete | partial)` 形成领域 completion fence |
| L4 | collection reader 同时提供有 admission 上限的整体 `read()` 与 self-scoped 流式 `openCollection()`；rowid、SQL cursor、page size 和 read transaction 都不进入公共协议 |
| L5 | collection cap、`retained` / `omitted` receipt、complete/partial 与 interruption limitation 是业务可观察语义，不能被物理 storage 改写 |
| L6 | 同一 owner/definition 的 item ordinal 是 Host admission 顺序；单个 `appendAll` 保持 source order，并发 source 可以在 batch 边界交错；业务顺序由 item 自带的 session/turn index 或稳定 ID 表达 |
| L7 | payload JSON 上限为 4 MiB；Core 不限制单 logical Content、Attachment Content 合计或 Run Content 合计；family `maximumBytes` 只表达该字段真实的领域值约束，省略即没有 family byte cap |
| L8 | durable JSON 另有 depth、node、array、key 与 string 上限；resource limit 是具名 failure，不自动变成业务 partial |
| L9 | 现行 writer 会把 Content Stream 全部合成一个 `Uint8Array`；simple collection 也先在内存保存完整安全前缀 |
| L10 | blob Roadmap 已固定 logical Content 与 physical segments 分离、Attachment closure 自包含、producer 不选择 chunk |
| L11 | durable bytes 与 unknown family 都是不可信输入；第三方 family 不能提供 path、SQL、table、index 或 storage capability |
| L12 | sealed Run immutable；ordinary read 不静默 migration，显式 maintenance 使用候选声明的事务或 copy-on-write，并沿相邻转换链演进 |
| L13 | SQLite 同一 database 同时只有一个 writer；transaction 期间 journal/WAL sidecar 是 database state 的组成部分 |
| L14 | PLAN-4 的 runtime 下限是 Node 24.15.0：该版本携带 SQLite 3.51.3 WAL-reset 修复，并同时提供 defensive mode、`setAuthorizer`、runtime limits 与所需 `node:sqlite` API；公开 connection 是同步 API且没有 incremental BLOB handle，大 Content 需要 Host 自己形成 bounded chunk rows |
| L15 | directory 候选需要 outer publication commit；root-wide database 候选可以用事务发布 logical Run，但 operational database 即使 checkpoint、关闭并停稳也不自动成为 share-safe bytes，搬运必须走 Host snapshot |
| L16 | Content handle、chunk、row、item、index/catalog entry、Seal inventory、depth、nodes、path、safe integer 与 offset 仍受 storage-neutral 结构 ceiling 保护；这些 ceiling 约束单值和可遍历形状，不恢复 64/128 MiB 产品 cap，也不强制 filesystem member ceiling |
| L17 | cancellation、filesystem quota、disk full 与 typed I/O failure 可以终止未发布 write；它们不形成 portable identity，也不能让已发布的大 Run 被误报为 corruption |
| L18 | RS3 的目标 collection cap 必须容纳 50,000 个固定 tiny items；item count 以外仍同时受实测 encoded bytes、nodes 与 depth cap 约束，当前 4,096 / 768 KiB 只是实现事实 |
| L19 | 同一 storage revision 的 reader、publisher 与 migration 强制相同结构 ceiling；rollover threshold、buffer 与 cap 内 grouping 保持 Host 私有，不能改变同一 published closure 的 validity |
| L20 | 失败分三层：digest、缺失、额外、截断或非法 codec 是 published corruption；超出本 storage revision 结构 ceiling 是 structure invalid；内存、时间、取消、disk、inode 与 I/O 是本机 admission/resource failure |
| L21 | writer 保留 `content.text`、`content.bytes` 与 `content.stream`；reader 保留 `content.text`、`content.bytes`、`content.stream` 并提供不读取 bytes 的 logical `byteLength`；整体读取没有公开 `maximumBytes` 参数 |
| L22 | `${NICEEVAL_HOME:-~/.niceeval}/niceeval.sqlite` 是唯一的 OS-user `UserDatabase`；它保存 durable user state、cache registry、user-level coordination 与 credential reference，但不进入 Run Seal、`RecordSnapshot` 或 project portability，secret 永不入库 |
| L23 | v1 只静态组合第一方 feature Repository；每个 Repository 就近拥有 schema、固定 operation、typed decoder 与相邻 migration，central `UserDatabase` 独占 path、connection、transaction 和 migration orchestration，不提供 State module/SPI、raw SQL、extension、`ATTACH` 或动态注册 |

## 候选清单

- [PLAN-1](PLAN-1/README.md)：canonical JSON envelope、Host 私有 framed pack sets 与 whole-Run directory rename。
- [PLAN-2](PLAN-2/README.md)：历史上的单 SQLite application file；它不能同时满足 durable-member ceiling 与无 Run Content cap。
- [PLAN-3](PLAN-3/README.md)：条件后备；SQLite 保存 logical inventory 与 collection item，Content 进入同一 Run directory 的外部 rolling packs。
- [PLAN-4](PLAN-4/README.md)：整个 Record root 使用一份 SQLite application database；事务发布 logical Run，Content 使用 bounded chunk rows。

全 JSON 不是候选。
它要求 binary base64、整体 encode/decode 与 append 重写，已经与 L7–L10 的增量 Content/collection 路径和真实失败语义冲突。

外部事实与版本证据见
[便携格式](../../research/record-storage/portable-formats.md)、
[Artifact systems](../../research/record-storage/artifact-systems.md) 和
[Eval platforms](../../research/record-storage/eval-platforms.md)。
