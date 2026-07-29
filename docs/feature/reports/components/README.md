# 报告组件

组件只显示 page render 已经算好的普通值。它们不读取 Sample、Record 或 artifact，
不执行聚合，也不触发另一条取数管线。同一个组件实例的 text 与 web renderer
消费同一份值，page render 只执行一次。

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

不存在适用于所有组件的 `data` 属性。`source` 在 `SourceView` 中只表示待显示的
源码值，不表示惰性数据源。

## 目录

- [Charts](charts/README.md) —— `Scatter`、`Line`、`Bars`、`Area` 与组合坐标图。
- [Attempt details](attempt-detail/README.md) —— AttemptEvidence 的完整详情和叶子区块。
- [Gallery](gallery.md) —— 每个官方形状的最小示例与双面验收入口。
- [Site components](site/README.md) —— 静态站首页的结构组件。
- [排版与自定义 renderer](../library/layout.md) —— 结构节点、排版原语与扩展协议。

`primitives/` 下的页面逐项定义 `Table`、`Grid`、`Callouts`、`Conversation`、
`Waterfall`、`SourceView` 与 `DiffView` 的值形状和双面降级。

## EvidenceRow 与外部 points

从 Sample 派生的图表 points 必须是 EvidenceRow。
每个 MetricValue 带 `samples`、`total`、`basis` 与精确 refs，
行级 refs 是这一行各 MetricValue refs 的稳定去重并集。

纯外部序列不伪造 Attempt refs。作者必须在图表上显式声明 `external`；
这类点只显示业务快照，不提供 Attempt 下钻。

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
运行时只收集当前 page 实际出现的组件资产，按内容哈希物化和去重。
初始 HTML 在没有 JavaScript 时仍完整可读；增强脚本只增加浏览行为。

## 准入边界

组件目录按显示形状增长，不按领域问题增长。
一个领域分析先写成接收 Sample 或 AttemptHandle 的普通函数；
一个成品装配写成普通 page render 或具名 PageDefinition。
只有双面存在新的显示逻辑时才增加原语。

完整判据见 [Calculations · 组件的准入判据](../calculations.md#组件的准入判据)。
