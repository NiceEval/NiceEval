# Library 逐组件说明——图表族每个组件的契约与写法

按组件遍历图表族:哪些容器接受子组件、每个子组件的 props、相对 recharts 的命名判定与两面投影,并给出写法示例。节点类别与容器解释机制见 [Architecture](architecture.md);真实报告图的结构对照见 [真实图表对照](gallery.md);现状组件的完整 props 契约见 [指标组件](../../feature/reports/library/metric-views.md)。

四件事 recharts 没有对应物、由 niceeval 既有契约自带,本页不逐组件重复:

- **Metric 绑定与两级聚合**:series 永远绑定 `Metric` 实例(聚合口径、`better` 方向、单位),聚合值携带 `samples`/`refs` 证据——recharts 的每个数值只是原始对象数组里的一个字段。
- **spec / data 双形态**:[`DataProps`](../../feature/reports/library/metric-views.md#共用数据形状) 照常适用;data 形态与子组件的交互规则见 [Architecture · 容器解释流程](architecture.md#容器解释流程)。
- **text 面**:每个组件两面同源;子组件的 text 投影写在各自小节。
- **`evals` 前缀过滤与 `attemptHref`/`pointHref` 下钻**:照常适用于全部图表容器。

## 容器总览

| 容器 | 子组件化 | 判定 |
|---|---|---|
| `MetricLine` | 接受 | series 随维度取值域增长,逐 series 覆盖与标注需要可插拔子节点 |
| `MetricBars` | 接受 | 同上;另有省略 `columns` 的单维排行形态 |
| `MetricComposed` | 接受(新容器) | 多 series 类型混合是它唯一的存在理由;对应 recharts `ComposedChart` |
| `MetricScatter` | 不子组件化 | 概念数量固定(点、series、x、y),扁平 props 是更短的表达 |
| `MetricMatrix` | 不子组件化 | 格子呈现没有可插拔的 series/标注概念 |
| `MetricTable` / `DeltaTable` / `Scoreboard` | 不子组件化 | 表类组件,不属图表族 |

`MetricLine`/`MetricBars` 沿用现状名而不采用 recharts 的 `LineChart`/`BarChart`:这两个名字是 niceeval 已导出的定稿概念,子组件只扩展它们的组合能力,不打散已有心智;`MetricComposed` 是唯一的新容器名。无子组件时全部容器保持现状写法不变——子组件是可选扩展,不是替代。

## `MetricLine`

保留 `x` / `series` / `y` 容器 props;`y` 是容器级共享指标,`ChartSeries` 在它下面不收 `metric`。单 series、无定制的趋势图仍用扁平 props,一行是最短表达,子组件在这里不带来任何新能力:

```tsx
<MetricLine x={budget} series="agent" y={endToEndPassRate} />
```

逐 series 单独定制视觉时,series 以子节点声明、各自携带专属呈现——`series` prop 只是分组维度,`LineData` 不携带按 series 区分的呈现字段,这个组合只有子组件形态能表达:

```tsx
<MetricLine x={budget} y={endToEndPassRate}>
  <ChartSeries value="compare/baseline" label="baseline" />
  <ChartSeries value="compare/with-memory" label="+memory" strokeDasharray="4 2" />
</MetricLine>
```

追加标注是加子组件类型,不在容器 options 里开洞:

```tsx
<MetricLine x={budget} y={endToEndPassRate}>
  <ChartSeries by="agent" />
  <ReferenceLine y={0.8} label="目标" />
</MetricLine>
```

## `MetricBars`

两种数据形态,子组件规则与 `MetricLine` 相同(`cell` 是容器级指标):

- **矩阵形态**:`rows` × `columns` 二维,消费 `MatrixData`,与现状一致。
- **排行形态**:省略 `columns`,一个维度值一根条,条的维度即 series 维度;`sort` 沿用 [`MetricTable.sort`](../../feature/reports/library/metric-views.md#metrictable) 语义——必须是声明了 `better` 的同一个 Metric 实例,方向由 `better` 决定,省略时按行 key 字典序;条尾数值标签是默认呈现,text 面本来就以数字呈现,web 面同源。recharts 没有排序概念(作者自备排好序的 `data` 数组);niceeval 的条形数据产自聚合管线,作者手里没有中间数组,排序必须是组件选项。

排行 + 置信区间([真实图表对照 · 图 1](gallery.md#图-1单指标排行条形与置信区间)):

```tsx
<MetricBars rows="agent" cell={endToEndPassRate} sort={endToEndPassRate}>
  <ErrorBar />
</MetricBars>
```

![按单一指标排行的横向条形图,每条带置信区间须线与行尾数值](assets/pass-at-1-ranked-bars.png)

多面板拼排用 `Grid` + JSX 遍历。niceeval 不设 facet 容器:报告是 TSX,「一次声明展开成面板」就是一次普通的数组 map,框架再包一层只是复述语言已有的能力。跨面板的集中共享图例同样不设——每块面板自带图例,「同一 series 跨面板同色」由配色的稳定散列契约(同键跨图同色,见[指标组件 · MetricScatter](../../feature/reports/library/metric-views.md#metricscatter))承担,一致性不依赖共享图例:

```tsx
<Grid columns={4}>
  {["terminal-bench/", "swe-verified/", "swe-pro/", "swe-multilingual/"].map((prefix) => (
    <MetricBars key={prefix} evals={prefix} rows="agent" cell={examScore}>
      <ChartSeries by="agent" />
      <ChartSeries value="ornith-9b" emphasis />
    </MetricBars>
  ))}
</Grid>
```

![八个题集各一块条形小面板,同一组模型,其中一个模型全程强调](assets/per-eval-bar-panels.jpg)

`by` 兜底展开全部取值、`value` 显式强调一个,按 [`ChartSeries` 合并规则](#chartseries)生效。

## `MetricComposed`

唯一的多 series 类型混合容器,对应 recharts 的 `ComposedChart`。没有容器级 `y`——混合的意义就是每个 series 指标可能不同,`metric` 是每个 `ChartSeries` 的必填项。混合类型限 `as="line" | "bar" | "area"`:散点不进混合画布——离散点云的逐点证据语义(`pointHref` 下钻)与聚合 series 在同一坐标系互相混淆,散点的领地是 `MetricScatter`。

柱线混合,共享一条维度轴:

```tsx
<MetricComposed x="agent">
  <ChartSeries as="bar" metric={costUSD} />
  <ChartSeries as="line" metric={endToEndPassRate} yAxis="right" />
</MetricComposed>
```

`yAxis="right"` 把 series 分配到右轴;每侧轴的单位、刻度与 `better` 方向从分配到该侧 series 的 `metric` 推导,同侧单位或 `better` 不一致按完整用户反馈报错(数据形状与推导细则见 [Architecture](architecture.md#metriccomposed-的数据形状))。

堆叠:`stack` 同值的 series 堆进同一根柱,柱顶默认显示堆叠和标签——它是堆叠呈现的组成部分,不是独立组件([真实图表对照 · 图 3](gallery.md#图-3成本构成堆叠条形)):

```tsx
// plannerCostUSD / workerCostUSD 是作者自定义的成本构成指标
<MetricComposed x="experiment">
  <ChartSeries as="bar" metric={plannerCostUSD} stack="cost" />
  <ChartSeries as="bar" metric={workerCostUSD} stack="cost" />
</MetricComposed>
```

![每个模型组合一根柱,柱内按 Planner/Worker 成本构成堆叠,柱顶显示总成本](assets/stacked-cost-bars.webp)

图题与脚注属排版层(`Col` + 文本节点),不进图表契约。

## `MetricScatter`——不子组件化

概念数量固定:点维度、series、x、y;x/y 对全部点共享,不存在「每个 series 各自不同指标」或「逐 series 覆盖呈现」的组合空间,扁平 props 保持现状。真实报告里最复杂的散点形态一行就能写([真实图表对照 · 图 4](gallery.md#图-4成本-质量前沿散点)):

```tsx
<MetricScatter points="experiment" series="agent" connect x={costUSD} y={endToEndPassRate} />
```

![各模型的成本-质量前沿:series 内沿成本轴连线,成本轴反向(便宜在右),单点与多点 series 混排](assets/cost-quality-frontier.png)

`connect` 连线、`better: "lower"` 的成本轴反向、单点与多点 series 混排、点级直接标签都是现状契约。「series 名标注在线端以替代图例」设计上不支持:图例契约两面同源、顺序确定,点级直接标签已承担就近识别,线端标注是重复的识别通道。

## `MetricMatrix`——不子组件化

格子热图没有可插拔的 series、轴或标注概念;「矩阵里一部分行画成柱、一部分画成线」不是矩阵的变体,是 `MetricComposed` 的场景。

## 子组件

子组件是结构描述节点:只携带配置、没有独立渲染面,校验与解释机制见 [Architecture](architecture.md#节点类别结构描述子节点)。命名判定:

- **原样借用**:`Tooltip`、`Legend`、`CartesianGrid`、`ReferenceLine`、`ReferenceArea` 与 recharts 同名——它们是纯呈现,不绑定 Metric/Dimension 语义,recharts 的名字就是准确的名字;都不与 niceeval 现有导出撞名,从属关系靠容器的结构校验表达(`Tab` 只能在 `Tabs` 下同理),不用命名前缀。
- **`ChartSeries`**:合并 recharts `Line`/`Bar`/`Area`/`Scatter` 四个 series 组件后的新名。四个组件的真正差异只在「怎么画」不在「怎么取数」(取数永远是绑定一个 `Metric`),拆四个名字会让「新增一种画法」等价于「照抄一个新组件」;不叫 `Series` 是因为这个词过泛、与无处不在的 `series` prop 撞读——`Chart` 前缀收窄名词,不表达从属(它出现在三个容器下)。
- **`ErrorBar`**:与 recharts 同名、取数改造,见下文小节。
- **不设的子组件**:`XAxis`/`YAxis`——recharts 需要独立轴组件是因为它的 `data` 只是裸数组,tick 格式、label、domain 全靠组件 props;niceeval 的 `Metric`/`NumericAxis` 对象自带这些字段,再包一层 JSX 是纯重复。`ResponsiveContainer`——响应式由 CSS 承担,`ResizeObserver` 首帧尺寸不定与「静态 HTML 先完整可读」不变量冲突([References · Recharts](../../references.md#recharts))。

### `ChartSeries`

一个 series 的声明。两种互斥形态,呼应 [`DeltaTable.pairs`](../../feature/reports/library/metric-views.md#deltatable) 字面数组与 `pairsByFlag()` 派生声明并存的先例:

```tsx
// by:按维度展开取值域,每个值各成一个 series,呈现取默认
<ChartSeries by="agent" />

// value:字面量声明单个已知 series,携带专属呈现
<ChartSeries value="compare/with-memory" label="+memory" strokeDasharray="4 2" />
```

**合并规则**(`by` 与 `value` 同容器混用):`by` 展开维度全域;每个 `value` 按键精确匹配域中的一个取值,把自己的呈现 props 与 `label` 覆盖到该 series 上——匹配到的取值仍是同一个 series,不重复出现。`value` 的键不在展开域中,或同一键出现多个 `value` 声明,计算以完整用户反馈失败;精确匹配、不做前缀或模糊匹配,与 `DeltaTable` 字面 `a`/`b` 的匹配规则同一先例。无 `by` 时,若干 `value` 就是字面量声明的完整 series 集合。

**props**:

- `metric: Metric` —— `MetricComposed` 下必填(没有容器级共享指标);`MetricLine`/`MetricBars` 有容器级 `y`/`cell`,不收。
- `as: "line" | "bar" | "area"` —— 呈现类型,仅 `MetricComposed` 下有意义(单一类型容器由容器决定画法)。呈现 props 按 `as` 判别收窄(TS 判别联合):`strokeDasharray` 只属 line,`stack` 只属 bar,填充只属 area,不同呈现的专属参数不互相渗漏;单一类型容器下的 props 集即该容器画法的呈现集。
- `stack?: string` —— 同容器内同值的 bar series 堆进同一根柱,不同值各成堆;recharts `stackId` 的对应物。
- `emphasis?: boolean` —— 强调呈现,具体样式由主题决定。
- `label?: LocalizedText` —— 图例显示名,缺省用维度值显示键。
- `dot` / 逐点 `label` 等关键呈现点 —— 三态定制阶梯 `false | { 部分属性 } | 渲染函数`;渲染函数收到该 series 已解析的单点数据,只接管 web 面,text 投影保持默认。

### `Tooltip`

web 渐进增强层的悬停提示,默认内容是该点的轴值与证据引用;`content` 走三态阶梯。text 面无投影——悬停不存在于终端。

### `Legend`

控制图例显隐(默认显示);图例内容、顺序与两面投影沿用现状契约(series 按显示键字典序),子组件不改变它们。

### `CartesianGrid`

web 面背景网格线;text 面无投影。

### `ReferenceLine` / `ReferenceArea`

参考线 / 参考区间标注:`x` 或 `y` 给出位置(区间给两端),`label` 可选。web 面画进坐标系;text 面在图例区以「label = 值」一行列出,不进字符坐标图。

### `ErrorBar`

误差线。容器的直接子节点,对图内全部 series 生效。与 recharts 同名但不收 `dataKey`:recharts 不知道数据从哪来,误差值只能作者自备;niceeval 的聚合值天然携带 attempt 级样本证据(`samples`/`refs`),让作者手工再算置信区间等于把管线已有的信息复写进报告。作者只选统计口径:`kind="ci95"`(默认)或 `"stderr"`。web 面画须线;text 面在数值后追加 `±` 区间。

## 收益边界

子组件语法的收益集中在两类真实能力,不是全面替代:

- **逐值覆盖**(`value` 形态携带专属呈现)与**多类型混合**(`MetricComposed`)——扁平 props 表达不了的组合。
- **追加标注**(`ReferenceLine`/`ErrorBar` 等)——把「容器 options 持续开洞」换成「新增子组件类型」,收的是长期维护成本。

概念数量固定的组件(`MetricScatter`、`MetricMatrix`、表类)不子组件化;单 series、无定制的图,扁平 props 一行仍是最短表达。

## 相关阅读

- [README](README.md) —— 问题、recharts 模型与设计定案。
- [Architecture](architecture.md) —— 结构描述子节点与容器解释机制。
- [真实图表对照](gallery.md) —— 本页契约在四张真实报告图上的检验。
- [指标组件](../../feature/reports/library/metric-views.md) —— 现状组件的完整 props 契约与数据形状。
- [概览组件](../../feature/reports/library/summaries.md) —— `ExperimentComparison` 的多图并列组合方式。
