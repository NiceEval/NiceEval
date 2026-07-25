# `MetricTable`

一行一个维度值，一列一个指标。列按声明顺序排列。共用数据形状、维度绑定节点与两面规则见[表格与矩阵](README.md)。

```tsx
<MetricTable evals="coding/" filter>
  <Rows dimension="agent" sort={endToEndPassRate} />
  <Column metric={endToEndPassRate} />
  <Column metric={examScore} />
  <Column metric={costUSD} />
  <Column metric={durationMs} />
</MetricTable>
```

```ts
type ColumnProps =
  | { metric: Metric; dataKey?: string; name?: LocalizedText }
  | { dataKey: string; metric?: never; name?: LocalizedText };

interface MetricTableOptions {
  rows: DimensionInput;
  columns: readonly [Metric, ...Metric[]];
  sort?: Metric;
  /** eval id 前缀；与 CLI 位置参数同语义。 */
  evals?: string | readonly string[];
}

function metricTableData(
  input: ReportInput,
  options: MetricTableOptions,
): Promise<TableData>;

type MetricTableProps = ComponentProps<TableData, {
  filter?: boolean;
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}>;
```

- 至少一个 `<Column>`，Metric name 在同一张表内唯一；`name` 覆盖列头显示名，不改变 Metric 的计算口径。
- `<Rows sort>` 引用的 Metric 必须是本表某个 `<Column>` 的 Metric 且声明了 `better`，否则计算以完整用户反馈失败。
- `filter` 只给 web 面增加行过滤框；排序与过滤是浏览状态，不改变数据与 text 面。
- data 形态下 `<Column dataKey>` 选择 `TableData.columns` 中的一列；未被引用的列不渲染，重复引用同一个 key 报错。

## 相关阅读

- [表格与矩阵](README.md) —— 共用数据形状、维度绑定节点与两面规则。
- [`MetricMatrix`](metric-matrix.md) / [`Scoreboard`](scoreboard.md) / [`DeltaTable`](delta-table.md) / [`StabilityMatrix`](stability-matrix.md) —— 其它表格与矩阵。
