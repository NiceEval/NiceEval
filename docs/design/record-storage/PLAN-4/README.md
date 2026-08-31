---
format: niceeval.docs-node/v1
kind: design-plan
relations: {}
---

# PLAN-4：two live SQLite application databases（待验收）

NiceEval 常态恰有两份 live application SQLite：每个 project 的 `ProjectDatabase` 与每个 OS user 的 `UserDatabase`。
前者保存 Record；后者保存 durable user state、user-level coordination、credential reference 与具名 feature 的 cache registry。

运行中的 `<project>/.niceeval/record.sqlite` 是 Host-owned `ProjectDatabase`。Core、rich payload、collection item、reference、Content
chunk、运行中 aggregate 与 publication 都保存为 generic rows。它通过 project-wide portable barrier、secure deletion、WAL
truncate 与 hostile reopen 后直接成为可复制 artifact；不生成 Snapshot、export 或另一份 SQLite。

`${NICEEVAL_HOME:-~/.niceeval}/niceeval.sqlite` 是 `UserDatabase`。它不是 Record、Run Seal 或 Snapshot closure 的一部分。
它保存 durable user state、Docker/E2B cache registry 与 Incus allocation/artifact ledger。它也保存 user-level lease/coordination 与
credential reference，但绝不保存 secret。v1 不提供 raw UserDatabase portable backup。

作者仍只提交 logical value、plain-data collection item、Content 与 reference。SQL、table、column、index、transaction、WAL 和 chunk boundary 都是 Record Host 私有实现。

## 核心心智

```text
Record API
  → ProjectDatabase: <project>/.niceeval/record.sqlite
       ├─ immutable sealed Run graph
       ├─ unpublished open / sealing work
       ├─ generic Attachment rows
       ├─ ordered collection items
       ├─ bounded Content chunks
       └─ exact Run Seal inventory

User features
  → UserDatabase: ${NICEEVAL_HOME:-~/.niceeval}/niceeval.sqlite
       ├─ durable state Repositories
       ├─ Docker/E2B cache Repositories
       ├─ Incus allocation/artifact ledger Repository
       ├─ user-level lease/coordination Repositories
       └─ credential-reference Repository (no secret)
```

`ProjectRecordStore` 只定位这一份 operational database。portable receipt 固定同一文件通过 gate 时的 generation 与 cutoff；
下一次写入原子开启新的 operational generation 后旧 receipt 失效。服务与领域层不看到 path、connection 或 SQL。

Run writer 不保持持续整个运行的 transaction。每次 append、Attachment commit 与 Content chunk batch 使用短事务；finalizer 停止 producer、流式验证 closure，再用一个短事务把 Run 从 `sealing` 切到 `sealed`。

ordinary reader 只选择 `sealed` Run。崩溃留下的 `open` 或 `sealing` rows 不是 published facts，只由 maintenance 检查和删除；snapshot 也必须物理清除这些 rows 后再重写 database，不能依赖 SQL `DELETE` 隐藏旧 bytes。

Record 作者面按 SQLite 的存储与生命周期模型重新设计，但保持 storage-neutral：

- rich value 使用 `records.write(definition, valueOrBuilder)`；
- collection 使用 `records.append` 与 `records.appendAll(Stream)`；
- collection 使用 `records.close(complete | partial)` 形成领域 completion fence；
- 整体 `read()` 有明确 admission 上限；
- `openCollection()` 按 row/chunk 返回 Scope-owned Stream。

SQL、cursor、rowid、page、transaction 和 worker roundtrip 都不是公共契约。

## 解决的问题

- SQLite transaction、B-tree、unique constraint 与 foreign key 代替自定义 frame、offset index 和 catalog commit。
- 固定 Inspection Operations 可以直接使用 Host-owned prepared query，不需要公开 SQL 或通用 Analysis executor。
- collection item 和 Content chunk 增量进入 rows；完整 logical value 不成为一个 write command 的物理形状。
- Run、Member、Attempt 与 reference 使用关系表表达；逻辑 DAG 不要求 graph database 或 pack index。
- schema migration 使用随 NiceEval 发布并经过评审的 SQL；future v1 family/data migration 才由相邻 revision converter 负责。

## 明确代价

- 同一 database 只有一个 physical writer；多个 NiceEval 进程的短事务会等待同一个 write lock。
- database、backup、integrity check 与 schema migration 随整个 Record 增长，损坏和维护影响范围也是 root-wide。
- Git 只能看到 snapshot binary file 变化；两个分支分别写入 snapshot 时不能自动合并 rows。
- WAL 活动期间的 `-wal` 是 database state；raw operational database copy 不构成 share-safe Record，即使连接已经停稳，也可能在 free pages 留下未发布 bytes。
- `node:sqlite` 是同步接口。Host 必须限制事务长度，并把持续 writer 放进 dedicated storage worker，不能在任意调用点长期阻塞运行主线程。

## Runtime 与 Drizzle 边界

runtime 直接使用 Node 24.15.0+ 内置的 `node:sqlite`，不增加 native addon，也不引入 Drizzle。
Drizzle stable 0.45.2 没有导出 `node:sqlite` driver；支持该 driver 的 1.0.0-rc.4 不进入核心持久格式 runtime。

仓库拥有显式 STRICT schema、固定 prepared statements 与相邻 SQL migration。
future v1 family/data migration 由 TypeScript typed converter 完成，row result 由 Effect Schema 或具名 decoder 解码。

Drizzle Kit 不能替代 schema identity、family bytes、Run Seal、publication closure 或 migration receipt。
稳定版正式支持 `node:sqlite`，且实测明显减少维护成本时，才重新评估 Drizzle。

## 范围

本候选包含 root-wide generic STRICT schema、bounded Content chunk rows、batch/stream Record DX 和 short transaction publication。

Host 协议还包含 storage worker、portable barrier、secure deletion 与 hostile database hardening。
Project writer admission、portable barrier 与 scrub 全部位于 Host-only SQLite coordination tables；portable metadata 与待删除的
coordination rows 分离。新 baseline 不迁移旧 ProjectDatabase，也不提供 converter 或兼容读取。

`UserDatabase` 是普通 backend。central owner 拥有 database、connection、transaction、lease 与 migration orchestration。
每个 feature Repository 就近拥有 schema、固定 operation、typed decoder 与 lazy adjacent migration。

应用只静态组合第一方 Repository，不提供 State module/SPI、lifecycle DSL、通用 SQL executor 或第三方动态注册。
cache Repository 的 schema、cleanup 或业务失败不能成为其它 durable Repository 的逻辑前置。
共享 SQLite 文件的 corruption、disk full、WAL 与 lock failure domain 明确接受。

v1 不兼容 0.13.x Record/state/cache bytes，也不提供 converter。新路径唯一权威。发现旧 bytes 单独存在或与新路径并存时 fail closed。
旧 cache 只能由具名 maintenance 在没有活动使用者时删除。

Command retry、Seal transaction、snapshot sanitization 与 copy-on-write migration 的 crash 证据见
[SQLite publication protocol 收据](../../../research/record-storage/sqlite-publication-protocol-receipt.md)。
多进程 FIFO、取消、owner crash recovery、每 ticket 一个 batch 与真实 snapshot barrier 的证据见
[SQLite Coordination 多进程收据](../../../research/record-storage/coordination/sqlite-coordination-receipt.md)。

它不提供 family SQL、public query language、跨 Record CAS、remote database、public chunk policy 或 binary Git merge。

## 入口

- [Library](library.md)
- [Architecture](architecture.md)
- [Lifecycle](lifecycle.md)
- [Use Cases](use-case/README.md)
