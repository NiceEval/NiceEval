# `Grid` 与 `Stat`

`Grid` 接有序 `items`，`Stat` 接一个 MetricValue 或显式 external 标量：

```tsx
<Grid
  items={[
    <Stat label="Pass rate" value={summary.passRate} />,
    <Stat label="Cost" value={summary.costUSD} />,
  ]}
/>
```

MetricValue 的 unit、format、samples、total 与 refs 保持完整，
renderer 按 locale 格式化。缺数据显示明确占位，不转成零。

Grid 根据格数与自身可用宽度换列，不读取视口宽度。
text 面按终端显示列选择一行或多行；web 面使用容器查询。

## 相关阅读

- [排版原语](../../library/layout.md#grid-与-stat)
