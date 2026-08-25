---
format: niceeval.docs-node/v1
kind: design-plan
relations: {}
---

# PLAN-4：root-wide SQLite application database（推荐）

每个 project Record root 使用一份 SQLite application database。Core、rich payload、collection item、reference、Content chunk 与 Run Seal 都保存为 generic rows。

运行中的 `record.sqlite` 是 Host-owned operational database。可复制、进入 Git 或由第三方提供的 Record bytes 必须是 Host 生成的 sealed-only sanitized snapshot。

用户级 Service state 使用另一份 `${NICEEVAL_HOME:-~/.niceeval}/state.sqlite`。它不是 Record、Run Seal 或 snapshot closure 的一部分；cache、coordination、credential 与临时导出也分别位于两个 durable database 之外。

作者仍只提交 logical value、plain-data collection item、Content 与 reference。SQL、table、column、index、transaction、WAL 和 chunk boundary 都是 Record Host 私有实现。

## 核心心智

```text
Record API
  → one project-root SQLite database
       ├─ immutable sealed Run graph
       ├─ unpublished open / sealing work
       ├─ generic Attachment rows
       ├─ ordered collection items
       ├─ bounded Content chunks
       └─ exact Run Seal inventory

Service State API
  → one OS-user SQLite database
       └─ namespaced Service-owned schema modules and migrations
```

`ProjectRecordStore` 与 `RecordSnapshot` 是不同 nominal capability。前者只定位本机 operational database；后者只由显式 export 形成，并经过 sealed-only sanitization 与完整验证。Host 不根据 path 或内部 rows 猜测调用方拿到哪一种能力。

Run writer 不保持持续整个运行的 transaction。每次 append、Attachment commit 与 Content chunk batch 使用短事务；finalizer 停止 producer、流式验证 closure，再用一个短事务把 Run 从 `sealing` 切到 `sealed`。

ordinary reader 只选择 `sealed` Run。崩溃留下的 `open` 或 `sealing` rows 不是 published facts，只由 maintenance 检查和删除；snapshot 也必须物理清除这些 rows 后再重写 database，不能依赖 SQL `DELETE` 隐藏旧 bytes。

Record 作者面按 SQLite 的性能模型重新设计，但保持 storage-neutral：

- rich value 使用 `records.write(definition, valueOrBuilder)`；
- collection 使用 `records.append` 与 `records.appendAll(Stream)`；
- collection 使用 `records.close(complete | partial)` 形成领域 completion fence；
- 整体 `read()` 有明确 admission 上限；
- `openCollection()` 按 row/chunk 返回 Scope-owned Stream。

SQL、cursor、rowid、page、transaction 和 worker roundtrip 都不是公共契约。

## 解决的问题

- SQLite transaction、B-tree、unique constraint 与 foreign key 代替自定义 frame、offset index 和 catalog commit。
- 固定 Inspection Operations 可以直接使用 Host-owned prepared query，不需要公开 SQL 或通用 Analysis executor。
- collection item 和 Content chunk 增量进入 rows，writer RSS 不随完整 logical value 线性增长。
- Run、Member、Attempt 与 reference 使用关系表表达；逻辑 DAG 不要求 graph database 或 pack index。
- schema migration 使用随 NiceEval 发布并经过评审的 SQL；family data migration 仍由相邻 revision converter 负责。

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
family/data migration 由 TypeScript typed converter 完成，row result 由 Effect Schema 或具名 decoder 解码。

Drizzle Kit 不能替代 schema identity、family bytes、Run Seal、publication closure 或 migration receipt。
稳定版正式支持 `node:sqlite`，且实测明显减少维护成本时，才重新评估 Drizzle。

## 范围

本候选包含 root-wide generic STRICT schema、bounded Content chunk rows、batch/stream Record DX 和 short transaction publication。

Host 协议还包含 storage worker、snapshot barrier、sealed-only sanitized snapshot、copy-on-write migration 与 hostile database hardening。用户级 Service state Store Host 保持独立资源边界。

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
