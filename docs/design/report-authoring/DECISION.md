# 决策

> 本裁决已被 [CLI 与 Insight](../cli-insight/DECISION.md) 取代。PLAN-7 只代表旧目标作者面，本篇保留形成历史；外部用户网页接入面尚未定案。

**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [PLAN-5](PLAN-5/README.md) · [PLAN-6](PLAN-6/README.md) · [PLAN-7](PLAN-7/README.md)

## 裁决

采纳 [PLAN-7](PLAN-7/README.md)。

作者面是 nominal Analysis fields、受限 `ReportSample`、`await aggregate(sample, ...)`、普通 async component 与 closed
semantic components。

- Analysis package 在 nominal population 上定义 Dimension、Measure 与具名 relation。
- `aggregate(sample, { by, values })` 只组合同一 population fields，并返回 closed typed rows。
- `ReportSample` 不枚举 raw Run / Attempt，不读 Record，不调用 projection，也不改变 population。
- 每次 `aggregate()` 调用编译自己的有限 field DAG；同一次 execution 按 exact field identity memoize。
- Page / component callback 每个 instance 只执行一次，不 dry-run。
- callback 可以依据 closed rows 分支，再调用另一组 `aggregate()`。
- `MetricValue` 保留 value、state、observed / denominator、issues、refs、unit、format、better 与 producer compatibility。
- callback 完成后只留下 closed semantic tree，供 terminal、Web 与 static face 共用。
- custom component 只组合既有 primitives；新增 primitive 必须同时定义三种 face 与无 JavaScript 降级。

## 不可能三角

普通 data-dependent JavaScript callback 无法同时满足：

1. callback 只执行一次，并可根据已算结果分支；
2. callback 前预编译整份 Report 的全部依赖；
3. 只执行请求 Page，并隔离其它 Page 的失败。

选择保留第 1、3 项，放弃第 2 项：

```text
request Page
  → run callback once
      → aggregate A: compile + execute finite field DAG
      → optional branch
      → aggregate B: compile + execute finite field DAG
  → close semantic tree
  → render
```

这是从 PLAN-6 翻转的关键点。whole-report precompile 不是保留 0.12.1 DX 的必要条件；field-level identity、within-execution cache、
frozen Sample 与 closed output 已足以保留数据正确性和交付边界。

## 为什么替换 PLAN-6

PLAN-6 把 `aggregate()` 变成 static `ReportData` declaration，并要求 callback 只组合 descriptors。它守住全局预编译，却产生三项
作者成本：

- 调用形状偏离普通 async TypeScript；
- rows 不能在 callback 中检查或用于数据依赖分支；
- 为了提前知道全部依赖，Page 定义必须承担额外 declaration protocol。

PLAN-7 保留 PLAN-6 的 Analysis fields、MetricValue、stable identity 与 once-per-execution cache。renderer input 仍然 closed，
依赖发现在实际 `aggregate()` call 发生，而不是 whole-report definition phase。

## 为什么仍否决其它方案

- PLAN-1 的专用组件数与用户问题数共同增长。
- PLAN-2 的通用 async Source 没有统一 population、denominator 与 Evidence contract。
- PLAN-3 把聚合层数、missing 与 refs 交给每条 SQL。
- PLAN-4 让较弱 SQL 路径成为事实标准，并维持两套读取语义。
- PLAN-5 的 projection / Calculation plumbing 继续作为内部实现材料，不作为普通作者 API。
- PLAN-6 的 static field compiler 继续作为局部 `aggregate()` executor 的实现材料，不再支配 Page authoring protocol。

## 确定性边界

硬保证只到一次 `ReportExecution`：

- 每个 Page / component instance 最多执行一次；
- 所有 field reads 绑定同一 frozen Sample；
- cache key 使用 nominal descriptor / dependency identity；
- 同一次 execution 的 terminal、Web 与 static face 消费同一 closed tree；
- static export 可以跨本次枚举的 Page instances 复用 field results。

不同 execution 不承诺 cache reuse。普通 callback 的跨 execution 纯度是 trusted-author contract；provenance 保存 Report module
fingerprint、Sample identity、selection 与 host version。若产品要求不信任作者时仍机械确定，应新增 restricted declaration /
isolate，而不是削弱普通 callback。

## 当前契约落点

- 三层总纲：[Record → Analysis → Report](../../feature/record-report/README.md)。
- 统计口径与闭合值：[Analysis Library](../../feature/analysis/library.md)。
- Report 作者 API：[Report Library](../../feature/reports/library.md)。
- 执行与闭合边界：[Report Architecture](../../feature/reports/architecture.md)。

## 风险与明确牺牲

- host 无法在 callback 前展示整份 Report 的完整 dependency inventory。
- 未请求 Page 的 dependency error 延迟到该 Page 执行。
- trusted callback 可能读取时钟、随机数或网络，因此跨 execution 不承诺逐字节相同。
- closed rows 的 display-only JavaScript 处理不能由 TypeScript 完全证明不改变业务口径。
- 普通用户不能注册任意 visual primitive；这换来 terminal、Web 与 static 不分裂。
