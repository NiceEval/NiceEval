# Record storage

本决策比较 Record Host 怎样保存 rich Attachment、Attempt Record collection 与逻辑 Content。
作者 API、family 语义和 reader 结果保持一致；候选只改变 staging、物理切分、索引、校验与 publication。

本决策尚未定案，不声明 `selectedPlan`，也不把任何 PLAN 标成推荐。
独立设计挑战对 SQLite 候选给出 `CONDITIONAL`：候选可以完整比较，但只有采用门全部通过后才能进入裁决。

- [Goals](GOALS.md)
- [Limits](LIMITS.md)
- [Cases](CASES.md)
- [PLAN-1：JSON envelope + Host 私有 packs](PLAN-1/README.md)
- [PLAN-2：一 Run 一 SQLite application file](PLAN-2/README.md)
- [PLAN-3：SQLite inventory + 外部 Content packs](PLAN-3/README.md)
- [Decision](DECISION.md)

研究过程、外部系统证据和完整挑战问题见
[Record 物理存储研究](../../research/record-storage/README.md)。
