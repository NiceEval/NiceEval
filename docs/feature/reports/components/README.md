# 组件树：报告组件的组合模型

报告里的每个组件都是一棵树：组件自己是根，它的数据绑定与局部配置是它的**结构子节点**。这一目录是全部 report 组件的定义面——图表、表格、实体列表、概览、attempt 详情与站点组件都按同一套所有权规则声明，[排版原语](../library/layout.md)承载它们之间的组织关系。

| 想回答的问题 | 组件族 |
|---|---|
| 画一张折线、柱状、面积、散点或混合图 | [图表](charts.md) |
| 谁整体更好、哪道题在哪个配置上失败、固定题集得几分、A 与 B 差多少、哪些题历史上不稳 | [表格与矩阵](tables.md) |
| 每个 experiment / eval / attempt 发生了什么、现在有哪些失败要处理 | [实体列表](entity-lists.md) |
| 这批数据有多大、整体是否健康、默认首页怎么装配 | [概览](summaries.md) |
| 一次 attempt 的判定、源码、对话、时间树与 diff | [Attempt 详情](attempt-detail.md) |
| 站点标题、选择警告、快照诊断、批量修复 prompt、trace 瀑布 | [站点组件](site.md) |
| 四张真实报告图在本模型下怎么写 | [Gallery](gallery.md) |

## 结构节点

结构节点是只携带 props、没有独立渲染面的 JSX 节点，由**最近的合法拥有者**解释。它不是 [`ReportNode`](../library/layout.md#树的节点reportnode)：它不进入「每个节点必须有 text 和 web 两面」的资格校验，也不能脱离宿主组件单独出现在报告树里。

```text
组件
├── 绑定节点        声明这个组件从哪取数（轴、行、列、格、条件、题目）
│   └── 局部节点    只作用于父绑定的配置（标签、误差、单项覆盖）
└── 呈现节点        属于组件整体的呈现件（网格、图例、tooltip、参考标注）
```

结构节点位置接受与 [`ReportNode`](../library/layout.md#树的节点reportnode) 相同的展平规则：数组与 Fragment 按声明顺序展平，`null` / `undefined` / `false` 是空分支。所以 `{ids.map((id) => <Question key={id} id={id} />)}` 与 `{showCost && <Column metric={costUSD} />}` 都直接可用，一组列或一组题不需要另一套批量语法。展平在校验父子关系之前完成——数组不构成一层父级。

每类结构节点显式声明**合法直接父组件集合**。同名节点在不同父组件下的绑定字段由父组件决定——`<XAxis>` 在图表下按 `dimension` / `numeric` / `metric` 三选一绑定，`<Column>` 在 `MetricTable` 下绑 Metric、在 [`Table`](../library/layout.md#table) 下绑已格式化的列 key。节点放错层级时按完整用户反馈失败，错误同时给出收到的父类型、允许的父类型和可复制的正确嵌套示例。

### 什么成为结构子节点

三条判据，命中任一条就是子节点，都不命中就是 props：

1. **同型条目的列表**——组件要收 N 个同型声明（多根轴、多条 series、多列、多个条件、多道题、多个分科）。列表用子节点表达，不用数组 prop：每个条目因此有自己的位置挂局部配置。
2. **局部作用域的配置**——只作用于某个子部分的设置（某条 series 的误差线、某个格子的强调、某根轴的标签）。它挂在所属节点下，不做成容器上的 `Record<string, ...>` 侧表：侧表要靠键字符串对齐，读的人必须在两处之间跳着看才知道谁配了谁。
3. **可变的嵌套关系**——条目自己还要分组（分科包着题目）。

留在 props 的是：整组件唯一的标量口径（`evals`、`fullMarks`、`votes`、`limit`）、呈现开关（`filter`、`locale`、`className`、`attemptHref`），以及**契约固定、没有选择余地的部分**。不为只有一种合法值的绑定摆一个节点——[`StabilityMatrix`](tables.md#stabilitymatrix) 的行恒为 eval，所以它只有 `<Columns>`，没有 `<Rows>`。

### 组合组件不收结构子节点

[`ExperimentComparison`](summaries.md#experimentcomparison) 与 [`AttemptDetail`](attempt-detail.md#attemptdetail) 这类组合组件的全部价值就是那份默认装配。它们不接受子节点覆盖排列——覆盖的方式是不用它，直接把公开区块写进 `Col`；两篇文档各自给出等价全文，照抄即可逐块增删。这样「这个组件会渲染什么」永远只有一个答案，不存在「给了子节点走一套、不给走另一套」的两份语义。

## 数据绑定与两种形态

数据来源二选一，以 `data` 字段判别；两种形态下结构子节点都在，区别只是子节点还带不带数据绑定字段：

```ts
type ComponentProps<Data, Presentation> =
  | ({ data: Data; input?: never; evals?: never } & Presentation)
  | ({ input?: ReportInput; evals?: string | readonly string[]; data?: never } & Presentation);
```

- **spec 形态**：结构子节点携带 Metric、Dimension、NumericAxis 等绑定；`input` 省略时取宿主注入的 Scope。管线在 resolve 阶段代调同名 `*Data` 计算函数，与「先手工调 `*Data` 再传 `data`」严格等价。
- **data 形态**：`data` 是配套 `*Data` 函数算好的可序列化数据，组件不再取数。此时结构子节点只按身份键（`dataKey`、列 key、条件值）选择已算好的部分并附加呈现，禁止再出现数据绑定字段。
- 同一组件同时给出 `data` 与绑定字段时按完整用户反馈报错，不静默取一边。

`niceeval/report` 导出组件与配套 `*Data`；`niceeval/report/react` 只导出纯 web 渲染面，那里的同名组件只有 data 形态。完整模型见 [Architecture · 组件模型](../architecture.md#组件模型解析面与渲染面)。

`evals` 是数据组件唯一的数据过滤选项：eval id 前缀，与 CLI 位置参数同语义，在聚合**之前**收窄题集——聚合发生在计算函数内部，事后 JavaScript 无法从聚合值还原题级过滤，所以它必须是选项。逐实体成行的[实体列表](entity-lists.md)不设它：列表数据的聚合边界就是单实体，取数后用普通 JavaScript 过滤与任何选项严格等价。

## 子节点资格总表

这张表是「哪个组件收哪些结构子节点」的单点声明。不收子节点的组件同样在表里给出理由——「没有子节点」是契约，不是遗漏。

| 组件 | 结构子节点 | 为什么 |
|---|---|---|
| [`LineChart` / `BarChart` / `AreaChart` / `ScatterChart` / `ComposedChart`](charts.md#容器) | `XAxis` / `YAxis` / `Line` / `Bar` / `Area` / `Scatter` / `CartesianGrid` / `Tooltip` / `Legend` / `ReferenceLine` / `ReferenceArea` / `ReferenceDot` | 轴与 series 数量可变，且每条 series 要独立选轴、堆叠与误差呈现 |
| [`Line` / `Bar` / `Area` / `Scatter`](charts.md#series) | `ErrorBar` / `LabelList` / `Cell` | 作用域恰是这条 series 或它的某个图形项 |
| [`XAxis` / `YAxis` / `Reference*`](charts.md#嵌套节点) | `Label` | 标签属于该节点自己 |
| [`MetricTable`](tables.md#metrictable) | `Rows` / `Column` | 列是同型条目列表，逐列要各自的排序与格式 |
| [`MetricMatrix`](tables.md#metricmatrix) | `Rows` / `Columns` / `Cells` | 行、列、格是三个独立绑定 |
| [`Scoreboard`](tables.md#scoreboard) | `Rows` / `Subject` / `Question` | 固定题集与分科是可嵌套的同型条目；权重挂在条目上 |
| [`DeltaTable`](tables.md#deltatable) | `Columns` → `Condition` / `FlagConditions` | 条件是列维度上的有序同型取值，基准是其中一个；行恒为 eval |
| [`StabilityMatrix`](tables.md#stabilitymatrix) | `Columns` | 行恒为 eval，没有选择；不摆只有一种合法值的节点 |
| [`ExperimentList` / `EvalList` / `AttemptList`](entity-lists.md) | 无 | 列是下钻契约不是配置面（见[为什么实体列表不开放列](entity-lists.md#为什么实体列表不开放列)）；要自选列用 `MetricTable` |
| [`FailureList`](entity-lists.md#failurelist) | 无 | 成品组合件，等价于取数 → 过滤 → `AttemptList` |
| [`ScopeSummary`](summaries.md#scopesummary) | 无 | 字段集由 Scope 的题型构成决定，不由作者挑 |
| [`ExperimentComparison`](summaries.md#experimentcomparison) | 无 | 组合组件；覆盖方式是不用它 |
| [`AttemptDetail`](attempt-detail.md#attemptdetail) / [`AttemptAssessment`](attempt-detail.md#attemptassessment) | 无 | 同上；区块重排直接写进 page 的 `content` |
| [Attempt 详情各区块](attempt-detail.md#公开区块集) | 无 | 每个区块是一份事实的完整投影，取舍在放不放它 |
| [`Hero` / `PoweredBy` / `ScopeWarnings` / `SnapshotDiagnostics` / `CopyFixPrompt` / `TraceWaterfall`](site.md) | 无 | 聚合轴、折叠层级与品牌行是契约，不设开关 |
| [`Tabs`](../library/layout.md#tabs) | `Tab` | 并列视图数量可变 |
| [`Table`](../library/layout.md#table) | `Column` | 列是同型条目列表；行是数据，仍为 `rows` prop |
| [`Grid` / `Row` / `Col` / `Section`](../library/layout.md#排版原语) | 无（children 是普通 `ReportNode`） | 排版原语组织的是节点，不是绑定 |

## 共用呈现 props

所有数据组件共享同一组呈现 props，各篇不逐个重复：

| Prop | 作用 |
|---|---|
| `attemptHref?: (locator: AttemptLocator) => string` | 证据引用的链接目标。当前报告声明了 [attempt-input page](attempt-detail.md) 时宿主自动注入；自有 React 页面显式传入。没有链接目标时 locator 两面都只渲染成文本，宿主不追加隐藏 fallback |
| `locale?: ReportLocale` | 组件自带文案的语言；省略时随宿主 |
| `className?: string` | 挂在组件根元素上的 web 类名 |
| `filter?: boolean` | 只给 web 面增加过滤输入框的渐进增强；不改变数据与 text 面。只有声明了它的组件才有这个开关 |

证据下钻只有 `attemptHref` 一个入口：图上的点、表里的格、列表的行都把自己的 `MetricCell.refs` 逐个交给它，不为「一个点对应多个 attempt」另发明一个收整行的回调。单个 ref 时渲染成直接链接，多个 ref 时进 tooltip / 展开区逐条列出。

数组顺序只有两类：作者显式写下的结构子节点保留声明顺序；从数据发现的维度 domain 按稳定 key 字典序。组件级排序是稳定排序，同值时仍以 key 收口。这个规则适用于 text、web 和写出的 JSON，不让文件扫描顺序渗进报告。

## 系列色：分配单位是页

同一个维度值在一页里恒定一个颜色。读者在同一页上先看图例、再看表格里的同名键，两处颜色必须是同一个——所以颜色的分配单位不是组件，是**页**。

- **色只按 `(维度, 维度值)` 分配**，不按组件、不按显示名。[`ExperimentList`](entity-lists.md#experimentlist) 的行标签缩成最短唯一后缀不影响颜色：键仍是完整值。
- **分配在 resolve 之后、render 之前一次完成**：收集这一页已解析数据里出现的全部 `(维度, 值)` 对，得到每个维度的页内 keyset；以稳定散列为起点，同一 keyset 内撞色时按显示键字典序线性探测下一个空色格，keyset 超过色板容量才复用。它是确定的纯函数，不改变任何 `*Data`，不进入序列化数据。
- **页内全部消费者读同一份映射**：图表 series 与图例、实体列表里的 agent 键、矩阵的行列头，同一个键在这一页恒同色。
- **跨页与跨报告让位给页内可辨**：稳定散列保证 keyset 不冲突时跨页同色；发生冲突时以页内可辨为准。读者跨页比较靠的是标签，页内比较靠的才是颜色。
- text 面不消费颜色映射，无 ANSI 时输出仍自足。

## 双面投影边界

数据、聚合口径、排序、轴值域与证据在 text / web 两面同源；默认呈现也有明确的两面投影——web 的 tooltip 对应 text 的证据摘要，web 的误差须线对应 text 数值后的区间。

呈现定制沿用同一个阶梯：

```ts
type WebRenderer<Props> = ReactNode | ((props: Props) => ReactNode);
type TextRenderer<Props> = LocalizedText | ((props: Props) => LocalizedText);

type Presentation<Props, Defaults> =
  | false
  | Partial<Defaults>
  | WebRenderer<Props>
  | { web: WebRenderer<Props>; text: TextRenderer<Props> };
```

- `false`：关闭该呈现。
- 部分属性对象：保留默认语义，只覆盖样式或位置。
- ReactNode / 函数：只接管 web 面；text 面继续默认投影，两面内容可能不同。
- `{ web, text }`：同时接管两面，用于标签、tooltip 或图例等有内容语义的定制。

渲染回调只收到解析后的只读数据片段与呈现 context，不能触发第二次聚合。这条边界保证计算同源，不对任意 React 回调承诺无法验证的内容等价。

## 不引入的机制

- 组件树词汇同构不意味着渲染实现相同：两面渲染由 niceeval 自己实现，静态 SVG、终端字符图、证据链接与无浏览器首屏都是它的职责，不把第三方图表运行时或 React context 引入生成管线。
- 不引入 `ResizeObserver` 或视口测量；响应式由静态 HTML 的 CSS Grid 与 container query 承担。
- 结构节点不独立取数：一个组件的全部读取与聚合由它的一次 resolve 完成并记忆化。
- facet 用 JSX `map` + [`Grid`](../library/layout.md#grid-与-stat) 表达，组件树不重复实现语言已有的遍历能力。

## 相关阅读

- [图表](charts.md) —— 容器、轴、series、嵌套节点与 `ChartData`。
- [表格与矩阵](tables.md) —— 榜单、矩阵、成绩单、对照表与稳定性矩阵。
- [实体列表](entity-lists.md) / [概览](summaries.md) / [Attempt 详情](attempt-detail.md) / [站点组件](site.md) —— 其余组件族。
- [Gallery](gallery.md) —— 真实报告图的结构验证。
- [指标与维度](../library/metrics.md) —— 组件消费的 Metric、Dimension 与 NumericAxis。
- [排版原语与自定义组件](../library/layout.md) —— 组件之间的组织件与 `defineComponent`。
- [Architecture](../architecture.md) —— resolve / validate / render 管线与两面同源不变量。
</content>
</invoke>
