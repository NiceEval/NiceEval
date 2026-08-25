# PLAN-2：一 Run 一 SQLite application file —— Architecture

## 数据建模

```text
record/
├── record.json
└── runs/
    ├── <run-a>.niceeval-run
    └── <run-b>.niceeval-run
```

`.niceeval-run` 是 SQLite application file，但 suffix 和 tables 都不是 public author API。
portable root 仍是跨 Run reference 的复制单位。

### Portable exact schema

final database 只包含 Core-owned STRICT tables：

| table responsibility | logical content |
|---|---|
| application metadata | application ID、storage revision、codec revision |
| Run Core | Run、Slot、Member、Attempt 与 outcome canonical documents |
| owners | exact Run/Attempt owner identity |
| attachments | owner、family、family revision、kind、state、payload digest 与 logical counts |
| collection items | attachment、ordinal、canonical item bytes 与 digest |
| logical contents | attachment-local content key、kind、length 与 overall digest |
| content chunks | content、ordinal、bounded BLOB bytes 与 per-chunk digest |
| references | source Attachment、ordinal、target owner/family 与 canonical anchor bytes |
| Seal inventory | exact Core/Attachment/Content/reference inventory 与 Run Seal digest |

schema 禁止 trigger、view、virtual table、family-defined object 与 extra table/index。
family payload/item 是 opaque canonical bytes；Core 不把业务字段映射成 SQL column。
final database 自身是一个 durable closure member，必须落在共同 member-byte ceiling 内；本候选不把超限 Run 自动拆成多个 application files。

collection `ordinal` 来自 Attempt Host mutex 的 append linearization。
它保存 logical array order，不等于业务 session/turn order，也不向 public reader暴露。

### Active staging schema

active database 位于 local sidecar，可以使用 WAL。
它包含 portable logical tables以及 Host-private draft/write bookkeeping。

draft content chunk 由 `writeId` 与 ordinal 标识。
只有 Content EOF、budget、overall digest、payload、reference 与 family validation 全部成功后，短 finalize transaction 才建立 committed logical Attachment。
失败或取消的 draft 不进入 logical inventory。

## Storage actor

每个 active Run 由一个 worker-thread storage actor 独占一个 `DatabaseSync` connection。
Effect runtime 只发送 typed logical command，不直接执行同步 SQL。

同 Run SQL operation 串行；不同 Run 使用不同 actor/database 并行。
item encode、Content source read 与 hashing 可以在 actor 外有界并发，但每个 chunk 跨线程传输也受 byte cap 与 backpressure 限制。

## 数据流

### Collection append

```text
append command
  → item Schema encode + immutable canonical bytes
  → Host cap check
  → actor short transaction: allocate ordinal + insert item row
  → retained/omitted receipt
```

Attempt complete 使用 attachment transaction 写 collection state、item count 与 digest inventory。
它不重新形成一份巨大 payload JSON，也不把全部 item送回 producer process。

### Content write

```text
Content source
  → bounded chunk + incremental length/SHA-256
  → actor short draft transaction
  → repeat with backpressure
  → finalize logical Content and Attachment transaction
```

Node binding 一次只收到 bounded chunk，不绑定完整 logical Content。
单 logical Content 仍受 64 MiB Core/family budget；不同 Content 的 committed chunk rows 合计不受旧的 128 MiB Attachment 上限约束。
database、chunk count、结构边界、取消与磁盘空间继续约束 active Run。
rich write 逐份消费 Content source；已完成 Content 只保留 committed descriptor/chunk rows，不在 actor 外保留完整 bytes。

### Fixed final exporter

热 staging DB、WAL、draft schema 与 freelist 永远不能成为 published file。
seal 后只允许一条 exporter path：

1. 创建空 final database 并安装 exact portable schema；
2. 用 read-only staging cursor 和 fixed prepared inserts 复制 generic logical rows/chunks；
3. 按 canonical key/ordinal 顺序复制，不解释 family Schema；
4. 在 final database 写 Seal inventory并 commit；
5. 执行 full integrity、foreign key 与 application closure verification；
6. 关闭 final database，确认无 journal/WAL/SHM，fsync 后交给 outer publisher。

本候选不使用 SQLite backup，也不长期保留 `VACUUM INTO` 第二路径。
fixed exporter 明确排除 staging-only schema 和失败 draft。

## Published read 的信任边界

Host 先验证 SQLite magic、application ID、storage revision 与 exact `sqlite_schema`。
连接固定 read-only、defensive、`trusted_schema=OFF`、`query_only=ON` 与 `mmap_size=0`，并收紧 length、column、SQL depth、page/blob 与 operation limits。

extensions、ATTACH、custom function、family SQL 与 arbitrary statement 全部禁用。
ordinary read 只执行 fixed prepared query，并验证 requested closure。
`requireComplete()`、publish 与 migration source verification 才执行 full integrity、foreign key、Seal 与全部 Content closure检查。

## 不变量

- 一 Run 一 actor/database；整个 root 不共用 SQLite writer。
- WAL、draft、recovery manifest 与 active handles 只在 local sidecar。
- published file 的每一 logical row 都来自 fixed exporter；热 DB 不能直接 rename。
- rowid、page number、chunk boundary 与 SQL index 不进入 logical identity。
- Content 是连续 logical bytes；overall digest/length 对完整 source计算。
- storage migration 对 unknown family 复制 generic rows与 raw bytes/chunks，不调用 family decoder。
- public collection read 仍形成完整 logical array；SQLite row query 不偷偷增加新 API。
- digest/schema/row closure mismatch 是 invalid/corrupt；取消、memory/time admission、disk/inode exhaustion 与 I/O 是 resource failure。

## 身份与复用

storage revision 固定 exact schema、generic codecs 与 exporter ordering。
family revision只解释 logical bytes。

第一版 storage codec 不复用相同 Content chunk rows。
后续 codec 即使增加复用，也只能局限在 Attachment closure 内，不能建立跨 Attachment lifetime dependency。
SQLite page dedup/compression 不构成 Record identity。
