# Record storage

本决策比较 Record Host 怎样保存 rich Attachment、Attempt Record collection 与逻辑 Content。
三个候选共用同一作者面：`text` / `bytes` 是已在内存材料的便利入口，`stream` 是任意长度 Content 的规范路径。
候选只改变 staging、物理切分、索引、校验与 publication。

本决策尚未定案，不声明 `selectedPlan`，也不把任何 PLAN 标成推荐。
独立设计挑战对 SQLite 候选给出 `CONDITIONAL`，rolling pack 与 aggregate Content budget 挑战也给出 `CONDITIONAL`。
取消单 Content 固定上限后的再次挑战仍为 `CONDITIONAL`。
该挑战允许修改 Design 与 blob Roadmap，但不允许声明 `selectedPlan`、改写 Feature 或开始 storage migration。
候选可以按结算补充，但下列采用门完成前不能声明 `selectedPlan`：

- L16/L18/L19 的具体 ceiling 与 50,000-item fixture receipts；
- RS2、RS3、RS4、RS7 与 RS13–RS17；
- true streaming、digest-file migration、Git/copy/file-count 与 reader latency receipts。

- [Goals](GOALS.md)
- [Limits](LIMITS.md)
- [Cases](CASES.md)
- [PLAN-1：JSON envelope + Host 私有 packs](PLAN-1/README.md)
- [PLAN-2：一 Run 一 SQLite application file（历史候选）](PLAN-2/README.md)
- [PLAN-3：SQLite inventory + 外部 Content packs（条件后备）](PLAN-3/README.md)
- [Decision](DECISION.md)

研究过程、外部系统证据和完整挑战问题见
[Record 物理存储研究](../../research/record-storage/README.md)与
[Attachment aggregate Content budget 挑战](../../research/record-storage/aggregate-content-budget-challenge.md)、
[无固定 logical Content 容量挑战](../../research/record-storage/unbounded-logical-content-challenge.md)。
