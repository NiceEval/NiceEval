# PLAN-3：SQLite inventory + 外部 Content packs —— Architecture

## 数据建模

```text
runs/<run-id>/
├── run.sqlite
├── content.pack
├── content.index
├── seal.json
└── complete
```

文件名是 storage illustration，不是 public API。
published unit 是完整 Run directory。

### SQLite responsibilities

final `run.sqlite` 只包含 Core-owned STRICT tables。
这些表保存 application metadata、Run Core、owners、attachments、collection items、logical Content descriptors、references 与 database-side Seal inventory。

family payload/item 是 canonical opaque bytes。
collection ordinal来自 Attempt mutex linearization；rowid 不进入 logical value。

logical Content row只保存 attachment-local key、kind、byte length、overall digest 与 external pack descriptor digest。
SQLite 不保存 Content BLOB chunks。

### Content pack responsibilities

Content source 被增量切成 private bounded segments，并顺序追加到 `content.pack`。
`content.index` 保存 content key、ordered ranges、segment digests、overall length 与 overall digest。

database descriptor、index entry 与 pack ranges共同形成 logical Content closure。
同一 Attachment 内可以复用 ranges；跨 Attachment 不复用。

## Active staging

active Run 使用 local staging directory。
一个 worker-thread actor 独占 staging SQLite connection；Content writer 管理 pack/index descriptors。

SQLite staging 可以使用 WAL 和 Host-private draft tables。
Content partial ranges 只在 staging pack；finalize transaction 只有在 source、budget、digest、payload 与 references 全部成功后才插入 logical Content descriptor。

## 数据流

### Collection append

```text
append command
  → item Schema encode + canonical snapshot
  → cap check
  → SQLite short transaction with ordinal
  → retained/omitted receipt
```

Attempt complete 写 collection state 与 item inventory。
public read按 ordinal 读取全部 rows并形成 logical array。

### Content write

```text
Content source
  → bounded buffer + length/SHA-256
  → external pack segment + index draft
  → source EOF and closure validation
  → SQLite logical Content descriptor transaction
```

SQLite transaction 不能让 filesystem bytes 原子提交。
staging invisibility、Seal closure validation 与 final directory rename共同提供 publication correctness。

### Final metadata exporter

热 staging SQLite、WAL、draft schema 与 freelist 不进入 published directory。
seal 时 fixed exporter 创建 exact `run.sqlite`，只复制 committed generic logical rows，不复制 Content bytes。

export 完成后，Host 交叉验证 final DB descriptors、Content index/ranges 与 whole-Run Seal。
所有 handles关闭并 fsync 后，publisher 才 rename完整 directory。

## Published read 的信任边界

SQLite 使用与 PLAN-2 相同的 fixed read-only、defensive、exact schema、no extension/ATTACH/custom SQL 与 runtime limits。
external pack 使用 no-follow root-relative I/O、fixed framing、byte limits 与 digest validation。

ordinary read 只打开 requested database rows；未消费 Content 不打开 pack ranges。
`requireComplete()`、publish 与 migration 验证 database 和全部 external closure。

## 不变量

- SQLite 与 Content pack 都只是同一 Run directory closure 的成员。
- database descriptor 没有 matching index/ranges，或 pack range 没有 Seal inventory，Run 都是 invalid。
- active DB/WAL、partial pack range、draft index 与 recovery manifest 只在 local staging。
- directory rename 是唯一 publication commit。
- item ordinal、rowid、pack offset 与 segment boundary 不进入业务 identity。
- storage migration 可以按 generic DB rows和 external bytes复制 unknown family。
- public collection/content API 与 PLAN-1/2 相同。

## 身份与复用

storage revision 同时固定 exact SQLite schema、Content pack/index codec 与 cross-store Seal shape。
任何一侧 codec 改变都需要相邻 storage migration。

family revision只解释 logical payload/item；pack placement 与 database page layout 不改变 family identity。
