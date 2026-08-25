---
format: niceeval.docs-node/v1
kind: design
relations:
  selectedPlan: docs/design/record-storage/PLAN-4/README.md
---

# Record storage

本决策比较 Record Host 怎样保存 rich Attachment、Attempt Record collection 与逻辑 Content，并裁决 NiceEval 怎样统一托管 OS-user Service state 的 SQLite 资源。
四个候选共用 storage-neutral 的领域作者面；采用方案可以重新设计批写、流式读取和 publication 协议，使它们直接匹配选定 substrate 的性能与生命周期。
候选改变 staging、物理切分、索引、校验、publication 与 storage ownership，但不把 SQL 或物理布局交给 Record 作者。

本决策选择 [PLAN-4](PLAN-4/README.md)：project 使用一份 root-wide SQLite application database，OS-user Service state 使用独立的 `state.sqlite`。Runtime 直接使用 `node:sqlite`，不引入 Drizzle，也不实现自定义 rolling pack。

PLAN-4 在取消强制 rollover 与无共享 writer 政策后重新纳入 root-wide SQLite。
[采用收据](../../research/record-storage/root-wide-sqlite-receipt.md)已经给出 Node/Drizzle 版本、144 MiB Content、50,000 items、并发、snapshot、crash、migration、hostile reader 与 worker startup 结果。

[Coordination 多进程收据](../../research/record-storage/coordination/sqlite-coordination-receipt.md)补齐 FIFO admission、取消、owner crash recovery 与真实 snapshot barrier。
[Publication protocol 收据](../../research/record-storage/sqlite-publication-protocol-receipt.md)补齐 command conflict、commit 后 ack 前 retry 与 final Seal transaction crash。

独立只读 `design_grill` 在全部 `CONDITIONAL` 收据落实后对 PLAN-4 给出 `PASS`。Feature rewrite、公开 E2E、production Coordination 与 migration 实现属于采用验收，不再阻止 substrate 定案。
具体生产 ceiling、完整 legacy converter 与长期 Git growth 属于 Feature adoption 和实现验收，不再用来预设 physical substrate。
这些任务同样约束 rolling pack，不能以实施工作尚未完成为由把自定义 codec 当成默认答案。

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
