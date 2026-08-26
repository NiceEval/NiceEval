---
format: niceeval.docs-node/v1
kind: design
relations: {}
---

# Record storage

本决策比较 Record Host 怎样保存 rich Attachment、Attempt Record collection 与逻辑 Content，并裁决 NiceEval 怎样统一托管 OS-user Service state 的 SQLite 资源。
四个候选共用 storage-neutral 的领域作者面；采用方案可以重新设计批写、流式读取和 publication 协议，使它们直接匹配选定 substrate 的执行与生命周期语义。
候选改变 staging、物理切分、索引、校验、publication 与 storage ownership，但不把 SQL 或物理布局交给 Record 作者。

PLAN-4 是当前待采用的两数据库方向：project Record 位于
`<project>/.niceeval/record.sqlite`，OS-user 的 `UserDatabase` 位于
`${NICEEVAL_HOME:-~/.niceeval}/niceeval.sqlite`。Runtime 直接使用 `node:sqlite`，不引入 Drizzle，也不实现自定义 rolling pack。

独立只读 `design_grill` 仍判定为 `CONDITIONAL`，所以本 Design 已重新打开：`relations.selectedPlan` 必须缺失。
PLAN-4 可以作为实现目标，但不是已经通过的选中方案；不得用标题、普通链接或 Feature 文字替代这条状态。

重新裁决前必须逐项取得并验收以下五类实现收据：

1. 两个 live application SQLite 只在新路径创建，Record 与 UserDatabase 的数据、连接和迁移 authority 不混淆；
2. UserDatabase 以具名 Repository 保存下列内容，且 secret 不入库：

   - durable user state；
   - Docker/E2B cache registry；
   - Incus allocation/artifact ledger；
   - user-level lease/coordination 与 credential reference；

3. cache schema、删除 cache 数据或业务失败不成为其它 durable Repository 的逻辑前置；共享文件的 corruption、disk-full、WAL 与 lock failure domain 则作为已接受的资源失败；
4. ProjectDatabase 的 writer admission、snapshot barrier 与 snapshot scrub 都只使用 Host-owned SQLite coordination tables，服务与领域层看不到 path、connection 或 SQL；
5. 新路径成为唯一权威。v1 不提供 0.13.x converter；legacy Record/state/cache 单独出现或并存时一律 fail closed。具名 maintenance
   只在没有活动使用者时删除旧 cache，并以公开入口证明 fresh revision 初始化、future revision 拒绝、并发、snapshot 与 fail-closed 行为。

这些条件齐全并被验收后，才可以用 Design 的正式动作填写 `selectedPlan`。在此之前，不把旧的收据、实验或文档改写当作 `PASS`。

- [Goals](GOALS.md)
- [Limits](LIMITS.md)
- [Cases](CASES.md)
- [PLAN-1：JSON envelope + Host 私有 packs](PLAN-1/README.md)
- [PLAN-2：一 Run 一 SQLite application file（历史候选）](PLAN-2/README.md)
- [PLAN-3：SQLite inventory + 外部 Content packs（条件后备）](PLAN-3/README.md)
- [PLAN-4：root-wide SQLite application database](PLAN-4/README.md)
- [Decision](DECISION.md)

研究过程、外部系统证据和完整挑战问题见
[Record 物理存储研究](../../research/record-storage/README.md)与
[Root-wide SQLite 采用收据](../../research/record-storage/root-wide-sqlite-receipt.md)、
[Attachment aggregate Content budget 挑战](../../research/record-storage/aggregate-content-budget-challenge.md)、
[无固定 logical Content 容量挑战](../../research/record-storage/unbounded-logical-content-challenge.md)。
