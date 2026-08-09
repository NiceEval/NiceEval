# 排版原语与自定义 renderer

page instance 的 `render(data)` 返回 `ReportNode`。
节点只表达内容顺序、分组与显示形状；Plan 和 executor 已在此之前完成所有数据工作。

## 结构节点

`Row`、`Col`、`Section`、`Grid`、`Tabs` 与 `Markdown` 只组织子节点。
它们不接收 Sample、不读取 evidence、不改变 MetricValue，也不创建新的 ReportData request。

```tsx
<Col>
  <Section title="Quality and cost">
    <Row>
      <Scatter points={performance} x="costUSD" y="passRate" />
      <Table rows={performance} />
    </Row>
  </Section>
</Col>
```

页名来自 PlannedPage 的 id 与 title。
`Row`、`Col` 表达阅读关系，text 与 web 可按自己的空间排版，但必须保留节点顺序和 EvidenceValue 语义。

## `Grid` 与 `Stat`

`Grid` 接 `items`，`Stat` 接一个 MetricValue 或另一个已建立的 evidence 值。
renderer 根据 unit、format 和 locale 格式化；它显示 unavailable 的 causes、coverage 与 basedOn，
只在 available 分支显示 verification，不提前拼字符串或伪造外部标量。

## `Table`

`Table<Row>` 可以接普通只读 JSON rows；从 `aggregate()` 来的输入则必须传完整 `AggregateData`。
Table 先保留外层 EvidenceValue 与 AggregateResult coverage，available 时才显示 rows。AggregateRow
的 metrics、coverage 和 refs 已在 Plan 中确定；Table 只能排序、过滤或隐藏已有行，不能重组
Sample、调用 aggregate，或把 unavailable 输入替换为空数组。

## 区域框：text 面的框线体裁

终端里的线表达内容形态，而不是数据层：

| 输出形态 | 体裁 | 用途 |
|---|---|---|
| 面板 | 区域框 | 一块有边界、可整体阅读的 evidence |
| 数据格 | 数据格框 | Table 或 Grid 的行 × 列 |
| 同级重复块 | 隔条 | 多个平行区块 |
| 逐条流 | 无标注 | 连续过程条目 |

框线、列宽和折行只改变 text 的呈现。
非 TTY 或窄终端可以降为对齐文本，但字段、顺序、数值与 unavailable 信息不变。

### 数据格框（`Table` 与 `Grid`）

数据格以行列自然边界显示。
层级靠首列缩进表达；空间不足时压缩文本列，最后才隐藏列并明确报告。
Grid 和 Table 的 web/text 两面消费相同 rows，不因布局转换成另一种数据结构。

## `Tabs`

`Tabs` 只切换同一 page instance 已经生成的节点。
它不建立新 page、route、缓存单位或 data dependency。
需要独立 target 时，在 plan 中声明多个 PlannedPage。

## 自定义 renderer

```tsx
const Heatmap = defineRenderer({
  assets: {
    styles: ["./heatmap.css"],
    scripts: ["./heatmap.enhance.js"],
  },
  text(value, options, context) {
    return renderTextHeatmap(value, options, context);
  },
  web(value, options, context) {
    return <WebHeatmap value={value} options={options} context={context} />;
  },
}, import.meta.url);
```

renderer 接已经计算好的普通值。
text 与 web 都是必填项；两面不能读取 Sample、Store 或 evidence，不能改变 MetricValue 终值、coverage、
unavailable causes 或 available verification。
资产按已生成页面树收集，JavaScript 只能渐进增强。

## 普通函数负责复用

复用动态区块时，函数接收已交付的 data：

```tsx
interface AttemptListData {
  readonly attempts: readonly AttemptDetailsData[];
}

export function costliestAttempts(data: AttemptListData): ReportNode {
  return <AttemptList attempts={data.attempts} />;
}
```

`AttemptListData` 是本段普通复用函数的局部输入。`AttemptDetailsData` 的唯一 owner 是 [Attempt details](../components/attempt-detail/README.md#输入)，`ReportNode` 的唯一 owner 是 [Reports Library](../library.md#静态定义route-与页面树)。

函数不能追加 Projector request。
需要更多数据时，回到 ReportDefinition 的 plan 声明依赖。

## 相关阅读

- [Library](../library.md) —— Plan、data 与具体组件属性。
- [组件目录](../components/README.md) —— 官方显示形状。
- [Architecture](../architecture.md) —— 双面渲染与组件资产。
