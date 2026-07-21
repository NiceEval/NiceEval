# Architecture——结构描述子节点与容器解释机制

[README · 设计](README.md#设计)把图表子组件定为「只携带配置、不产出独立渲染的结构描述子节点」。本篇给出技术方案:这类节点在 `ReportNode` 里的类别定义与校验规则、容器怎样在 resolve 阶段解释它们、`MetricComposed` 的数据形状,以及刻意不引入的机制。

## 节点类别:结构描述子节点

[`ReportNode`](../../feature/reports/library/layout.md#树的节点reportnode) 的通用规则是「节点只有一类来源:`defineComponent` 产物或内置原语」,`validate` 确保展开后每个节点都有 text 和 web 两面。结构描述子节点是第三类来源:

- **只携带 props**:它是一段声明,没有自己的 text/web 渲染面,不参与独立取数,通用 resolve 不展开它。
- **宿主白名单**:每类结构描述子节点声明自己的宿主容器集合(`ChartSeries`/`ErrorBar` → `MetricLine`/`MetricBars`/`MetricComposed`;`Tooltip`/`Legend`/`CartesianGrid`/`ReferenceLine`/`ReferenceArea` → 全部图表容器)。`validate` 检查它必须是宿主的**直接子节点**;出现在宿主之外或更深层级,按完整用户反馈报错。
- **先例与差异**:[`Tabs`/`Tab`](../../feature/reports/library/layout.md#tabs) 与 [`Grid`](../../feature/reports/library/layout.md#grid-与-stat) 已经确立「子节点由特定父组件解释」,但 `Tab` 做分组、`Grid` 把子节点当不透明格子,都不读取子节点内部结构。图表容器的解释深一层:要从子节点 props 里读出 `metric`、`by`/`value` 这类取数选项——这是两面校验豁免必须成为显式节点类别、而不是特例约定的原因。

## 容器解释流程

接受子组件的容器在自己的 resolve 阶段依次:

1. **收集**直接子节点里的结构描述节点,按类型分组(series 声明 / 标注 / 呈现开关)。
2. **合并 `ChartSeries` 声明**:`by` 展开维度全域,`value` 按键精确匹配覆盖;算法与报错点定稿于 [Library · ChartSeries](library.md#chartseries)。
3. **组装 options,调计算函数**:`MetricLine`/`MetricBars` 组装出的 options 与扁平 props 写法产出**完全相同**的 `LineData`/`MatrixData`——子组件不改变数据形状,resolve 记忆化照旧;`MetricComposed` 调新增的 `metricComposedData`(形状见下节)。
4. **呈现 props 不进 Data**:`strokeDasharray`、`emphasis`、`label` 这类呈现覆盖不写进 `*Data`(data 保持可序列化、与现状同形),渲染面按 series 键在绘制时应用。

spec / data 双形态与子组件正交,但语义收窄:data 形态下容器不再取数,`ChartSeries` 只允许 `value` 形态、只做呈现覆盖(键按 data 里已有 series 匹配);`by` 携带取数语义(展开维度域),与 `data` 同给按完整用户反馈报错——与 [`DataProps`](../../feature/reports/library/metric-views.md#共用数据形状)「`data` 与 spec 字段互斥」同一条规则。

## `MetricComposed` 的数据形状

```ts
interface ComposedData {
  /** 维度 x 用维度 name 作 key;NumericAxis x 与 LineData.x 同形。 */
  x: { key: string; label: LocalizedText; unit?: string };
  series: Array<{
    key: string;
    as: "line" | "bar" | "area";
    stack?: string;
    metric: MetricColumn;
    yAxis: "left" | "right";
    rows: Array<{ x: string; cell: MetricCell }>;
  }>;
}
```

- 每个 `ChartSeries` 一个条目,`metric` 必填(容器没有共享 `y`);两级聚合口径遵循[指标聚合不变量](../../feature/reports/architecture.md#指标聚合不变量),`MetricCell` 照常携带 `samples`/`refs` 证据。
- **双轴推导**:`yAxis="right"` 把 series 分配到右轴,缺省左轴;每侧轴的单位、刻度格式与 `better` 方向从分配到该侧 series 的 `metric` 推导,同侧多个 series 的单位或 `better` 不一致时计算以完整用户反馈失败——轴不猜混合单位怎么标。
- **堆叠**:`stack` 值相同的 bar series 堆进同一根柱;柱顶总值标签 = 该堆 `MetricCell` 值之和,由渲染面计算,不进 Data。

## 两面投影

结构描述子节点没有自己的渲染面;容器的 text/web 两面消化它们的投影,每个子组件的投影契约写在 [Library](library.md) 各小节(如 `ReferenceLine` 的 text 面在图例区列出、`Tooltip` 的 text 面无投影)。三态定制阶梯的渲染函数只接管 web 面,text 面投影保持默认——两面同源的不变量不因自定义渲染破例。

## 不引入的机制

- **React context**:子组件是数据不是运行时组件,容器读 props 就够了,不需要 recharts 的 context 配对机制。
- **`recharts` 依赖**:两面渲染完全自研,理由见 [README · 评估过、不采纳的路线](README.md#评估过不采纳的路线)。
- **`ResizeObserver` 测量**:响应式继续由 CSS Grid + container query 承担([Architecture · 静态网页](../../feature/reports/architecture.md#静态网页))。

## 相关阅读

- [README](README.md) —— 问题、recharts 模型与设计定案。
- [Library 逐组件说明](library.md) —— 每个容器与子组件的契约、写法与命名判定。
- [排版原语与自定义组件](../../feature/reports/library/layout.md) —— `ReportNode`、`Tabs`/`Grid` 的子节点解释先例。
- [Architecture · 组件模型](../../feature/reports/architecture.md#组件模型解析面与渲染面) —— resolve/validate/render 管线与两面同源的不变量。
