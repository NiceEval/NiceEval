# 报告组件

组件库分三层，每层的知识边界不同：

| 层 | 成员 | 知道什么 |
|---|---|---|
| 显示原语 | `Scatter`、`Table`、`Waterfall` 等 | 只知道传入的普通值与显示形状 |
| 组合组件 | `ExperimentScatter`、`ExperimentTable`、`ExperimentDetails` 等 | 知道 Sample 与实验、eval 这些实体，替所有 niceeval 报告装配一个稳定读面 |
| 共用函数 | 维度视觉身份分配、`shortestUniqueLabels`、`targetOfRefs`、MetricValue 格式化 | 让颜色、label、格式与下钻默认规则在整库只有一处定义 |

显示原语只接 page render 或组合组件已经算好的普通值，不读取 Sample、Record 或 artifact。
原语同样不认识实体：attempt、experiment 这些词不出现在原语的属性与实现里，点击语义经 `pointTarget` 这类属性由上层供给（[目标与下钻](../library.md#目标与下钻)）。
官方组合组件可以从 `ctx.scope` 读取当前 Sample，完成一个稳定读面的取数与原语装配；它们仍只调用公开转换、聚合与显示原语，不建立第二条计算口径。
实体知识（选哪些轴、点指向哪张页）全部住在这一层。
同一个组件实例的 text 与 web renderer 消费同一份已求值的最终值。

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

高频完整读面提供组合组件：

| 读面 | 组件 | 行为 |
|---|---|---|
| 实验散点 | `ExperimentScatter` | 成本 × 主读数 |
| 实验层级表 | `ExperimentTable` | Experiment → Eval → Attempt 层级表 |
| 实验详情 | `ExperimentDetails` | 单个实验的完整详情读面 |
| 默认概览 | `SampleOverview` | `SampleSummary` + 散点与层级表 |

不存在适用于所有组件的 `data` 属性。
`source` 在 `SourceView` 中只表示待显示的源码值，不表示惰性数据源。

## 目录

- [Charts](charts/README.md) —— `Scatter`、`Line`、`Bars`、`Area` 与组合坐标图。
- [Experiment scatter](summaries/experiment-scatter.md) —— 成本 × 主读数的默认散点图。
- [Experiment table](summaries/experiment-table.md) —— Experiment → Eval → Attempt 的层级详情。
- [Attempt details](attempt-detail/README.md) —— AttemptEvidence 的完整详情和叶子区块。
- [Experiment details](experiment-detail/README.md) —— 单个实验的完整详情读面。
- [Gallery](gallery.md) —— 每个官方形状的最小示例与双面验收入口。
- [Site components](site/README.md) —— 静态站首页的结构组件。
- [排版与自定义 renderer](../library/layout.md) —— 结构节点、排版原语与扩展协议。

`primitives/` 下的页面逐项定义 `Table`、`Grid`、`Callouts`、`Conversation`、`Waterfall`、`SourceView` 与 `DiffView` 的值形状和双面降级。

## EvidenceRow 与外部 points

从 Sample 派生的图表 points 必须是 EvidenceRow。
每个 MetricValue 带 `samples`、`total`、`basis` 与精确 refs，行级 refs 是这一行各 MetricValue refs 的稳定去重并集。

纯外部序列不伪造 Attempt refs。
作者必须在图表上显式声明 `external`；这类点只显示业务快照，不提供 Attempt 下钻。

## 维度呈现分配单位是页

一个维度值的显示名与视觉身份都按**页**消解：一次 page render 产生一份分配，页内所有组件读同一份。
每页有两个 keyset：

- **label keyset**：这一页声明过该维度的全部完整值，`shortestUniqueLabels` 在它上面算最短唯一后缀；
- **visual keyset**：这一页以 `color` 或 `series` 编码声明的值，它们占用视觉槽位。

槽位分配对同一份输入是确定的，与组件声明顺序无关：

1. 外壳 [`dimensionPins`](../library/shell.md#dimensionpins) 里固定且出现在本页 visual keyset 的值，原样占用固定槽位。
2. 未固定的值按（维度名，完整值）的稳定哈希取起点，在剩余槽位上向后探测，取第一个空槽。
   哈希与探测算法属于公开契约，相同输入跨平台产生相同分配。
3. 固定但本页未出现的值不占槽，它的槽位留给探测使用。

固定的值因此在每一页拿到同一个视觉身份；未固定的值页内自洽，跨页不承诺一致——要跨页一致就固定它。
分配只需要固定声明与本页 keyset，宿主因此可以只执行被请求的 page，不为配色求值其它页。

## 视觉编码容量（24 个身份）

视觉槽位共 24 个：主题的六个 series 颜色乘四个形状变体，变体按 mark 取义（线型、marker 形状或填充图案）。
槽位号 1–24：1–6 是第一变体的六色，7–12 是第二变体，依此类推，与主题令牌 `--niceeval-color-series-1..6` 同为一基；换 palette 只换颜色，不改变槽位序列与身份。

一页的 visual keyset 超过 24 时，该页按完整用户反馈被拒绝：同图超过 24 个身份已不可读，正确动作是收窄 Sample 或换分组，固定救不了容量。
label keyset 不受这个上限约束。

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

`defineRenderer` 从 `niceeval/report/extension` 导出。
两面都必须实现，并且只接收已经计算好的普通值。
自定义计算是普通函数，不需要注册扩展。

脚本与样式随 renderer 的 `assets` 声明。
运行时只收集当前 page 实际出现的组件资产，按内容哈希复制到 `assets/` 并去重。
初始 HTML 在没有 JavaScript 时仍完整可读；增强脚本只增加浏览行为。

## 准入边界

组件目录按显示形状增长，不按领域问题增长。
一个领域分析先写成接收 Sample 或 AttemptHandle 的普通函数；一个成品装配写成普通 page render 或具名 PageDefinition。
只有双面存在新的显示逻辑时才增加原语。

完整判据见 [Calculations · 组件的准入判据](../calculations.md#组件的准入判据)。
