# 报告组件

组件库分三层，每层都只消费已经计划并生成的值：

| 层 | 成员 | 知道什么 |
|---|---|---|
| 显示原语 | `Scatter`、`Table`、`Waterfall` 等 | 具体 props 与显示形状 |
| 组合组件 | `ExperimentScatter`、`ExperimentTable`、`ExperimentDetails` 等 | 明确的 ReportData 输入形状 |
| 共用函数 | 视觉身份、labels、MetricValue 格式化与 target 编码 | 已建立的值与页面 identity |

原语不读取 Sample、Record、Store、Claim 或 raw event schema。
组合组件也不从隐式上下文取数；它们接收 plan 中声明并由 executor 交付的 data。
同一个组件实例的 text 与 web renderer 消费同一份不可变输入。

## 按显示形状选择

| 形状 | 组件 | 主要属性 |
|---|---|---|
| 表格 | `Table` | `rows` |
| 散点 | `Scatter` | `points`、`x`、`y`、`point` |
| 折线、柱、面积 | `Line`、`Bars`、`Area` | `points`、`x`、`y` |
| 单个读数 | `Stat` | `value` |
| 摘要格 | `Grid` | `items` |
| 提示组 | `Callouts` | `items` |
| 对话 | `Conversation` | `turns` |
| 时间树 | `Waterfall` | `nodes` |
| 源码 | `SourceView` | `source` |
| Diff | `DiffView` | `files` |
| Attempt 详情 | `AttemptDetails` | `attempt` |
| 实验详情 | `ExperimentDetails` | `input` |

不存在适用于所有组件的 `data` 属性。
页面 data 是 executor 的输入对象；组件 props 是从中挑出的确定值。

## 目录

- [Charts](charts/README.md) —— `Scatter`、`Line`、`Bars`、`Area` 与组合坐标图。
- [Experiment scatter](summaries/experiment-scatter.md) —— 成本 × 主读数的默认散点图。
- [Experiment table](summaries/experiment-table.md) —— Experiment → Eval → Attempt 的层级详情。
- [Attempt details](attempt-detail/README.md) —— 已计划 Attempt details data 和叶子区块。
- [Experiment details](experiment-detail/README.md) —— 单个实验的完整读面。
- [Gallery](gallery.md) —— 每个官方形状的最小示例与双面验收入口。
- [Site components](site/README.md) —— 静态站首页的结构组件。
- [排版与自定义 renderer](../library/layout.md) —— 结构节点、排版原语与扩展协议。

`primitives/` 下的页面逐项定义 `Table`、`Grid`、`Callouts`、`Conversation`、`Waterfall`、`SourceView` 与 `DiffView` 的值形状和双面降级。

## EvidenceRow 与 points

从 Sample 派生的图表 points 必须包含已经建立的 MetricValue。
每个 MetricValue 都保留 coverage、basedOn、refs 与 available / unavailable 判别；available 保留 verification / issues，unavailable 保留 causes。

业务 snapshot 也由 Projector author function 返回 raw value，再由 runtime 用 tracked provenance
包装成 EvidenceValue。
组件不接受没有 basedOn 的逃生数据，也不通过标志跳过证据边界。

## 维度呈现分配单位是 page instance

一个维度值的显示名与视觉身份按 page instance 的已交付 keyset 消解。
同一 instance 内的所有组件读同一份分配；别的 instance 不需要执行才能决定本页颜色。

`dimensionPins` 中的固定值占用指定槽位，未固定值按稳定 identity 分配剩余槽位。
固定只影响呈现，不改变 group、MetricValue、coverage 或 evidence。

## 自定义显示形状

只有现有原语组合不出的显示逻辑才定义新 renderer：

```tsx
const ConfusionMatrix = defineRenderer({
  text(value, options, context) {
    return renderTextMatrix(value, options, context);
  },
  web(value, options, context) {
    return <WebMatrix value={value} options={options} context={context} />;
  },
});
```

`ConfusionMatrix` 与 `WebMatrix` 是这段作者侧示例中的局部 renderer 名称，不是第二套组件协议；`defineRenderer`、其 input/output 形状与双面约束只由 [Reports Library](../library.md#静态定义route-与页面树) owner。

两面都必须实现，并且只接收已生成的值。
scripts 与 styles 可以随 renderer 声明，但只能增强浏览行为，不能读取新数据或重判证据资格。

## 准入边界

组件目录按显示形状增长，不按领域问题增长。
领域分析先写成静态 Calculation 或报告旁纯函数；成品装配写进 ReportPlan；只有新双面显示逻辑才增加原语。

完整判据见 [Calculations · 组件的准入判据](../calculations.md#组件的准入判据)。
