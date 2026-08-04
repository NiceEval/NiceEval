# Attempt facts

`attemptFactsData(attempt)` 投影 `AttemptRecord.facts`——生命周期代码经 `ctx.fact()` 上报的[运行时观测](../../../record/architecture.md#facts运行事实)——为完整键值表：`{ key, value }[]`，按落盘 key 的插入顺序排列，不重新排序、不按 key 名分组。

facts 是开放键集合：一次运行可能上报零到几十个键，键名与值形状都由生命周期代码决定。这与 Usage 固定的几个已知字段不同，因此组件渲染整张表而不是压成一行摘要——压缩会丢内容，而 facts 恰恰是「这次实际观测到了什么」的审计证据。

`AttemptRecord.facts` 缺失或为空对象时，`factsResult` 返回 `null`；组件零输出，不摆空表。
value 是 `string | number | boolean` 标量，两面都按 `String(value)` 显示，不做数值格式化（facts 不是读数，没有单位换算或千分位的必要）。

Run 级 `RunMeta.facts`（experiment 生命周期上报的观测）不在这张表里；attempt 详情只读 attempt 作用域的 facts，Run 级观测的呈现不在本组件范围。

## 相关阅读

- [Record · facts：运行事实](../../../record/architecture.md#facts运行事实) —— 上报通道、归属与落盘字段契约。
- [show 详情 · Facts](../../show/attempt.md#facts) —— 终端呈现示例。
