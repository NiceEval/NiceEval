# `measureMatrix`

`measureMatrix(options)` 返回供 [`Table`](../primitives/table.md) 使用的数据源：行、列各取一个维度，
每个交叉格计算一个读数。它适合看「题 × 配置」的判定分布；要比较每行的相对大小，使用图表原语绑定
同一组维度与读数。共用 Content 形状与两面规则见[表格与矩阵](README.md)。

```tsx
<Table
  source={measureMatrix({
    rows: "eval",
    columns: "agent",
    measure: endToEndPassRate,
  })}
  evals="coding/"
/>
```

```ts
interface MeasureMatrixOptions {
  rows: DimensionInput;
  columns: DimensionInput;
  measure: Measure;
}

function measureMatrix(
  options: MeasureMatrixOptions,
): DataSource<MatrixContent>;
```

矩阵是稀疏的：没有 attempt 的组合不生成格子，`Table` 显示占位 `—`。格子中的 `refs` 保留证据
引用；传了 `attemptHref` 时可跳到对应 attempt。`rows` 与 `columns` 不能解析成相同维度，
`measure` 必须在目标 Sample 上可计算；违反时在 `compute()` 阶段给出完整用户反馈。

`evals`、`attemptHref`、`locale`、`className` 都属于 `Table` 的 source 或呈现选项，不进入
`MeasureMatrixOptions`。手工计算写
`await measureMatrix(options).compute(input)`，所得 `MatrixContent` 可直接交给
`<Table data={content}>`。

## 相关阅读

- [表格与矩阵](README.md) —— 共用数据形状、维度绑定选项与两面规则。
- [`measureRows`](measure-table.md) / [`scoreboard`](scoreboard.md) /
  [`deltaRows`](delta-table.md) / [`stabilityRows`](stability-matrix.md) —— 其它表格数据源。
