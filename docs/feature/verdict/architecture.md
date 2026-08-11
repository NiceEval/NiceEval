# Verdict 与 AssertionResult

完整 Assertion 模型见 [Assertions](../assertions/README.md)。Verdict 只属于 Pass Eval。

## Pass fold

| 优先级 | 条件 | Verdict |
|---|---|---|
| 1 | execution error，或参与 Pass grading 的 unavailable / errored | `errored` |
| 2 | 任一 Boolean condition mismatched | `failed` |
| 3 | 显式 `t.skip(reason)`，且没有更高优先级条件 | `skipped` |
| 4 | 其余情形 | `passed` |

Boolean Assertion 默认是 Pass condition。measurement 必须先 `.atLeast(n)` 才能成为 condition。
`notApplicable` 不参与 fold。普通 mismatch 不会停止后续检查；只有被 await 的 `.orStop()` 会设置
authoring stop latch。

## Score Eval 不进入此 fold

Score Eval 累加 configured contribution。正常 mismatch 或 below 不会使 score 失效。已配置 score 的
Assertion、direct score 或 control Assertion 遇到 `unavailable` / `errored` 时，grading 不可排名并保留
`partialScore`；record-only Assertion 的 Issue 不作废正式 score。

1. 存在终局执行错误，或存在非 optional unavailable Assertion，得到 `errored`。
2. 存在 gate failed，或 strict policy 下存在 soft failed，得到 `failed`。
3. 作者显式 skip，得到 `skipped`。
4. 其余情况得到 `passed`。

`errored` 与 `failed` 分别表示执行或材料无法完成，以及检查已经得到不满足的事实。页面必须保留对应 assertion 或 diagnostic，不能只显示四态词。

## 通道数据

`niceeval.verdict/v1` 的精确 payload 只有四态 `state`。Assertion、diagnostic 引用和人读摘要属于各自业务通道，不进入 Verdict。精确 document 与 media type 由 [Record Architecture](../record/architecture.md#verdict-与-eligibility-v1) 单点定义。

producer 可以更换 assertion API、matcher、collector 或 evaluation algorithm，但仍分别写入冻结的 Assertions 投影与本通道。Assertions 的 `decision` 保存行级分类；strict policy 是否生效不重写它。

通过制与计分制的 origin Attempt 都形成四态 Verdict。Score Eval 另有独立 score Channel 保存挣分；Verdict 与 score 并存，互不推导：Verdict 不按分数折叠，score 也不从 Verdict 派生。

channel descriptor 的采集完整度与本次 decoder 状态仍由 Record reader 单独给出。被请求的 Verdict channel 无效时，planner 和需要它的页面失败；`unavailable` 或 `unsupported` 不能被替换成 `passed`。

Verdict 与 eligibility 的 `/v1` payload 永不扩展。payload shape 变化发布新的 ChannelSchemaId；语义真正变化才换 ChannelName。carry 还必须显式接受 eligibility schema 与 `reuseContract` domain，不能因 decoder 能展示新旧值就自动复用。

## Planner 与 Reports

reuse planning 从 `RecordWriteSession.view` 的 frozen selection 读取 Verdict 与 eligibility。两个 ChannelProjectionResult 必须都是 read、durable complete、decoding complete，且 payload 精确合法。schema、`reuseContract`、identity、duration 与本次 policy 全部满足时，planner 才可采用 Attempt。

Reports 从 ReportInput 显示 Verdict、相关 Assertion 和诊断。它不打开 Record 文件，不从 Assertions 重新折叠 Verdict，也不猜测 strict policy、控制流或缺失数据。

## 相关阅读

- [Assertions 架构](../assertions/architecture.md)
- [Record 通道](../record/architecture.md#channel-identity-与局部演进)
- [Record Library · registry](../record/library.md#channelprojectionresult)
- [缓存与携带](../experiments/cache.md)
