# 表格与矩阵

把[读数](../../library/measures.md)投影成表格行、交叉格、成绩单、对照行与稳定性行。数据源负责领域
计算，`Table` 负责呈现；组合规则见[组件树](../README.md)。

```tsx
<Table source={measureRows({
  rows: "agent",
  measures: [endToEndPassRate, costUSD],
  sort: endToEndPassRate,
})} filter />

const content = await measureRows(options).compute(sample);
<Table data={content} filter />
```

这一篇是表格数据源的共用机制。各数据源的选项与用法在各自文件：
[`measureRows`](measure-table.md)、[`measureMatrix`](measure-matrix.md)、[`scoreboard`](scoreboard.md)、
[`deltaRows`](delta-table.md)、[`stabilityRows`](stability-matrix.md)。

## 共用数据形状

数据形状的字段命名只有一条规则：**维度名字段 = 产生它的节点名 + `Dimension` 后缀**（`Rows` → `rowDimension`、`Columns` → `columnDimension`）；条目数组一律叫 `rows`，稀疏格子叫 `cells`。条目内的 `key` 是维度**值**，不带后缀。

```ts
interface TableContent {
  rowDimension: string;
  columns: MeasureColumn[];
  rows: Array<{
    key: string;
    cells: Record<string, MeasureCell>;
  }>;
}

interface MatrixContent {
  rowDimension: string;
  columnDimension: string;
  measure: MeasureColumn;
  /** 稀疏格子：没有 attempt 的组合不生成格子。 */
  cells: Array<{ row: string; column: string; cell: MeasureCell }>;
}
```

## 维度绑定选项

行与列数据源共享同一种维度选项：

```ts
interface DimensionBindingProps {
  dimension: DimensionInput;
  /** 稳定排序的依据；必须是同组件内已声明且有 better 的 Measure。 */
  sort?: Measure;
  /** 只保留排序后的前 N 个维度值；要求同时给出 sort。 */
  limit?: number;
  /** limit 截掉的维度值聚成一行/一列，用这个名字；省略时直接截断。 */
  rest?: LocalizedText;
}
```

`sort` 的方向跟随 Measure 的 `better`，同值以维度 key 收口；省略时按 key 字典序，不为「更好」方向不明的读数猜顺序。`limit` / `rest` 的语义与[图表维度轴的排序与截断](../charts/README.md#排序与截断)逐条相同——`rest` 是在合并后的 keyset 上重新聚合，不是把截掉的几行平均，因此它必须住在计算函数里。行列头的颜色来自[页级色分配](../README.md#系列色分配单位是页)。

`dimension` 传数组即[复合维度](../../library/measures.md#维度与数值轴)：`["agent", label("memory")]` 的一个取值是一行，不是两行。

## 两面

所有表格数据源都交给 [`Table`](../primitives/table.md) 原语。自定义表和官方表用同一把尺子，
列宽按显示宽度计算，身份列压不到不可读。web 面是带列头的 `<table>`，排序与过滤是渐进增强。

## 相关阅读

- [组件树](../README.md) —— 结构节点规则与共用呈现 props。
- [图表](../charts/README.md) —— 同一份读数的图形投影。
- [读数与维度](../../library/measures.md) —— Measure、Dimension 与聚合口径。
- [实体列表](../entity-lists/README.md) —— 从聚合下钻到逐实体事实。
