# `MetricMatrix`

行、列各一个维度，格子是一个指标。适合看「题 × 配置」的判定分布；要比较每行的相对大小，用 [`BarChart`](../charts/README.md#容器) 的同一份维度绑定。共用数据形状、维度绑定节点与两面规则见[表格与矩阵](README.md)。

```tsx
<MetricMatrix>
  <Rows dimension="eval" />
  <Columns dimension="agent" />
  <Cells metric={endToEndPassRate} />
</MetricMatrix>
```

```ts
interface CellsProps {
  metric: Metric;
}

interface MetricMatrixOptions {
  rows: DimensionInput;
  columns: DimensionInput;
  cell: Metric;
  evals?: string | readonly string[];
}

function metricMatrixData(
  input: ReportInput,
  options: MetricMatrixOptions,
): Promise<MatrixData>;

type MetricMatrixProps = ComponentProps<MatrixData, {
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}>;
```

矩阵是稀疏的：没有 attempt 的组合不生成格子，渲染面显示占位 `—`。格子中的 `refs` 保留证据引用，传了 `attemptHref` 时格子可跳到对应 attempt。恰好一个 `<Rows>`、一个 `<Columns>`、一个 `<Cells>`；缺任一个或重复声明按完整用户反馈报错。

## 相关阅读

- [表格与矩阵](README.md) —— 共用数据形状、维度绑定节点与两面规则。
- [`MetricTable`](metric-table.md) / [`Scoreboard`](scoreboard.md) / [`DeltaTable`](delta-table.md) / [`StabilityMatrix`](stability-matrix.md) —— 其它表格与矩阵。
