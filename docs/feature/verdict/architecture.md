# Verdict 与 AssertionResult

Verdict 由 producer 根据 Attempt 的 assertion 求值结果、执行错误和显式 skip 形成，并写入 Attempt-owned `RecordAttachment`。Attachment 名称是 `niceeval.verdict`，payload schema 是 `niceeval.verdict/v1`。它是独立业务数据，不是读取器的计算副本。

## Pass fold

| 优先级 | 条件 | Verdict |
|---|---|---|
| 1 | execution error，或参与 Pass grading 的 unavailable / errored | `errored` |
| 2 | 任一 Boolean condition mismatched | `failed` |
| 3 | 显式 `t.skip(reason)`，且没有更高优先级条件 | `skipped` |
| 4 | 其余情形 | `passed` |

`stopOnFailure` 只停止后续用户测试代码。它不把 soft 变成 gate，也不改变 Attachment 数据的含义。

## Score Eval 不进入此 fold

Score Eval 累加 configured contribution。正常 mismatch 或 below 不会使 score 失效。已配置 score 的
Assertion、direct score 或 control Assertion 遇到 `unavailable` / `errored` 时，grading 不可排名并保留
`partialScore`；record-only Assertion 的 Issue 不作废正式 score。

1. 存在终局执行错误，或存在非 optional unavailable Assertion，得到 `errored`。
2. 存在 gate failed，或 strict policy 下存在 soft failed，得到 `failed`。
3. 作者显式 skip，得到 `skipped`。
4. 其余情况得到 `passed`。

`errored` 与 `failed` 分别表示执行或材料无法完成，以及检查已经得到不满足的事实。页面必须保留对应 assertion 或 diagnostic，不能只显示四态词。

## RecordAttachment 数据

`niceeval.verdict/v1` 的精确 payload 只有四态 `state`。Assertion、diagnostic 引用和人读摘要属于各自业务 Attachment，不进入 Verdict。精确 document 与 media type 由 [Record Architecture](../record/architecture.md#recordattachment) 单点定义。

producer 可以更换 assert-first API、matcher、collector 或 evaluation algorithm，但仍分别写入冻结的 Assertions payload 与此 Attachment。Assertions 的 `decision` 保存行级分类；strict policy 是否生效不重写它。

通过制与计分制的每个 Attempt 都形成四态 Verdict。Score Eval 另外写入独立的 `niceeval.score/v1` Attachment 保存挣分；Verdict 与 score 并存，互不推导：Verdict 不按分数折叠，score 也不从 Verdict 派生。

`RecordAttachmentEnvelopeV1.collection` 表示已保存资料的采集完整度，`RecordAttachmentRead` 另行表示本次读取状态。被请求的 Verdict Attachment invalid 时，planner 和需要它的页面失败；`unavailable` 或 `unsupported` 不能被替换成 `passed`。

`niceeval.verdict/v1` payload 永不扩展。payload shape、media type、closedness 或解释变化时发布同名的相邻 `RecordAttachmentSchemaId`。新版本必须提供精确 `vN → vN+1` converter，或声明 `not-losslessly-migratable`；后者保留旧 bytes 并返回 migration warning，不能补默认值或重算 Verdict。业务 family 真正变化时才换 Attachment name。

Verdict schema 与 eligibility schema 独立演进，二者都不要求 Record Core 变化。carry 还必须显式接受 eligibility schema 与 `reuseContract` domain，不能因 decoder 能展示新旧值就自动复用。

`evaluationKind` 只来自 Run-owned `niceeval.evaluations` Attachment 的 `niceeval.evaluations/v1` payload，值只有 `pass` 或 `score`。Assertions 的 `points` 只是 Score Eval 内的得分贡献；它不改变题型，也不决定 Verdict。

## Planner 与 Reports

reuse planning 从 `RecordWriteSession.view` 的 frozen selection 读取 Verdict 与 eligibility。两个 `RecordAttachmentRead` 都必须是 available、collection complete，且 payload 精确合法。schema、`reuseContract`、identity、duration 与本次 policy 全部满足时，planner 才可采用 Attempt。

Reports 通过声明的 `RecordProjection` 显示 Verdict、相关 Assertion 和诊断，并把已取得的值写入闭合的 `niceeval.report-document/v1` semantic document。它不打开 Record 文件，不从 Assertions 重新折叠 Verdict，也不猜测 strict policy、控制流或缺失数据。

## 相关阅读

- [Assertions 架构](../assertions/architecture.md)
- [RecordAttachment](../record/architecture.md#recordattachment)
- [RecordAttachment 读取状态](../record/library.md#attachment-写入与读取)
- [缓存与携带](../experiments/cache.md)
