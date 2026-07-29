# 排版原语与自定义 renderer

page render 返回 `ReportNode`。节点只表达内容顺序、分组与显示形状；
页面的异步计算已经在返回节点前完成。

## 结构节点

`Page`、`Stack`、`Row`、`Col`、`Section`、`Grid`、`Tabs` 与 `Markdown`
只组织子节点。它们不接收 Sample，不读取 artifact，也不改变 MetricValue。

```tsx
return (
  <Page title="Quality and cost">
    <Row>
      <Scatter
        points={performance}
        x="costUSD"
        y="passRate"
        point="agent"
      />
      <Table rows={performance} />
    </Row>
  </Page>
);
```

`Row` 和 `Col` 表达阅读关系，不承诺固定像素几何。
text 面按终端显示列决定换行与上下排列；web 面用容器大小和主题断点排版。
两面必须保留节点顺序、标题层级、字段终值与缺数据语义。

## `Grid` 与 `Stat`

`Grid` 接 `items`，用于少量并列摘要；`Stat` 接一个 `MetricValue`
或明确的外部标量。MetricValue 的格式化由 renderer 根据 `unit`、
`format` 与 locale 完成，作者不提前把值拼成字符串。

```tsx
<Grid
  items={[
    <Stat label="Pass rate" value={summary.passRate} />,
    <Stat label="Cost" value={summary.costUSD} />,
  ]}
/>
```

外部标量必须显式标注为 external，不能伪造 samples、total 或 Attempt refs。

## `Table`

`Table<Row>` 接普通只读 `rows`。列省略时按稳定字段顺序推导；
覆盖列时使用字段名或列定义。

```tsx
<Table
  rows={performance}
  columns={[
    "agent",
    { field: "costUSD", label: "Spend" },
    "passRate",
  ]}
/>
```

MetricValue 单元格显示本地化数值，并保留 samples / total 与 refs 的检查入口。
普通字符串、布尔值和时间字段按各自类型显示。
不存在 `source`、`data` 或 `input` 三选一绑定。

## `Tabs`

`Tabs` 只切换同一 page 已经产生的节点。
它不建立新的 page、路由、异步边界或缓存单位。
需要按需计算和失败隔离时，静态声明多个 PageDefinition。

## 自定义 renderer

只有新增显示形状时才使用 `defineRenderer()`：

```tsx
import { defineRenderer } from "niceeval/report/extension";

export const Heatmap = defineRenderer({
  assets: {
    styles: ["./heatmap.css"],
    scripts: ["./heatmap.enhance.ts"],
  },
  text(value: HeatmapValue, options, context) {
    return renderTextHeatmap(value, options, context);
  },
  web(value: HeatmapValue, options, context) {
    return <WebHeatmap value={value} options={options} />;
  },
});
```

renderer 接已计算好的普通值。`text` 与 `web` 都是必填项；
两面不能重新取数、读取 Sample 或改变终值。
若 web 交互没有诚实的 text 降级，它属于宿主能力，不是组件。

资产路径相对 renderer 定义文件解析。
运行时按页面实际使用情况收集、按内容哈希物化，并以稳定顺序注入。
JavaScript 只能渐进增强，不能让初始 HTML 缺失数据。

## 普通函数负责复用

复用一个动态区块时写普通函数：

```tsx
export async function costliestAttempts(
  sample: Sample,
  limit = 10,
): Promise<ReportNode> {
  const attempts = sample.attempts
    .toSorted((a, b) =>
      (attemptCostUSD(b.result) ?? 0) -
      (attemptCostUSD(a.result) ?? 0)
    )
    .slice(0, limit);

  return <AttemptList attempts={attempts} />;
}
```

调用者直接 `await costliestAttempts(sample)`。
函数参数是复用参数，Sample 是运行期输入；两者都不需要新的组件求值协议。

## 相关阅读

- [Library](../library.md) —— page render、普通转换与具体组件属性。
- [组件目录](../components/README.md) —— 官方显示形状。
- [Architecture](../architecture.md) —— 双面渲染、缓存与组件资产。
