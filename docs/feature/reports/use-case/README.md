# Reports 用例

本目录按用户目标说明如何组合 bound analysis selection、`RecordProjection`、Calculation 和页面。类型与字段的唯一出处在 [Library](../library.md)，命令选项的唯一出处在 [CLI](../cli.md)。

- [比较质量与成本](比较质量与成本.md)：在固定分母上比较多个 Run。
- [核对 RecordAttachment 完整度](核对RecordAttachment完整度.md)：让 partial、unavailable、unsupported 和 invalid 保持可见。
- [分享静态报告站](分享静态报告站.md)：导出断网可读的自包含目录。
- [制作可访问页面](制作可访问页面.md)：让文字、表格和网页具有相同事实与状态。

每个用例都从一个 frozen `RecordReader` 开始。先形成 `AnalysisSampleHandle`，再由 Report 的静态数据声明形成穷尽 `ProjectedSample` 与 immutable `ReportExecution`；Report callback 不反向打开 Record。
