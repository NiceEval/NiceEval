# 跟踪一个 Experiment 的历次 Run

## 解决什么问题

默认报告回答「现在什么水平」,但你要看同一个 Experiment 跨多次 Run 是稳定改善、周期波动,还是某次异常。

## 全流程

1. 不用宿主注入的当前 Sample 冒充历史;在组合组件里从 `ctx.record.experiments` 找到目标 Experiment。
2. 把它的 `runs` 显式作为组件 `input`,行维度选 run。
3. 用 `MetricTable` 对账每次 Run 的成功率、成本和样本数;只有 x 轴确实是有序数值时才改用数值轴 `LineChart`。
4. Run 内携带的 Attempt 依然按时效契约标记;历史报告不假设每个点都是当次进程全新执行。

## 边界

- `latestKnown(record)` 是现刻水位,可跨 Run 拼题;它不是时间序列。
- `show --history` 是单个 Experiment + Eval 的 Attempt 时间线;跨 Run 指标趋势用本用例。
