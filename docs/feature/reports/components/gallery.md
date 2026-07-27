# 图表与表格画廊

本页只展示组合形态；数值与缺失规则见 [`Chart`](charts/README.md) 和
[`Table`](primitives/table.md)。

## 排行柱

```tsx
const ranking = chart({
  x: { measure: endToEndPassRate },
  y: { dimension: "agent", sort: endToEndPassRate },
  series: [{
    key: "pass-rate",
    mark: "bar",
    measure: endToEndPassRate,
  }],
});

<Chart source={ranking} layout="vertical" />
```

## 按 Eval 前缀分面

分面属于普通 TSX 组合；每个面板复用同一份声明，只改变 `evals`：

```tsx
<Grid columns={2}>
  {["coding/", "research/"].map((prefix) => (
    <Section key={prefix} title={prefix}>
      <Chart source={ranking} evals={prefix} layout="vertical" />
    </Section>
  ))}
</Grid>
```

## 堆叠成本

```tsx
const costBreakdown = chart({
  x: { dimension: "experiment" },
  y: { measure: costUSD },
  series: [
    {
      key: "planner",
      mark: "bar",
      measure: plannerCostUSD,
      stack: "cost",
    },
    {
      key: "worker",
      mark: "bar",
      measure: workerCostUSD,
      stack: "cost",
    },
  ],
});

<Chart source={costBreakdown} legend tooltip />
```

## 质量 × 成本前沿

```tsx
const frontier = chart({
  x: { measure: costUSD },
  y: { measure: endToEndPassRate },
  series: [{
    key: "frontier",
    mark: "scatter",
    points: "experiment",
    by: "agent",
    x: costUSD,
    y: endToEndPassRate,
  }],
});

<Chart source={frontier} legend tooltip />
```

## 混合 mark

```tsx
const qualityAndCost = chart({
  x: { dimension: "experiment" },
  y: [
    { id: "cost", measure: costUSD },
    { id: "quality", measure: endToEndPassRate },
  ],
  series: [
    { key: "cost", mark: "bar", measure: costUSD, yAxis: "cost" },
    {
      key: "quality",
      mark: "line",
      measure: endToEndPassRate,
      yAxis: "quality",
    },
  ],
});

<Chart source={qualityAndCost} legend tooltip grid />
```

## 同数据的精确表

图用于找形状，表用于核对精确值。二者可并列使用：

```tsx
<Col>
  <Chart source={frontier} legend tooltip />
  <Table source={measureRows({
    rows: "experiment",
    measures: [endToEndPassRate, costUSD],
  })} filter />
</Col>
```
