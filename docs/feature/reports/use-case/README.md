# Reports 用例

本目录按用户目标说明如何组合 bound analysis selection、`RecordProjection`、Calculation 和页面。类型与字段的唯一出处在 [Library](../library.md)，命令选项的唯一出处在 [CLI](../cli.md)。

多数报告任务走 [classic facade](../library.md#classic-facade)：`defineReport({ title, pages })`、`render(sample)` 与受控 JSX。本目录的叶子用低层 projection API 展示需要自定义投影与计算的路径；低层 API 继续存在，两条路径共享同一个 `ReportExecution`。

- [比较质量与成本](比较质量与成本.md)：在固定分母上比较多个 Run。
- [审阅一次 Run 怎样采用结果](审阅一次Run怎样采用结果.md)：从 Run ID 核对 membership provenance，再沿 locator 下钻 immutable Attempt。
- [核对 RecordAttachment 完整度](核对RecordAttachment完整度.md)：让 unavailable、unsupported、invalid 等数据问题与不完整输入保持可见。
- [分享静态报告站](分享静态报告站.md)：导出断网可读的自包含目录。
- [制作可访问页面](制作可访问页面.md)：让文字、表格和网页具有相同事实与状态。

每个用例都从 CLI 已选定的 opaque Record / Run 开始。内部 host 形成 `AnalysisSample`，再由 Report 的静态数据声明形成穷尽 `ProjectedSample` 与 immutable `ReportExecution`；Report callback 看不到 reader，也不反向打开 Record。
