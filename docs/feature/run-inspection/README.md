---
format: niceeval.docs-node/v1
kind: feature
relations: {}
---

# Run → Inspection → Insight

NiceEval 的运行后数据流由三个领域 owner 闭合：Run 保存已发布 Attempt、slot binding、状态与 absence；Inspection 在
一个 PublicationCutoff 上解释固定读取问题；Insight 以人读 SPA 审阅同一事实。

```text
published Run and Attempt facts
  → Inspection fixed operation at PublicationCutoff
  → query/show | browser Worker → Insight SPA
```

Run 是持久领域事实的唯一 owner。Inspection 是 selection、cutoff、member、denominator、coverage、limits、issues、
Evidence 与 comparison 的唯一 owner。Insight 只呈现闭合结果，不从 SQLite rows 或逐项结果重算业务语义。

默认 source 是项目内唯一 canonical `.niceeval/record.sqlite`；它在 Run 为 `active` 时已经包含 Run create 和全部已发布
Attempt。Node 与 browser adapter 可以使用 SQLite 实现读取，但 schema、WAL、staging 和 private generation 都是内部细节。
调用方只选择 Run、Attempt、Experiment 或比较对象，不选择内部 Record representation。

显式 `--record <file>` 只改变 source，不改变 Inspection selector。外部文件按 hostile import 完整验证；只有精确 current schema、
SQLite 完整性和 Run 领域不变量全部成立才进入同一 selector。旧 schema、损坏或部分可读都 fail closed，不迁移或降级读取。
