# `Table`

一切行 × 列形状的唯一渲染面：实验对比、逐题明细、读数榜、成绩单、条件对照与稳定性矩阵
共用这一个原语，差别全在传进去的[数据源](../sources/README.md)。

```tsx
// 默认字段：Source 声明字段集合与列序，Table 负责表头呈现
<Table source={sources.entity.experiments} filter />

// 自选列：写 <Column> 就整体替换默认列，列序即声明序
<Table source={sources.measure.rows({
  dimensions: ["experiment"],
  measures: [passRate, costUSD],
})}>
  <Column dataKey="passRate" />
  <Column dataKey="costUSD" align="right" />
</Table>

// data 形态：接收算好的行，子节点只选择并附加呈现
<Table data={content}>
  <Column dataKey="eval" header="题目" />
</Table>
```

## 形状

```ts
type TableProps<Input extends SourceInput> =
  DataProps<Input, TableContent | Dataset | null> & TablePresentation;

interface TablePresentation {
  /** 至少一个 <Column>；省略时用 Content 的默认列。 */
  children?: ColumnNode | readonly ColumnNode[];
  /** 初始排序的列 key；方向跟随该列的 better，省略时用数据源声明的默认排序。 */
  sort?: string;
  /** web 面加过滤输入框；渐进增强，不改变数据与 text 面。 */
  filter?: boolean;
  attemptHref?: (locator: AttemptLocator) => string;
  locale?: ReportLocale;
  className?: string;
}

interface ColumnProps {
  /** 对应 Row.cells 的键。 */
  dataKey: string;
  /** 省略时取内建字段词典；未命中时显示原始 dataKey。 */
  header?: LocalizedText;
  align?: "left" | "right";
  /** 越高/低越好；决定点击排序的方向。省略时该列不可排序。 */
  better?: "higher" | "lower";
  /** 单元格最多占几行，超出按显示宽度截断。 */
  maxLines?: number;
}
```

`<Column>` 的存在与否是二选一：一个都不写时，`TableContent` 使用自己的 `columns`，`Dataset` 使用
`fields` 的声明顺序；Table 再按「内建字段词典 → 原始 key」生成表头。写了 `<Column>` 就整体替换，
其中 `header` 只覆盖呈现，不成为 Content 的一部分。
没有「在默认列上加一列」这种半覆盖——半覆盖要求作者知道默认列序里该插在哪，
而默认列序会随数据源演进，插入位置无法稳定表达。要在默认基础上增删，
读取 `TableContent.columns` 自己拼，那是普通 JavaScript。

## 单元格渲染

这一节是[单元格类型](../README.md#单元格类型)在两个面的渲染契约，全部原语照抄同一份。
数据源只决定一格是哪个 `kind`，不决定它长什么样。

| `kind` | web 面 | text 面 |
|---|---|---|
| `measure` | renderer 按 `value + format + ctx.locale` 格式化；`samples < total` 时写明覆盖范围；`refs` 单条时值本身是链接，多条时进 tooltip | 同一格式化结果；覆盖缺口写进列脚注，不省略 |
| `verdict` | 单个 verdict 显示状态图标加词；计票各项以中点分隔，不渲染成类似按钮的胶囊 | `✓ passed` / `1 passed · 1 failed` |
| `score` | `earned`；有 `possible` 时写 `earned / possible` 并附同尺度百分比 | 同 web，百分比在括号内 |
| `summary` | 单行，宽度不足按显示宽度截断；`more > 0` 时尾缀 `+N more failures`，计分制为 `+N more lost points` | 同 web |
| `locator` | 链到 `attemptHref`；`staleSinceMs` 存在时后缀 `↩` 加人话时距，hover 显示完整执行时刻 | locator 加 `↩ 3d`，时距直接打 |
| `text` | 主文；`detail` 作为 subdued 副行，省略时不留空行 | 主文换行后缩进打副行 |
| `notApplicable` | `—` | `—` |
| `missing` | 按 `code + data` 映射本地化原因与可复制 action；未知 code 显示结构化 detail | 同一 policy 的 text 投影 |

三条渲染纪律：

- **`—` 只属于 `notApplicable`。** 缺数据走 `measure` 格的 `samples` 缺口或 `missing` 格，
  两者都带得出「为什么没有」。把三种情况都打成 `—`，读者就无法区分不适用、测不了和没跑到。
- **时效标注是 subdued 的行内事实**，不占框、不用警示色。携带是指纹担保下的正常缓存，
  时效是数字的出身属性，不是警告。
- **渲染面不重算。** `summary` 的折叠、`measure` 的聚合、`score` 的求和都在数据源完成；
  渲染面只做宽度截断与格式化。

## 下钻子行

`Row.subRows` 递归，层数由数据源决定。web 面每层用原生 `<details>` 展开，
text 面用 `├─` / `└─` 子行表达一对多关系。

父行不复述某一个子行的内容：单子行时会与唯一子行重复，多子行时挑任一个又会冒充父级事实。
父行只显示折叠后的父级读数与子行数量。

```text
Status      Eval / Attempt       Result                     Duration   Cost
✓ passed    algebra/retry                                   17.1s avg  $0.02 avg
  ✗         ├─ @1first01         equals(42) · received 41   16.0s      $0.02
  ✓         └─ @1second2         —                          18.2s      $0.02
```

## 占位行

`variant: "placeholder"` 的行照常渲染，但**不参与任何列的聚合读数**：通过率、耗时、成本的分母
仍是有 attempt 的行。它的职责是把分母缺口摆进读者正在看的表里，而不是藏进页面级脚注。

占位行的格一律是 `missing` 或 `notApplicable`，没有 `measure` 格——占位行没有样本，
给它一个 `samples: 0` 的读数格等于宣称「测过、测不了」。

## 排序与过滤

表头支持点击排序；标签和排序箭头作为一个不换行的单元对齐，当前排序方向始终可见，
其余列的排序提示只在 hover / focus 时显示。只有声明了 `better` 的列可排序，
不为「更好」方向不明的列猜顺序。同值以行 key 收口，排序是稳定排序。

排序方向跟随列的 `better`；两个主读数列并存时两种读数不能互相排名，
默认改按行 key 字典序，两列仍各自可点击排序。

`filter` 为 web 面增加过滤输入框，按行内可见文本收窄行。排序和过滤只改变浏览状态，
不改变数据、聚合口径或 text 面输出。

## 两面

web 面是带列头的 `<table>`；宽度不足时整表横向滚动，不把标签与箭头拆成两行，
也不为了适应宽度删除列、把多个无标签数值挤成一串，或退化成无法判断各数字含义的无表头布局。

text 面按显示宽度对齐（CJK 与全角记 2 列），身份列有宽度下限、压不到不可读。
窄终端先折行，仍装不下时从右侧隐藏低优先级列并明确报告隐藏列数。自定义表与官方表
共用这同一把尺子。

## 相关阅读

- [组件树](../README.md) —— 四层模型、单元格类型与结构节点规则。
- [数据源目录](../sources/README.md) —— 官方数据源的行形状与默认列。
- [`Grid` / `Stat`](stat-grid.md) —— 同一套单元格类型的读数网格投影。
- [读数与维度](../../library/measures.md) —— `MeasureCell` 与聚合口径。
