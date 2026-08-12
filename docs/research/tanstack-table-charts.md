# TanStack Table、TanStack Charts 与 NiceEval Reports

> 观察日期：2026-08-07
>
> 观察对象：TanStack Table 9.0.0、TanStack Charts 0.6.5、已归档的 TanStack React Charts，以及 NiceEval Reports 的表格与图表组件
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

## 研究判断

TanStack Table 最值得学习的不是功能清单，而是把功能状态、行模型、算法注册表和最终 markup 分开。
它是一套 headless 表格状态与派生引擎，不是一只带样式的 `Table` 组件。

TanStack Charts 最值得学习的是从 typed marks、channels、scales 与 guides 编译出带稳定 key 的 renderer-neutral scene。
交互点保留源 datum 与语义坐标，SVG、Canvas、静态导出和键盘 focus 再消费同一份 scene。

NiceEval 已经拥有两项更适合评测报告的优势：报告组件只接完成计算的普通值，以及同一份结果必须同时提供 text 与 web 两个面。
`MetricValue`、Attempt refs、Sample 口径和静态无 JavaScript 输出也不应让位给通用可视化引擎。

真正需要吸收的是两者共有的内部边界：语义事实、媒介投影和渐进增强状态不能混在同一 renderer 中。
NiceEval 的表格已有 `TableContent` 语义输入；真正缺少稳定编译终值的是图表，Table 只需补浏览状态派生和可访问控制。

本研究建议进行一次内部呈现内核重构，同时保留现有报告作者心智。
不建议把 `@tanstack/table-core` 或仍为 pre-alpha 的 `@tanstack/charts` 直接加入生产依赖。

## 一手材料与版本边界

TanStack Table 的事实来自以下官方材料：

- [Table 9 Overview](https://tanstack.com/table/latest/docs/overview)
- [Features Guide](https://tanstack.com/table/latest/docs/guide/features)
- [Row Models Guide](https://tanstack.com/table/latest/docs/guide/row-models)
- [Column Definitions Guide](https://tanstack.com/table/latest/docs/guide/column-defs)
- [Data Guide](https://tanstack.com/table/latest/docs/guide/data)
- [Expanding Guide](https://tanstack.com/table/latest/docs/guide/expanding)
- [Column Filtering Guide](https://tanstack.com/table/latest/docs/guide/column-filtering)
- [Table State Guide](https://tanstack.com/table/latest/docs/framework/react/guide/table-state)
- [TanStack Table V9: Taking Form](https://tanstack.com/blog/tanstack-table-v9-taking-form)
- [`@tanstack/table-core` npm 包](https://www.npmjs.com/package/@tanstack/table-core/v/9.0.0)

TanStack Charts 的事实来自以下官方材料：

- [Charts Overview](https://tanstack.com/charts/latest/docs/overview)
- [Grammar of Graphics](https://tanstack.com/charts/latest/docs/concepts/grammar-of-graphics)
- [Data and Channels](https://tanstack.com/charts/latest/docs/concepts/data-and-channels)
- [Runtime and Scene](https://tanstack.com/charts/latest/docs/reference/runtime-and-scene)
- [Accessibility](https://tanstack.com/charts/latest/docs/guides/accessibility)
- [Interactions and Selections](https://tanstack.com/charts/latest/docs/guides/interactions-and-selections)
- [SSR and Hydration](https://tanstack.com/charts/latest/docs/guides/ssr-and-hydration)
- [Exporting](https://tanstack.com/charts/latest/docs/guides/exporting)
- [TanStack Charts 源码仓库](https://github.com/TanStack/charts)
- [`@tanstack/charts` npm 包](https://www.npmjs.com/package/@tanstack/charts/v/0.6.5)

观察日的 `@tanstack/table-core` latest 是 9.0.0。
Table 9 已进入稳定发布，文档仍包含从 9 beta 逐步改写而来的材料，因此版本判断以 npm dist-tag 与 latest 文档共同为准。

TanStack Charts 0.6.5 的官方 Overview 明确标为 pre-alpha，API 可以在任意一次发布中变化。
旧 [TanStack React Charts](https://github.com/TanStack/react-charts) 已在 2026-05-13 归档，不能用旧项目的成熟度推断新 Charts。

## TanStack Table 的真实边界

### 它负责一台表格状态机

Table 9 用 `columns + data + features` 创建 table instance。
这个实例协调列、行、表头、格子、状态和 API，最终 HTML、样式与可访问交互仍由使用方提供。

核心分成四种责任：

| 责任 | 输出 | 说明 |
|---|---|---|
| Feature | state、options、handler 与 instance API | 排序、过滤、分页、选择等能力按需注册 |
| Row model | 派生后的 rows | 过滤、排序、分组、展开和分页分别形成明确阶段 |
| Function registry | filter、sort 与 aggregation 函数 | 只注册实际使用的算法，字符串键也进入类型推导 |
| Renderer | markup、样式与事件接线 | core 不决定 `<table>`、grid、卡片或虚拟列表形态 |

Table 9 的 feature set 是静态声明。
未注册的能力不进入 bundle，也不出现在 table、row、column 或 cell 的 TypeScript 表面。

Feature 与 row model 还被刻意分开。
一个应用可以保留排序状态和 handler，却不加载浏览器排序 row model，把真实排序交给服务端。

### 状态可以内置，也可以提升

Table 可以内部管理状态，也可以让应用只接管需要共享、持久化或写入 URL 的 state slice。
Table 9 进一步把各 slice 放到独立 atom，renderer 只订阅自己消费的部分。

这给 NiceEval 的启示不是引入 atom store。
真正重要的是排序、过滤和展开应先成为有名字的语义状态，再投影到 DOM；DOM 顺序和 `textContent` 不应反过来保存状态。

### API 把静态能力、状态和算法分开

Table 9 要求先用 `tableFeatures()` 静态注册能力、row-model factory 和命名算法，再把结果交给 `useTable()`。
列通过 field accessor 或 accessor function 提供语义值；该值同时供 filter、sort 和 group 使用。

```tsx
const features = tableFeatures({
  columnFilteringFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns: { includesString: filterFn_includesString },
  sortFns: { alphanumeric: sortFn_alphanumeric },
});

const table = useTable({
  features,
  data,
  columns,
  initialState: {
    sorting: [{ id: "passRate", desc: true }],
  },
});
```

这套 API 对通用 headless data grid 很准确，但不是 NiceEval 报告作者的最短语法。
NiceEval 不公开 table instance，不按表格注册 plugin，也没有只能在 React 中生效的受控 state callback。

真正值得借的是输入之间的正交性：能力、起始状态、列 identity 与算法各有明确字段，排序投影不进入 renderer。
NiceEval 可以把这些边界压缩成组件 props，不需要保留 TanStack 的 builder 层级。

### 两类嵌套都支持，但责任不同

TanStack Table 把嵌套分成两类。
同一列结构的树形 rows 通过 `getSubRows(row)` 递归取得 child rows，再交给 expanding row model、expanded state、排序、过滤和分页处理。
任意详情区、不同 schema 的子表或其它 UI 则由使用方把普通 row 标为可展开，并在展开后渲染自定义 sub-component。

树形 rows 还能选择从 leaf 向上过滤、限制过滤深度、只排序 siblings，或把展开与分页交给服务端。
这些能力说明 expanding 是 row model 的一个派生阶段，不应被写死成 renderer 内的 DOM 开关。

不过 TanStack 是 headless core。
它不替使用方决定 child rows 的 HTML、disclosure 的可访问名称、无 JavaScript 行为，也不为自定义 sub-component 生成 text 表达。

NiceEval 因此原生支持第一类：`subRows="children"` 声明同构层级字段，内部编译为现有 `TableContent.subRows`。
第二类不进入 Table primitive；不同 schema 的子表或任意详情内容由 `Section`、另一只 `Table` 或未来同时定义 text/web 的组合原语表达，不开放 `renderSubComponent` callback。

### 它不替报告决定正确口径

Table 的 grouping 与 aggregation 面向普通 data grid。
它不知道 Sample、Experiment × Eval 两级折叠、coverage、`MetricValue` 或 Attempt refs。

Table 也不自动提供 NiceEval 所需的 text 面、静态导出纪律或无 JavaScript 降级。
采用 headless core 仍要自行实现 markup、主题、键盘语义和证据链接。

因此，Table 的 row-model pipeline 值得借鉴，通用 aggregation 和完整 feature catalog 不应复制进 Reports。

## TanStack Charts 的真实边界

### 图表是一组 mark，不是一只大组件

TanStack Charts 沿用 grammar of graphics：data 交给 mark，channel 把字段或 accessor 映射到位置、分组、颜色、尺寸与 identity。
scale 负责语义值到视觉空间的映射，guide 负责轴、刻度、网格与图例。

不同 mark 可以消费不同的 rows 和 datum 类型。
目标线、实际值、预测区间和事件标签不必先并入一张通用 series 表。

数据变换留在普通函数或应用数据层。
Charts 提供常见 eager transform，但不接管 fetching、清洗、权限、服务端聚合或探索分析。

这与 NiceEval 的“page render 先计算、组件只显示普通值”方向一致。
它反向证明没有必要把图表做成查询运行时或在 renderer 内重新聚合。

### 编译结果是 renderer-neutral scene

Charts 的运行路径是：

```text
definition
  → materialized channels
  → resolved scales and guides
  → keyed ChartScene
  → SVG / Canvas / custom renderer / export
```

`ChartScene` 包含完整尺寸、绘图区、顺序 scene nodes、交互点、已求值 scale、颜色、渐变和主题。
每个交互点同时保留稳定 key、mark id、group、源 datum、语义 x/y 值和像素坐标。

这个中间层解决了三个容易混在 renderer 里的问题：

1. 哪些数据属于哪个 mark，以及点的稳定身份是什么。
2. 语义值、格式化值、像素位置和交互命中点各自属于哪一层。
3. SVG、Canvas、静态导出和交互宿主怎样复用同一份 scale 与 scene 计算结果。

### 可访问性是输入契约

每个 Charts DOM host 都要求 `ariaLabel`，可选 `ariaDescription` 提供图外未出现的上下文。
原生 focus 让 pointer 与 keyboard 共享同一份 typed `ChartPoint`。

官方还明确要求精确值另有表格或普通 HTML 表达。
tooltip 是补充，不替代标题、轴、图例、标签或数据表；颜色也不能成为唯一编码。

NiceEval 已经有 text 精确值表和颜色加形状的 24 槽位设计。
缺口是 web 点只支持 hover tooltip，SVG 的可访问名由字段名拼出，键盘用户没有同等的点 focus 与证据下钻路径。

### 交互状态仍归应用

Charts 自己拥有 nearest-point focus、grouped tooltip、crosshair 和键盘点导航。
brush、zoom、pan、播放、编辑区间和跨视图联动则由应用以语义 domain、range 或 selection state 管理。

官方明确反对直接修改 SVG 几何后再反推应用状态。
共享视图按语义值和稳定 identity 联动，不按两个画布上的像素位置联动。

这个边界适合 NiceEval：组件可以拥有“正在查看哪一个点”，但不能让浏览器交互悄悄改变 Sample、聚合分母或报告数字。

### SSR 与导出都有显式尺寸

Charts 在服务端无法测量容器，因此要求 fixed size、aspect ratio 或 initial width policy。
静态导出同样要求显式尺寸，使同一 scene 可确定地输出 SVG。

NiceEval 的静态 HTML 比普通应用 SSR 更严格：它不依赖 hydration，JavaScript 关闭时仍要完整可读。
因此可以学习“尺寸是输入、导出必须确定”，但不能直接照搬依赖浏览器重新执行 definition 的 responsive lifecycle。

## NiceEval Reports 的现有基础

### 已经做对的部分

NiceEval 的[报告组件分层](../feature/reports/README.md)已经区分显示原语、领域组合组件和共用函数。
报告作者先用普通函数完成聚合和转换，再把 `rows`、`points`、`items` 或 `value` 交给组件。

Table 与 Chart 都不读取 Sample，也不执行 Calculation。
Sample 派生图表要求 EvidenceRow 与 MetricValue，纯外部序列必须显式声明 `external`。

一个 page render 只执行一次，text 与 web renderer 消费同一棵 page 结果树。
自定义显示形状也必须提供两个面，无 JavaScript 的 web 初始 HTML 仍要完整可读。

这些约束比 TanStack 更贴合评测报告，重构时必须保留：

- 两级聚合、coverage 与 refs 由 `aggregate()` 和证据构造器负责。
- renderer 不能重新取数、聚合或丢失证据。
- text 不是 web 的 fallback 字符串，而是一等报告面。
- 静态站、show 和自有 React 嵌入消费相同的结果口径。

### Table 已有语义模型雏形

公开 `Table rows` 会先转换成内部 `TableContent`。
它包含列声明、稳定 row key、层级 `subRows`、cell union、MetricValue 与缺失原因。

web 与 text 都在转换和校验后消费这份内容。
这是正确的 headless 边界，不需要换成 TanStack 的 `Row`、`Cell` 与 column instance 才算 headless。

不足在浏览状态层。
排序由点击 `<th>` 后读取 cell 属性或文字并重排 DOM，过滤读取整行 `textContent`，层级展开直接交给 `<details>`。

这些行为没有统一的 `TableViewState → visible rows` 推导。
排序表头也不是 button，没有 `aria-sort` 与键盘激活契约。

### Chart 有多个内部概念，但缺一份编译终值

NiceEval 已有 `Dataset`、field metadata、公开 `Chart` / `Series`、axis binding、mark、值域算法、维度呈现和证据 target。
`Scatter`、`Line`、`Bars` 与 `Area` 只是把普通 points 转成这些内部概念。

这里还有一个必须显式处理的 beta 契约差异。
源码公开面使用 `Chart data={Dataset}` 与 `Series points="identityField"`，Feature 文档则承诺 `Chart points` 默认 rows 和逐 series 的 `points/external`。

重构不能把 `Chart` / `Series` 当成未公开内部件。
目标方案要承认它是一套 closed-mark 作者 DSL，并把 Dataset 写法到 points 写法的迁移列入契约。

问题是这些概念仍在 renderer 内重新装配。
当时的 [`chart.tsx`](https://github.com/NiceEval/NiceEval/blob/de8684a10087bf9d17a52a7e1516e1011eef38fb/src/report/definition/primitives/chart.tsx) 同时承担 mapping、固定画布几何、SVG、图例、点标签、tooltip 文本、证据 href 与 text 读值表。

web 图表使用固定的 `760 × 400` viewBox。
`ChartPresentation.tooltip` 已出现在类型里，却没有形成可观察行为开关；增强脚本只监听鼠标 hover。

text 面另走字符图，但与 web 共享的边界停在 Dataset 和 mapped series。
代码里没有 context-free `ChartModel` 固化 typed value、identity、缺失、MetricValue、refs 和 target。

## 逐项对照

| 维度 | TanStack Table / Charts | NiceEval Reports | 判断 |
|---|---|---|---|
| 输入 | 普通 data；Chart 每个 mark 可有自己的 rows | 完成计算的 rows / points；Sample 派生值带证据 | NiceEval 的证据边界更强，应保留 |
| 计算 | Table row model；Chart transform 在定义外 | `aggregate()`、普通函数与转换在 page render | 不把 TanStack aggregation 或 transform DSL 搬进组件 |
| Headless core | Table instance 与 ChartScene 都独立于 markup | TableContent 已归一输入；Chart 缺少语义终值 | 补 Chart 纯编译边界，不为 Table 复制模型 |
| 状态 | Feature state 可内置、受控或共享 | web 增强直接修改 DOM；没有家族状态模型 | 浏览状态应语义化，DOM 只做投影 |
| Renderer | 多 framework；Charts 支持 SVG、Canvas 与 export | text 与 web 两个一等面；静态 HTML 优先 | NiceEval 不需要多 framework renderer 或 Canvas |
| Identity | row id、scene key、源 datum 与语义坐标 | row key、Dataset key、refs 与 ReportTarget | 可以统一收敛到稳定 key + 源值 + target |
| 可访问性 | Charts label 必填，pointer/keyboard 共用 focus | Table 有原生结构；Chart 只有 field-derived name 与 hover | 这是直接的产品缺口 |
| 渐进增强 | 应用或 host 拥有 lifecycle | 单一 vanilla runtime，JavaScript 关闭时仍有完整 HTML | 保留静态优先，但 controller 不再从 DOM 反推状态 |
| 大数据 | Table row model、Virtual；Charts 可选 Canvas 和 index | 报告按注意力预算显示结果，不追求电子表格规模 | 不引入 virtualization、Canvas 或百万行目标 |
| 扩展 | Table plugin、custom mark / renderer | `defineRenderer` 要求 text + web | 新 chart mark 也必须遵守双面准入 |

## 值得吸收的设计

### 1. Chart 先编译语义终值，再按媒介投影

Chart props 不应直接驱动所有 DOM 或字符布局分支。
编译先得到 mark、轴、typed value、identity、缺失、证据 target 与交互点；locale、主题和空间布局留给媒介投影。

text 与 web 共享 locale-neutral 的语义终值。
它们只在本地化、空间规划和具体 markup 上分叉，不在缺失、series、typed value、证据目标或顺序上各做一遍。

Table 不需要再增加一层同名 compile model。
现有 `TableContent` 保持唯一语义输入，web renderer 只需为 controller 预编码稳定 key、sort rank 与 search token。

### 2. 浏览状态、派生模型和 renderer 分开

表格排序、过滤与展开是 `TableViewState`。
“给定状态后哪些行可见、顺序如何”是纯 row model；HTML table、终端表格和增强脚本只是消费者。

图表 focus 同理。
Pointer 与 keyboard 应选中同一个语义 `InteractionPoint`，tooltip、focus marker、状态区和下钻链接读取同一份终值。

### 3. Mark 与 channel 是增长边界

NiceEval 不需要立即公开通用 grammar API，但内部不应继续按“又来一种成品 chart”增长。
散点、线、柱、面积、阈值与注释应在 mark 层表达，组合图只决定共享轴与声明顺序。

新 mark 的准入必须同时回答：

- 接收哪些普通值和 channel。
- 怎样保留 MetricValue 与 Attempt refs。
- text 面怎样表达精确值与关系。
- web scene 怎样绘制并暴露稳定交互点。

### 4. 可访问性进入组件输入

字段名拼成的 `costUSD × passRate` 只能解释轴，不能说明图在回答什么。
图表需要由作者给出可本地化的 label，可选 description 解释统计口径、时间范围或缺失策略。

tooltip 必须可由 pointer 和 keyboard 到达，并在无 hover 时仍有精确值替代。
Table 的排序表头必须是可聚焦控制，过滤输入必须有名字，排序方向必须通过 `aria-sort` 暴露。

### 5. 稳定 identity 同时服务更新、交互和证据

TanStack 的 scene key 不只是 React key。
它把重排、动画、focus、selection 和 source datum 连在一起。

NiceEval 的 row key、Dataset key、dimension value 与 refs 也应在编译层一次完成身份查找。
增强脚本只按稳定 key 更新状态，不能靠标签文本相等、DOM 位置或第一个 ref 猜身份。

### 6. 能力按需求加入，不建立大而全实例

Table 9 的 feature set 说明扩展性不等于把所有能力放进每个组件。
NiceEval 的表格只需要排序、搜索和层级展开，不因此引入分页、选择、编辑、列拖动、pinning、faceting 或 virtualization。

图表同样不因有 scene 就默认引入 Canvas、动画、brush、zoom、地图与复杂空间索引。
每一项能力都必须先证明评测报告场景和诚实的 text 降级。

### 7. 作者 API 学边界，不学 ceremony

普通报告的最短路径仍应是 `<Table rows={rows} />`。
启用浏览能力时，顶层 `search` 与 `sort` 比 `features={{ search: true, sort: true }}` 更短，也更诚实。

```tsx
<Table
  rows={performance}
  columns={[
    "agent",
    { field: "costUSD", header: "Spend" },
    "passRate",
  ]}
  search
  sort={{ field: "passRate", direction: "desc" }}
/>
```

同构层级 rows 也保持字段选择器心智，不把 TanStack 的 `getSubRows` callback 暴露给作者：

```tsx
<Table
  rows={results}
  subRows="children"
  columns={["name", "passRate"]}
  search
  sort={{ field: "passRate", direction: "desc" }}
/>
```

`subRows` 字段不成为可见列。
排序递归作用于每一组 siblings，search 只保留直接命中的 rows 与它们的 ancestors。
公开 API 不提供 `rowKey` 或 `expanded`；折叠是当前 Table 实例内的临时阅读状态，重新装载后回到全部展开。

`sort={true}` 只启用可排序表头并保留声明顺序；对象形态同时声明所有 renderer 的首屏顺序。
`search` 总是从空 query 启动，因此 text 与无 JavaScript web 不会因浏览器启动配置丢行。

复杂列仍由 `field` 定位，`header` 只负责双面的表头文案。
受限的 `sortValue(value)` 可以把枚举等显示值投影为构建期排序 token，但不能访问整行、改变显示值或进入浏览器 payload。

不公开通用 accessor、display column、group column 或 `cell: () => ReactNode`。
计算列继续由 page 的普通函数产生；任意 web cell callback 无法提供诚实 text 面，Table grouping 也不能保护 coverage 与 refs。

不公开全局算法注册表。
同一份列定义旁直接传纯 `sortValue` 更短；共享算法是普通 import，内部再把 token 编译成稳定 rank。

## 不应照搬的设计

- 不让 Table grouping 或 aggregation 计算评测数字。它无法保护 Experiment × Eval 两级折叠、coverage 和 refs。
- 不把 table instance、atom 或 row model 暴露给普通报告作者。`rows`、`columns`、`search` 与 `sort` 已经是更短的报告输入。
- 不把所有交互 state 提升成报告级 store。共享 Sample 范围仍在 page render 中显式产生，浏览器搜索不能联动并重算其它组件。
- 不把 TanStack Charts 的 pre-alpha grammar 当成 NiceEval 稳定公开 API。它的版本风险会直接进入预编译 report runtime。
- 不用 Canvas 或 virtualization 掩盖信息密度问题。报告应该先聚合、分面、截断并解释省略，而不是显示无法区分的百万个点。
- 不要求 text renderer 消费像素 scene。两个面应共享语义终值，空间算法按终端与 SVG 各自的真实约束投影。
- 不为响应式浏览器图牺牲确定的静态导出。服务端尺寸、locale、主题与维度槽位必须是明确输入。
- 不把 transforms 放进 renderer。排序、移动平均、分桶和 frontier 继续是 page 旁普通函数或 NiceEval 的证据组合器。

## 是否直接采用 TanStack 包

| 选择 | 收益 | 代价 | 研究判断 |
|---|---|---|---|
| `@tanstack/table-core` | 完整状态、row model 和类型化 feature | 超出需要；仍要自写双面、证据 cell、静态增强与可访问 markup | 不采用；借鉴 pipeline |
| `@tanstack/charts` | marks、scales、scene、SVG、focus 与 export | pre-alpha；无 text 面；带 D3 依赖；responsive host 与 NiceEval 无 hydration 契约不同 | 不作为生产依赖 |
| 直接复用 Charts scene 类型 | 少定义一套 scene | 类型与 release cadence 被外部 pre-alpha API 绑定 | 不采用 |
| 本地 Chart kernel | 保留 Evidence、双面和静态契约；按真实需要增长 | 需要重排现有图表模块并建立新的验收 fixture | 推荐 |

未来可以用隔离 spike 再评估 `@tanstack/charts`。
只有它进入稳定版本、可由 NiceEval 提供诚实 text renderer、静态导出不要求 hydration，且 bundle 与 license 验证通过时，才有必要重开依赖裁决。

## 对 NiceEval 的建议

这次研究已经达到 roadmap 级重构阈值。
理由不是要复制更多 chart type，而是现有实现无法靠继续添加事件监听器稳定满足键盘、可访问 tooltip、结构化 focus、响应式尺寸和新 mark 的共同需求。

重构应保持 `Scatter`、`Line`、`Bars`、`Area` 与 closed-mark 组合心智，并新增最小的可访问输入。
低层 `Chart data` 与 `Series points="field"` 是例外：它们迁移到 points 入口和 `Series point`，不能伪称完全兼容。
内部只为 Chart 建立 context-free 的语义模型，不建立虚假的通用 `ComponentModel`，也不为 Table 复制已有的 `TableContent`。

Chart kernel 与 Table 浏览状态只共享以下跨组件约束：

- 输入是已经完成计算的普通值。
- stable key、typed value、缺失、逻辑维度身份与 ReportTarget 在媒介投影前固定。
- text 与 web 的初始输出同序、同值、同证据。
- web transient state 只改变阅读方式，不改变 Sample、MetricValue 或 page 结果树。
- JavaScript 关闭时仍有完整初始 HTML 和可复制的证据入口。

目标契约进入 [Chart 语义内核与报告交互控制器 Roadmap](../roadmap/report-chart-kernel/README.md)。

## 验证建议

重构前后应使用同一组 family fixtures，而不是只比较 HTML snapshot：

1. Table fixture 固定 `TableContent`、预编码 sort rank/search token、initial state 与 expected visible row keys。
2. Chart fixture 固定 marks、axes、MetricValue、missing、series identity、InteractionPoint、显示值与 expected targets。
3. Table 两面共享 `TableContent` 与 initial view，Chart 两面共享 model 与 facts；数值、缺失、顺序和 target 必须对应。
4. 无 JavaScript HTML 证明标题、精确值、证据链接和层级内容仍可读。
5. 浏览器验收检查 Table 键盘排序、`aria-sort`、命名 filter，以及 Chart pointer/keyboard 同点 focus、tooltip 与下钻。
6. 静态导出在固定 locale、theme、dimension pins 与 size policy 下保持字节稳定。
7. 增强后排序、搜索、折叠与 focus 不修改任何 MetricValue、coverage 文案或证据集合。
8. 层级 Table fixture 验证 sibling-only 递归排序、直接命中加 ancestors 的搜索、深树预算、ancestor cycle 和共享对象的 occurrence identity。

这组证据能把“headless”落实成可检查的中间结果，而不是把现有文件拆小后继续由 renderer 暗中决定语义。
