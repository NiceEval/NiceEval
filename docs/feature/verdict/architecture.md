# Verdict 与 Severity

Verdict 由 producer 根据 Attempt 的 assertion 求值结果、执行错误和显式 skip 形成，并写入 `niceeval.verdict` channel 的 `niceeval.verdict/v1` schema。它是独立业务数据，不是读取器的计算副本。

## Severity

每条 Assertion 的 severity 都是 `gate` 或 `soft`。

| Assertion 状态 | 默认影响 | strict policy 下的影响 |
|---|---|---|
| gate failed | Verdict 为 `failed`。 | Verdict 为 `failed`。 |
| soft failed | 保留失败条目。 | Verdict 为 `failed`。 |
| 非 optional unavailable | Verdict 为 `errored`。 | Verdict 为 `errored`。 |
| optional unavailable | 保留不可用状态。 | 保留不可用状态。 |

`stopOnFailure` 只停止后续用户测试代码。它不把 soft 变成 gate，也不改变 channel 数据的含义。

## 四态折叠

producer 在 whole Run seal 前按以下顺序形成一个 Attempt Verdict：

1. 存在终局执行错误，或存在非 optional unavailable Assertion，得到 `errored`。
2. 存在 gate failed，或 strict policy 下存在 soft failed，得到 `failed`。
3. 作者显式 skip，得到 `skipped`。
4. 其余情况得到 `passed`。

`errored` 与 `failed` 分别表示执行或材料无法完成，以及检查已经得到不满足的事实。页面必须保留对应 assertion 或 diagnostic，不能只显示四态词。

## 通道数据

`niceeval.verdict/v1` 的精确 payload 只有四态 `state`。Assertion、diagnostic 引用和人读摘要属于各自业务通道，不进入 Verdict。精确 document 与 media type 由 [Record Architecture](../record/architecture.md#verdict-与-eligibility-v1) 单点定义。

producer 可以更换 assertion API、matcher、collector 或 evaluation algorithm，但仍分别写入冻结的 Assertions 投影与本通道。Assertions 的 `decision` 保存行级分类；strict policy 是否生效不重写它。

channel descriptor 的采集完整度与本次 decoder 状态仍由 Record reader 单独给出。被请求的 Verdict channel 无效时，planner 和需要它的页面失败；`unavailable` 或 `unsupported` 不能被替换成 `passed`。

Verdict 与 eligibility 的 `/v1` payload 永不扩展。payload shape 变化发布新的 ChannelSchemaId；语义真正变化才换 ChannelName。carry 还必须显式接受 eligibility schema 与 `reuseContract` domain，不能因 decoder 能展示新旧值就自动复用。

## Planner 与 Reports

execution projector 从 `RecordWriteSession.view` 的 frozen selection 读取 Verdict 与 eligibility。只有两个 ChannelRead 都是 read、durable complete、decoding complete、精确 payload 合法，且 schema、`reuseContract`、identity、duration 与本次 policy 全部满足时，planner 才可采用 Attempt。

Reports 从 ReportInput 显示 Verdict、相关 Assertion 和诊断。它不打开 Record 文件，不从 Assertions 重新折叠 Verdict，也不猜测 strict policy、控制流或缺失数据。

## 相关阅读

- [Assertions 架构](../assertions/architecture.md)
- [Record 通道](../record/architecture.md#channel-identity-与局部演进)
- [Record Library · registry](../record/library.md#channel-registry-与-factrequirement)
- [缓存与携带](../experiments/cache.md)
