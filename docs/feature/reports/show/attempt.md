# 单 Attempt 默认详情

范围恰好选择一个 Attempt、且没有显式切片时，`show` 先形成只含该成员的固定 Sample。标准 ReportDefinition 的 `plan()` 枚举对应详情 instance、所需 Projector 与 Calculation；executor 生成 ReportData 后，text 面只渲染这份数据。

同一个 ReportData 子树也供 `--json` 使用。两种输出不会各自读取 Record 或重新计算证据。

## 默认顺序

1. 完整 AttemptRef、origin Run、membership slot 与 adopted revision。
2. verdict、usage、耗时、成本、得分和其它已交付读数。
3. unavailable evidence 的全部 causes 与 basedOn，或 available limited evidence 的 verification 与全部 issues。
4. snapshot facts、notice、源码、执行、时间线、对话、trace 与文件差异的已计划投影。
5. 同一 ReportPlan 已存在的下钻 target。

每个区块都由 plan 中的 data request 决定。没有可显示内容时，区块输出零内容或原样显示 unavailable；不能猜零值、主因或成功状态。

顶部摘要、时间线与表格复用同一份 MetricValue 和 EvidenceValue。格式化只改变 text/web 形状，
不改变 coverage、refs、unavailable causes / basedOn 或 available verification / issues。

## Usage 与 facts

Usage Projector 声明行为计数、token、请求和成本所需的 snapshot 事实。缺少任一字段时，输出相应 EvidenceValue；详情和 `--usage` 使用同一数据入口，聚合策略由该 target 的 Calculation 明确声明。

Facts Projector 读取与 AttemptRef 绑定的 snapshot facts，并交付完整键值表。开放键集合不会在 renderer 中按 key 名扩展成新的查询；没有内容时详情不摆空表。具体值形状见 [Attempt Facts](../components/attempt-detail/attempt-facts.md)。

## 源码、notice 与时间线

源码、断言、notice、生命周期、对话和 diff 都是 plan 中预先列出的投影。Source、Execution、Timing 与 Diff target 可以把同一 ReportData 的相应部分排成不同显示形状，但不能以 flag 或展开操作补发读取。

导出时，源 Record 中已有而不能复制或验证的依据使导出失败；它不能在详情中伪装成 `not-recorded` 或普通 unavailable。

## 显式切片

- [`--source`](eval-source.md) —— 已计划的源码或断言投影。
- [`--execution`](execution.md) —— 已计划的对话与工具调用投影。
- [`--timing`](timing.md) —— 已计划的生命周期阶段与 spans。
- [`--usage`](usage.md) —— 固定 Sample 上的 usage target。
- [`--diff`](diff.md) —— 已计划的文件差异投影。

这些切片各有确定 target；没有一条从 AttemptDetails 组件树反向抽取数据。

## 自定义报告

显式 `--report <file>` 时，固定 Sample 中的 Attempt 只有在所选定义已于 plan 中枚举其详情 instance 时才可打开。没有该 instance 则命令报错；宿主不静默换回标准详情。

## 相关阅读

- [`AttemptDetails`](../components/attempt-detail/README.md)
- [Show](../show.md)
- [Show JSON](json.md)
- [Reports Library · 参数化页](../library.md#参数化页attempt-与-experiment-详情)
