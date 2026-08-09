# 报告作者 API —— References

本篇说明 Reports 从外部产品借鉴的原则，不替代 [Library](../library.md) 的目标契约。

## 指标与数据依赖

Rill、Cube 和 Braintrust 都说明：指标、维度与展示应各有清晰 owner。
NiceEval 将这一点收敛为：Sample 固定成员，Projector 声明事实读取，Calculation 声明纯推导，ReportPlan 声明页面依赖。

这避免官方图与用户图因隐藏过滤、隐含缓存或不同数据源而得到不同结果。

## Evidence 与可审计下钻

Evidence、Lightdash 和 Braintrust 都强调从汇总回到依据。
NiceEval 的 MetricValue 因而在两个分支都保存 coverage、basedOn 与完整 AttemptRef；available 另存 verification / issues，unavailable 另存非空 causes。
下钻 target 只能指向同一 Plan 已枚举的 page instance，不能在点击后重新查询。

## Observable 与构建期数据

Observable Framework 的 build-time data loader 说明：依赖应先被枚举和执行，浏览器只消费结果。
NiceEval 使用更严格的两步：plan 先列出所有 page instance、Calculation 和 Projector request，executor 再生成不可变 ReportData。

这保留增量重建体验，同时防止某个 render 分支的偶然读取改变导出 evidence closure。

## 嵌入边界

Metabase 的嵌入组件说明产品页面需要纯组件和明确 artifact，而不是完整报告运行时。
NiceEval 的 React 包同样只消费已生成数据；跨 Store evidence 以分页 `RecordEvidenceProofIndexV1` 随 Report artifact 交付，不限于 event。

这条边界也适用于错误 owner。Sample export 按 phase 直接传播 Record 的 source/read/proof error；Report export
为了维持单一 artifact failure surface，统一包装为 `report-evidence-closure-failed`。
其中 `cause` 仍是完整 typed `RecordSourceFailure | RecordEvidenceProofFailure`。
包装不能只保存 message，也不能再造另一组 proof code。

## 不采用的方向

- 不使用 SQL、模板变量或字符串查询。
- 不让 Sample 变成可变数据框或允许 renderer 改变成员。
- 不让 `aggregate()` 的结果再次充当 Sample。
- 不把外部业务数据作为 report 运行时网络读取；它必须先 snapshot 进 Record。

## 相关阅读

- [Reports 参考方案](README.md)
- [Library](../library.md)
- [Architecture](../architecture.md)
