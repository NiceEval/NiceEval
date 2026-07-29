# 实体转换

`toExperimentRows(sample)`、`toEvalRows(sample)` 与
`toAttemptRows(attempts)` 立即返回普通 rows。
转换保留稳定身份、覆盖占位与时效标注，不执行跨题聚合。

组件使用 `<Table rows={rows} />`。完整契约见
[Library · 实体转换](../../library.md#实体转换)。
