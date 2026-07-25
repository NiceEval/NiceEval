# 扫描参数档位的趋势与拐点

## 解决什么问题

你对 token budget、context 大小或另一个数值条件做了多档扫描,要找收益递减、回归或性价比拐点。

## 全流程

1. 数值条件在 Experiment 的 flag 或 label 中显式声明,不从 id 字符串猜。
2. 用 `numericFlag` 或 `numericLabel` 定义 x 轴,用 `LineChart` 的 `<Line by=…>` 按 agent 或 lineage 分 series。
3. y 轴先放主成功指标;成本、耗时需要独立图或与前沿图互证。
4. 点缺失时查 samples/total 和 Scope 警告,不连出虚构线段。

## 边界

- 只有基线/候选两点且关心精确差值时用 `DeltaTable`。
- x 轴不是数值进程时,改用散点、表或条形图。
