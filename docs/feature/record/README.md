---
format: niceeval.docs-node/v1
kind: feature
relations: {}
---

# Record：SQLite 中的已封口运行事实

Record 保存 Run、Attempt、Attachment、Content 与它们的 Seal。项目内的事实由
`ProjectRecordStore` 定位到唯一 operational database：

```text
<project>/.niceeval/record.sqlite
```

这份 database 可以同时包含已发布的 `sealed` Run 与尚未发布的 `open` / `sealing` 工作；它由 Record Host 独占，
不是可复制、可提交或可直接交给其它进程解释的 portable Record。只有 Host 显式形成、物理清除未发布 closure、
重写并验证 exact Seal 后返回的 nominal `RecordSnapshot`，才可以 copy、进入 Git、由兼容 NiceEval runtime 的 `--record` 读取。

Record 与 OS-user Service state 是两个不同的 durable boundary：

```text
<project>/.niceeval/record.sqlite                         ProjectDatabase: Record facts + Host-only coordination
${NICEEVAL_HOME:-~/.niceeval}/niceeval.sqlite            UserDatabase: user state, registries, coordination, credential references
credential store                                           secrets, outside SQLite
```

`UserDatabase` 不属于任何 Run、Seal 或 Snapshot。它以具名 Repository 保存以下内容：

- durable user state；
- Docker/E2B cache registry；
- Incus allocation/artifact ledger；
- user-level lease/coordination 与 credential reference。

secret 绝不入库。cache registry 的 schema、cleanup 或业务失败不会成为其它 durable Repository 的逻辑前置。
各 UserDatabase Repository 共享 corruption、disk-full、WAL 与 lock failure domain。这是接受的资源风险，不是可从 cache 绕开的业务语义。

Project writer admission、snapshot barrier 与 snapshot scrub 是 ProjectDatabase 内仅 Host 可见的 SQLite coordination tables。它们不
进入 Run Seal 或 `RecordSnapshot`。v1 不提供 raw UserDatabase portable backup。

## 作者心智

作者定义 storage-neutral 的 logical fact，不接触 SQL、table、row、transaction、WAL 或 chunk size：

- `Record.attempt(...)` 定义 Attempt-owned rich value；
- `Record.run(...)` 定义 Run-owned rich value；
- `Record.attemptCollection(...)` 定义 Attempt-owned ordered plain-data collection；
- owner 的 `records.write(...)` 写一次 rich value；
- `records.append(...)` 或 `records.appendAll(Stream)` 增量接纳 collection item；
- `records.close(..., { state: "complete" | "partial" })` 显式结束 collection。

`append` 成功是 admission acknowledgment：canonical immutable item 已进入 bounded mailbox，但不表示 transaction 已提交或
fsync。`attempt.complete()` 关闭新 admission，等待全部已接纳 sequence durable，再拒绝仍未 close 的 active collection。
`run.seal()` 只在全部 Attempt fence 成功后，以最终短 transaction 发布完整 Run。

## 读取心智

`read()` 只适合通过 count、canonical bytes、nodes/depth 与 Content metadata admission 的有界完整值。
大 collection 使用 `openCollection()`：它返回 logical identity、`LogicalSealIdentity`、count、digest、
`complete | partial` 与一个 self-scoped bounded Stream，不先构造完整数组。

Content 是 immutable logical capability。读取侧只得到 `byteLength`、`bytes`、`text` 与 `stream`；whole-value
`bytes` / `text` 在分配前检查 admission，`stream` 按 private chunk rows 交付。SQL cursor、rowid、page、connection、
statement 与 physical chunk boundary 永不进入公共值。

## 大规模功能与当前性能范围

Feature 要求 50,000 个 collection item 与合计 144 MiB Content 可以完成 write、seal、stream read 和完整验证。
它当前不为 heap、RSS、latency、throughput 或 Record/Snapshot size 设 performance SLO。Stream API 与 bounded batch 定义增量处理、
资源生命周期和正确性，不定义性能阈值；性能优化留待后续工作。

## 格式与演进

SQLite 使用 generic Core、Attachment、collection、reference、Content chunk 与 Seal rows。Family 不拥有 table；
unknown family 可以按 raw canonical bytes 保留、snapshot 与 physical migration。局部读取只解释请求的 definition；
需要 unknown family 的 direct/reference closure 或完整验证才返回 `family-definition-required`。

`LogicalSealIdentity` 表示已发布的业务事实 closure。只改变 table/index/trigger 的 physical schema migration 保留它。
改变 family canonical facts 的全局 logical-data migration 推进对应行的 family revision、重建 closure 与 Seal，并改变 logical identity。
ordinary read 不自动 migrate。

Runtime 直接使用 Node 24.15.0+ 的 `node:sqlite`、checked-in SQL、fixed prepared statements 与 Effect v4 Schema 或具名 typed decoder。
它不引入 Drizzle。`UserDatabase` 是普通 backend：

- central owner 拥有 database、connection、transaction、全局 migration ledger 与 migration orchestration；
- 每个 feature Repository 就近拥有最终 schema、fixed operations 与 typed decoder，不定义 migration revision 或 runner；
- 应用仅静态组合第一方 Repository；
- 没有 State module/SPI、lifecycle DSL、通用 SQL executor 或第三方动态注册。

Service/domain 不看 path、connection 或 SQL。所有外部 Snapshot 都按 hostile input 导入。
受限 maintenance unit 验证 SQLite structure、exact schema allowlist 与 logical Seal 后，才形成 Host-owned generation。

`0.14.0` 是新 storage migration 的起始版本。它不兼容 0.13.x Record/state/cache bytes，也不提供 converter；
所有旧 bytes 单独存在或与新路径并存时都 fail closed。
旧 cache 只由具名 maintenance 在无活动使用者时删除。

## 从 Record 到输出

固定 Inspection Operations 按需取得 sealed facts，并把闭合结果交给第一方 Delivery。Delivery 不取得 database、reader、
Content handle、Scope 或 unknown payload。matcher、reuse policy 与 cache hit 属于 Experiment；统计、比较与页面树属于
Inspection / Delivery。它们都不会回写 Record。

## 入口

- [Library](library.md) —— definition、writer、bounded reader、Content 与 Host API。
- [Architecture](architecture.md) —— SQLite ownership、generic rows、Seal、migration、Service state 与 hostile input。
- [Lifecycle](lifecycle.md) —— admission、batch、Attempt fence、Run Seal、Snapshot 与 recovery。
- [CLI](cli.md) —— ordinary read、`--record` Snapshot、maintenance 与错误反馈。
- [Observability Source receipts](architecture/observability-attachments.md) —— 官方 source family 如何进入 generic rows。
- [Use cases](use-case/README.md) —— 发布、流式采集、源码共享、迁移与边界选择。
