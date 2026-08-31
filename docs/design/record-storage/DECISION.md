**相关文档**：[README](README.md) · [Goals](GOALS.md) · [Limits](LIMITS.md) · [Cases](CASES.md)

# Decision

## 状态

独立只读 `design_grill` 给出的 `CONDITIONAL` 已逐项落实并验收。正式裁决选择
[PLAN-4](PLAN-4/README.md)；`docs/design/record-storage/README.md` 的 `relations.selectedPlan` 是唯一机器真源。

## 定案

project Record 使用 `<project>/.niceeval/record.sqlite`，OS-user `UserDatabase` 使用
`${NICEEVAL_HOME:-~/.niceeval}/niceeval.sqlite`。Runtime 直接使用 Node 24.15.0+ 的 `node:sqlite`、checked-in SQL、fixed
prepared statements 与 typed row decoder；不引入 Drizzle，也不实现自定义 rolling pack。

ProjectDatabase 通过 project-wide portable barrier、secure deletion 与 WAL truncate 后，原文件直接作为
Git/copy/Preview 输入。Host 随后 hostile reopen 同一文件；不生成 `RecordSnapshot`、export、另一份 SQLite 或整库重写。
v1 不提供 raw UserDatabase portable backup。

## `CONDITIONAL` 的五项关闭收据

1. 只建立两份 live application SQLite，且新 project/user 路径分别是唯一权威；
2. `UserDatabase` 以具名 Repository 保存 durable user state、Docker/E2B cache registry 与 Incus allocation/artifact ledger。它也保存 user-level lease/coordination 与非秘密 credential reference；
3. cache Repository 的 schema、cleanup 或业务错误不阻塞其它 durable Repository；仅共享 SQLite 文件的 corruption、disk-full、WAL 和 lock 风险是接受的共同 failure domain；
4. `ProjectDatabase` 的 writer admission、portable barrier 和 scrub 是 Host-only SQLite coordination tables，服务与领域层不见持久化实现；
5. v1 不导入 0.13.x Record/state/cache bytes，也不提供 converter；这些 bytes 在新路径单独或并存时 fail closed。旧 cache 只在无活动使用者的具名 maintenance 中删除。公开入口收据证明上述边界。

普通后端 `UserDatabase` + feature Repository 是此方向的一部分。应用只静态组合有限第一方 feature。

- 每个 Repository 就近拥有 schema、固定 operations、typed decoder 与相邻 migration；
- central owner 只拥有 database、connection、transaction、lease 与 migration orchestration；
- 因此不引入全局 State module/SPI、lifecycle DSL、通用 SQL executor 或第三方动态注册。

## 已经排除

全 JSON 不进入 PLAN。
它无法同时兑现 RS2、RS3 与 RS8，并会把 physical split 泄漏成 family array 或 base64 字段。

## 重新挑战的前提

旧比较把以下实现政策当成共同产品目标：

- 每种 durable data 和 metadata 都必须 rollover；
- 不同 Run 不能共享 physical writer；
- SQLite transaction 不能成为 logical Run publication commit；
- 活动期间的普通 filesystem copy 必须取得一个完整 published unit。

这些政策不是 Run、Attempt、Attachment、Content 或 Insight 的领域事实。共同目标要求大规模功能正确、持续进展、fail-closed seal、完整验证、停稳 copy 或 Host snapshot，以及具名资源失败；当前不设 heap、RSS、latency、throughput 或 size performance SLO。

因此 root-wide SQLite 不再被预先排除。它必须和 rolling 候选使用相同 Cases，而不能豁免 Content streaming、unknown family、完整 Seal 或显式 migration。

## 候选差距

- [PLAN-1](PLAN-1/README.md) 延续 whole-Run directory rename 与 rolling storage。它保留按 Run 增量进入 Git 的形态，但必须自行拥有 framed log、catalog/index/Seal、orphan 与 corruption protocol。
- [PLAN-2](PLAN-2/README.md) 每 Run 形成一个 final SQLite file。它隔离 writer 与损坏范围，却需要 O(run bytes) export，并为 reference closure 与 root inventory保留额外协议。
- [PLAN-3](PLAN-3/README.md) 用 SQLite 保存 item/inventory、external packs 保存 Content。它同时拥有 database 与 pack 两套 closure、migration 和 corruption protocol。
- [PLAN-4](PLAN-4/README.md) 用一份 root-wide SQLite 保存 Core、Attachment、Content chunk 与 Seal。它复用 transaction、index 和 migration substrate，但接受单 writer、单文件增长、二进制 Git diff 与 root-wide migration blast radius。

## 依据

[Root-wide SQLite 采用收据](../../research/record-storage/root-wide-sqlite-receipt.md)给出以下区分性证据：

1. Node 24.15.0 同时提供 SQLite 3.51.3 WAL 修复、defensive mode、authorizer 与 runtime limits；
2. 三个 48 MiB Content 以 1 MiB chunk rows 完成 write、stream read、digest 与 whole-value admission；
3. 50,000 items 全部 retained；整体 read 通过 admission 时结果正确，`openCollection()` 以 Stream 交付完整 collection；
4. 四进程 1,000 个短事务全部完成，但 SQLite lock 不保证公平，因此 PLAN-4 增加 Host writer admission；
5. backup 在连续写入下持续 restart，因此 active snapshot 增加 write barrier，不依赖偶然 quiet window；
6. Seal commit 前后 `SIGKILL` 分别留下 `open` 与 `sealed`，receipt 丢失不改变 publication；
7. hostile reader、unknown-family bytes、disk full rollback、截断拒绝与 copy-on-write migration 边界已固定；
8. 持续 writer 使用 storage worker，短 `show/query` 直接 read-only open；该分工不附带启动、读取或写入时延阈值。
9. 九个独立进程证明 durable FIFO、取消、owner crash 回收、每 ticket 一个 batch，以及 snapshot barrier 排空真实 transaction 后才 backup；
10. command identity 冲突 fail closed；commit 后 ack 前终止可以确认已提交成功；final Seal transaction 内终止回滚全部 Seal rows，retry 只 seal 一次。

后两项的可复现证据分别见
[SQLite Coordination 多进程收据](../../research/record-storage/coordination/sqlite-coordination-receipt.md)与
[SQLite publication protocol 收据](../../research/record-storage/sqlite-publication-protocol-receipt.md)。

Drizzle stable 0.45.2 没有 `node:sqlite` driver export；支持它的是 1.0.0-rc.4。
runtime 直接使用 `node:sqlite`、checked-in SQL、fixed prepared statements 与 typed row decoder。

v1 从全新的 SQLite revision 1 开始，不提供 0.13.x converter，也不导入其 Record/state/cache bytes。未来首次出现受支持的
v1 predecessor revision 时，才为该相邻版本补 migration 收据。具体生产结构 ceiling、长期 database growth 与 Git repository growth
留待后续性能工作；它们不区分 SQLite 与 rolling pack 的职责，也不构成当前 Feature 的 SLO。

## 条件满足后的裁决依据

- 若五项关闭条件全部通过，选择 PLAN-4，因为 SQLite 已提供 transaction、B-tree、crash recovery 与多进程锁；chunk rows、短事务、Host FIFO、snapshot barrier 和 sanitized snapshot关闭了本产品特有的边界。
- 不选择 PLAN-1，因为它要求 NiceEval 自己拥有 framing、catalog/index、Seal、orphan、corruption 与 migration protocol。
- 不选择 PLAN-2，因为每 Run 独立 application file 增加 O(run bytes) export 与跨 Run reference closure protocol。
- 不选择 PLAN-3，因为它同时保留 database 与 pack 两套 closure、corruption 和 migration owner，而 Content chunk rows 已通过 RS2/RS13。

## 否决项

- [PLAN-1](PLAN-1/README.md) 要求 NiceEval 自己拥有 framing、catalog/index、Seal、orphan、corruption 与 migration protocol；
- [PLAN-2](PLAN-2/README.md) 为每个 Run 增加 O(run bytes) export 与跨 Run reference closure protocol；
- [PLAN-3](PLAN-3/README.md) 同时保留 database 与 pack 两套 closure、corruption 和 migration owner；
- Drizzle stable 不支持当前 `node:sqlite` runtime，RC 不成为持久格式依赖；自定义 rolling pack 也不再作为后备实现偷偷保留。

## 遗留风险

两份 live database 各自接受 SQLite 单 writer、WAL/checkpoint、disk-full 与 migration lock window 的资源风险。Host 以短事务、
dedicated worker、busy deadline、writer admission、snapshot barrier 与 fail-closed recovery 约束这些风险。当前不承诺 heap、RSS、
latency、throughput、database growth 或 Git growth SLO。future revision 只允许相邻、显式、带收据的 migration；v1 不导入
0.13.x bytes，也不提供 converter。

挑战过程与已有 crash matrix 输入见
[SQLite 独立设计挑战](../../research/record-storage/design-challenge.md)与
[Attachment aggregate Content budget 挑战](../../research/record-storage/aggregate-content-budget-challenge.md)、
[无固定 logical Content 容量挑战](../../research/record-storage/unbounded-logical-content-challenge.md)。
