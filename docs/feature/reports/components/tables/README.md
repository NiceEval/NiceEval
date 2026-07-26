# 表格与矩阵

把 [指标](../../library/metrics.md) 投影成指标表、格子、成绩单、对照表与稳定性矩阵。每个组件的数据绑定住在结构子节点里，呈现选项是 props；组合规则见[组件树](../README.md)。

```tsx
// spec 形态：结构子节点携带绑定，input 省略时取宿主注入的 Sample
<MetricTable filter>
  <Rows dimension="agent" sort={endToEndPassRate} />
  <Column metric={endToEndPassRate} />
  <Column metric={costUSD} />
</MetricTable>

// data 形态：接收配套 *Data 函数算好的数据，子节点只按 key 选择并附加呈现
<MetricTable data={await metricTableData(sample, options)} filter>
  <Column dataKey="cost-usd" name="每题成本" />
</MetricTable>
```

这一篇是表格族的共用机制：数据形状命名规则与维度绑定节点。每个组件的专属 props 与用法在各自的文件里：[`MetricTable`](metric-table.md)、[`MetricMatrix`](metric-matrix.md)、[`Scoreboard`](scoreboard.md)、[`DeltaTable`](delta-table.md)、[`StabilityMatrix`](stability-matrix.md)。

## 共用数据形状

数据形状的字段命名只有一条规则：**维度名字段 = 产生它的节点名 + `Dimension` 后缀**（`Rows` → `rowDimension`、`Columns` → `columnDimension`）；条目数组一律叫 `rows`，稀疏格子叫 `cells`。条目内的 `key` 是维度**值**，不带后缀。

```ts
interface TableData {
  rowDimension: string;
  columns: MetricColumn[];
  rows: Array<{
    key: string;
    cells: Record<string, MetricCell>;
  }>;
}

interface MatrixData {
  rowDimension: string;
  columnDimension: string;
  metric: MetricColumn;
  /** 稀疏格子：没有 attempt 的组合不生成格子。 */
  cells: Array<{ row: string; column: string; cell: MetricCell }>;
}
```

## 维度绑定节点

`Rows` 与 `Columns` 是表格族的维度绑定节点，形状相同、由父组件决定哪个可用：

```ts
interface DimensionBindingProps {
  dimension: DimensionInput;
  /** 稳定排序的依据；必须是同组件内已声明且有 better 的 Metric。 */
  sort?: Metric;
  /** 只保留排序后的前 N 个维度值；要求同时给出 sort。 */
  limit?: number;
  /** limit 截掉的维度值聚成一行/一列，用这个名字；省略时直接截断。 */
  rest?: LocalizedText;
}
```

`sort` 的方向跟随 Metric 的 `better`，同值以维度 key 收口；省略时按 key 字典序，不为「更好」方向不明的指标猜顺序。`limit` / `rest` 的语义与[图表维度轴的排序与截断](../charts/README.md#排序与截断)逐条相同——`rest` 是在合并后的 keyset 上重新聚合，不是把截掉的几行平均，因此它必须住在计算函数里。行列头的颜色来自[页级色分配](../README.md#系列色分配单位是页)。

`dimension` 传数组即[复合维度](../../library/metrics.md#维度与数值轴)：`["agent", label("memory")]` 的一个取值是一行，不是两行。

## 两面

`MetricTable`、`MetricMatrix`、`Scoreboard` 与 `DeltaTable` 的 text 面建在 [`Table`](../../library/layout.md#table) 原语上：自定义表和官方表用同一把尺子，列宽按显示宽度计算，身份列压不到不可读。web 面是带列头的 `<table>`，排序与过滤是渐进增强。

## 相关阅读

- [组件树](../README.md) —— 结构节点规则与共用呈现 props。
- [图表](../charts/README.md) —— 同一份指标的图形投影。
- [指标与维度](../../library/metrics.md) —— Metric、Dimension 与聚合口径。
- [实体列表](../entity-lists/README.md) —— 从聚合下钻到逐实体事实。
