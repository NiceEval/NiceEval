# `Table`

`Table<Row>` 接普通只读 `rows`：

```tsx
<Table rows={performance} />
```

省略 columns 时按第一行的稳定字段顺序推导。
覆盖列时传字段名或列定义：

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

MetricValue 显示本地化值、samples / total 与证据入口；
普通标量按实际类型显示。字段缺失或行形状不一致时，
错误指出 `rows[index].field`。

排序、过滤与 limit 只改变显示行，不重新聚合。
需要改变分组或合并长尾时回到 Sample 调用 `aggregate()`。

text 面输出对齐表格；web 面输出真实 `<table>`。
两面消费同一份 rows，并保持同一行序、列序与终值。

## 相关阅读

- [组件目录](../README.md)
- [Library · Table](../../library.md#table)
