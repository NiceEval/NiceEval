# Verdict 与 Severity

Verdict 由 Attempt 的 assertion、执行错误和显式 skip 形成，并写入 <code>niceeval.verdict</code> channel。它是业务数据，不是读取器的计算副本。

## Severity

每条 Assertion 的 severity 都是 <code>gate</code> 或 <code>soft</code>。

| Assertion 状态 | 默认影响 | strict policy 下的影响 |
|---|---|---|
| gate failed | Verdict 为 <code>failed</code>。 | Verdict 为 <code>failed</code>。 |
| soft failed | 保留失败条目。 | Verdict 为 <code>failed</code>。 |
| 非 optional unavailable | Verdict 为 <code>errored</code>。 | Verdict 为 <code>errored</code>。 |
| optional unavailable | 保留不可用状态。 | 保留不可用状态。 |

<code>stopOnFailure</code> 只停止后续用户测试代码。它不把 soft 变成 gate，也不改变 channel 数据的含义。

## 四态折叠

按以下顺序形成一个 Attempt Verdict：

1. 存在终局执行错误，或存在非 optional unavailable Assertion，得到 <code>errored</code>。
2. 存在 gate failed，或 strict policy 下存在 soft failed，得到 <code>failed</code>。
3. 作者显式 skip，得到 <code>skipped</code>。
4. 其余情况得到 <code>passed</code>。

<code>errored</code> 与 <code>failed</code> 分别表示执行或材料无法完成，以及检查已经得到不满足的事实。页面必须保留对应 assertion 或 diagnostic，不能只显示四态词。

## 通道数据

<code>niceeval.verdict</code> 的精确 payload 只有四态 <code>state</code>。Assertion、diagnostic 引用和人读摘要属于各自业务通道，不进入 Verdict。精确 document 与 media type 由 [Record Architecture](../record/architecture.md#通道语义与兼容性) 单点定义。

channel descriptor 的采集完整度与本次 decoder 状态仍由 Record reader 单独给出。被请求的 Verdict channel 无效时，planner 和需要它的页面失败；<code>unavailable</code> 或 <code>unsupported</code> 不能被替换成 <code>passed</code>。

Verdict 与 eligibility 的 payload 永不扩展。破坏性语义变化需要新的完整格式名；普通业务通道可以通过新名称或局部 unsupported 演进。

## Planner 与 Reports

carry planner 读取 Verdict 与 eligibility 的当前值。只有两个 ChannelRead 都是 read、durable complete、decoding complete、精确 payload 合法，且 identity/duration 与本次 policy 全部满足时，planner 才可采用 Attempt。

Reports 从 ReportInput 显示 Verdict、相关 Assertion 和诊断。它不打开 Record 文件、不重新折叠状态，也不猜测缺失数据。

## 相关阅读

- [Assertions 架构](../assertions/architecture.md)
- [Record 通道](../record/architecture.md#通道语义与兼容性)
- [Record Library · 内建 decoder](../record/library.md#内建-decoder)
- [缓存与携带](../experiments/cache.md)
