# 图表组件的声明式子组件语法

还没定为当前契约的候选设计,见 [Roadmap 约定](../README.md)。调研来源见 [References · Recharts](../../references.md#recharts)。图表族逐组件的契约与写法见 [Library 逐组件说明](library.md);节点类别与容器解释机制的技术方案见 [Architecture](architecture.md);四张真实报告图的结构对照见 [真实图表对照](gallery.md)。

## 问题

[指标组件](../../feature/reports/library/metric-views.md)里图表形态的成员——`MetricMatrix`/`MetricBars`/`MetricScatter`/`MetricLine`——都是「一个组件、一份扁平 options」:坐标轴、图例、每个点的呈现、连线规则,全部是同一个组件上并列的 props 字段。这个形状有两处随图表能力增长而变差的地方:

- **新增一种呈现细节 = 给已有组件继续加字段。** 要给 `MetricLine` 的某个 series 单独换线型,或在趋势图上加一条目标参考线,只能在同一个 options interface 里继续开洞(`seriesOverrides?: Record<string, {...}>`、`referenceLines?: Array<...>`)——props 表没有天然分区承载局部定制,而且 `Record<string, ...>` 形态要求 series 取值在声明时已知,与「`series` 从数据里发现取值域」的模型冲突。
- **同一张图没法混合两种呈现。** `MetricMatrix` 与 `MetricBars` 消费同一份 `MatrixData`,但二者是两个组件、渲染各自整张图;没有"同一张图里一部分 series 画成柱、一部分画成线"的组合方式——[`ExperimentComparison`](../../feature/reports/library/summaries.md#experimentcomparison) 展示的组合方式是把多个独立组件按 `Col` 摞起来,是多张图并列,不是同一张图内部的组合。

recharts 用"容器 + 声明式子组件"解决了同一类问题:图表家族里新增一种坐标轴、一种 series 类型、一种参考线,都是加一个子组件类型,不是给已有容器组件继续加字段;`ComposedChart` 允许 `Area`/`Bar`/`Line` 三种 series 组件混进同一个容器。

## 从 recharts 学到的模型

完整调研记录在 [References · Recharts](../../references.md#recharts),这里只重复与本设计直接相关的形状:

```tsx
<LineChart data={data} responsive>
  <CartesianGrid />
  <XAxis dataKey="name" />
  <YAxis />
  <Tooltip />
  <Legend />
  <Line dataKey="uv" stroke="var(--color-chart-1)" dot={{ fill: "..." }} />
  <Line dataKey="pv" stroke="var(--color-chart-2)" />
</LineChart>
```

- 容器(`LineChart`/`BarChart`/`ComposedChart`/…)只认领固定几个概念:数据源(`data`,一份对象数组)、尺寸与 margin。
- 子组件是声明式配置:坐标轴、网格、图例、tooltip 各是独立组件;每个 series 组件(`Line`/`Bar`/`Area`/`Scatter`)用 `dataKey` 从容器共享的 `data` 里取自己的字段。子组件之间不要求特定顺序。
- 同一个容器可以并列多种 series 组件类型(`ComposedChart` 里 `Area`+`Bar`+`Line`),新增一种呈现是加一个子组件类型,不改动容器或其它 series 组件。
- 定制阶梯是同一个类型公式贯穿多个定制点:`false`(关)→ `{ 部分属性对象 }`(轻量覆盖)→ `ReactNode | Function`(整体接管),如 `Line` 的 `dot`/`activeDot`/`label`/`shape`、`Tooltip` 的 `content`。

## 设计

图表族容器接受声明式子组件。子组件是只携带配置、不产出独立渲染的**结构描述子节点**,由声明它的容器在 resolve 阶段解释,组装成选项后调用 `*Data` 计算函数;两面渲染完全自研,不引入 `recharts` 依赖。范围与组成:

- **接受子组件的容器**:`MetricLine`、`MetricBars`(并获得省略 `columns` 的单维排行形态与 `sort`)、新增的 `MetricComposed`(唯一的多 series 类型混合容器)。无子组件时全部容器保持现状写法——子组件是可选扩展,不是替代。
- **子组件全家**:`ChartSeries`(series 声明,`by` 自动展开 / `value` 字面量双形态)、`Tooltip`、`Legend`、`CartesianGrid`、`ReferenceLine`、`ReferenceArea`、`ErrorBar`。逐组件契约、相对 recharts 的命名判定与两面投影见 [Library 逐组件说明](library.md)。
- **不子组件化的组件**:`MetricScatter`、`MetricMatrix` 概念数量固定,扁平 props 是更短的表达;`MetricTable`/`DeltaTable`/`Scoreboard` 是表类,不属图表族。判定见 [Library · 容器总览](library.md#容器总览),真实图上的验证见 [真实图表对照 · 图 4](gallery.md#图-4成本-质量前沿散点)。
- **呈现定制公式**:关键呈现点(`dot`、逐点 `label`、`Tooltip.content` 等)沿用 recharts 的三态阶梯 `false | { 部分属性 } | 渲染函数`;渲染函数只接管 web 面,text 面投影保持默认,两面同源不因自定义渲染破例。
- **架构代价**:`ReportNode` 需要新增「结构描述子节点」类别——无 text/web 面、豁免通用两面校验、只接受宿主容器解释。这是设计中最大的一处架构变化,节点类别、校验规则、容器解释流程与 `MetricComposed` 的数据形状见 [Architecture](architecture.md)。

## 评估过、不采纳的路线

- **把 recharts 用作 web 面的构建期 SVG 生成器**(书写语法不变,`web()` 内部 `renderToStaticMarkup` 生成静态 SVG):静态 SVG 字符串里没有 React 运行时,recharts 的 `Tooltip` 与全部交互层不工作,悬停增强仍要自研;`Legend` 布局依赖 DOM 测量,无浏览器环境下不可靠;能省下的只有坐标刻度与曲线插值,抵不过引入整包运行时依赖。`ResponsiveContainer` 的 `ResizeObserver` 测量已在 [References · Recharts](../../references.md#recharts) 单独记为不采纳。
- **只加三态定制阶梯、不引入子组件语法**:改动最小,但解决不了「同一张图混合多种呈现」与「逐 series 覆盖」——[真实图表对照](gallery.md)与 [Library](library.md) 各节展示的真实报告形态里,这两类是必须能力,不是锦上添花。阶梯本身作为呈现定制公式并入设计(见上一节),不构成独立路线。

## 相关阅读

- [Library 逐组件说明](library.md) —— 图表族每个容器与子组件的契约、写法与命名判定。
- [Architecture](architecture.md) —— 结构描述子节点的节点类别、校验规则与容器解释机制。
- [真实图表对照](gallery.md) —— 四张真实报告图逐张拆结构、给写法,并列出设计上不支持的功能。
- [References · Recharts](../../references.md#recharts) —— 调研原始记录:是什么、值得抄什么、不抄什么及理由。
- [指标组件](../../feature/reports/library/metric-views.md) —— 现有图表组件的扁平 props 契约。
- [排版原语与自定义组件](../../feature/reports/library/layout.md) —— `ReportNode`、`Grid`/`Tabs` 的子节点解释先例、`defineComponent` 两种形态。
- [Architecture · 组件模型](../../feature/reports/architecture.md#组件模型解析面与渲染面) —— resolve/validate/render 管线与两面同源的不变量。
