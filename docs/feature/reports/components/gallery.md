# 图表与表格画廊

本页只展示组合形态；数值与缺失规则见 [`Chart`](charts/README.md) 和
[`Table`](primitives/table.md)。

## 排行柱

```tsx
const ranking = sources.measure.rows({
  dimensions: ["agent"],
  measures: [passRate],
});

<Chart
  source={ranking}
  x="passRate"
  y={{ field: "agent", sort: "passRate" }}
  layout="vertical"
>
  <Series id="pass-rate" mark="bar" />
</Chart>
```

## 按 Eval 前缀分面

分面属于普通 TSX 组合；每个面板生成自己的 Dataset Source，题集选择不进入 Chart props：

```tsx
<Grid>
  {["coding/", "research/"].map((prefix) => (
    <Section key={prefix} title={prefix}>
      <Chart
        source={sources.measure.rows({
          evals: prefix,
          dimensions: ["agent"],
          measures: [passRate],
        })}
        x="passRate"
        y={{ field: "agent", sort: "passRate" }}
        layout="vertical"
      >
        <Series id="pass-rate" mark="bar" />
      </Chart>
    </Section>
  ))}
</Grid>
```

## 堆叠成本

```tsx
const costBreakdown = sources.measure.rows({
  dimensions: ["experiment"],
  measures: [plannerCostUSD, workerCostUSD],
});

<Chart source={costBreakdown} x="experiment" y="plannerCostUSD" legend tooltip>
  <Series id="planner" mark="bar" y="plannerCostUSD" stack="cost" />
  <Series id="worker" mark="bar" y="workerCostUSD" stack="cost" />
</Chart>
```

## 质量 × 成本前沿

```tsx
const frontier = sources.measure.rows({
  dimensions: ["experiment", "agent"],
  measures: [costUSD, passRate],
});

<Chart source={frontier} x="costUSD" y="passRate" legend tooltip>
  <Series id="frontier" mark="scatter" points="experiment" by="agent" />
</Chart>
```

## 混合 mark

```tsx
const qualityAndCost = sources.measure.rows({
  dimensions: ["experiment"],
  measures: [costUSD, passRate],
});

<Chart
  source={qualityAndCost}
  x="experiment"
  y={[
    { id: "cost", field: "costUSD" },
    { id: "quality", field: "passRate" },
  ]}
  legend
  tooltip
  grid
>
  <Series id="cost" mark="bar" y="costUSD" yAxis="cost" />
  <Series id="quality" mark="line" y="passRate" yAxis="quality" />
</Chart>
```

## 同数据的精确表

图用于找形状，表用于核对精确值。二者可并列使用：

```tsx
<Col>
  <Chart source={frontier} x="costUSD" y="passRate" legend tooltip>
    <Series id="frontier" mark="scatter" points="experiment" by="agent" />
  </Chart>
  <Table source={frontier} filter />
</Col>
```
