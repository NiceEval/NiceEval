# Chart 语义内核与报告交互控制器

NiceEval 图表同时服务 text、静态 web、站点浏览和自有 React 嵌入。
四个宿主必须看到同一组读数、缺失、证据与点身份，但可以采用不同的空间布局。

当前图表 renderer 同时处理字段映射、证据、值域、几何、视觉身份、本地化、链接和交互。
继续在 SVG 与增强脚本上增加分支，无法稳定提供键盘焦点、精确值替代和新 mark 的双面准入。

本主题为笛卡尔图表建立 context-free 语义内核，再按媒介生成 text 与 web 投影。
Table 保留已有 `TableContent`，只补浏览状态、稳定 token 和可访问控制，不建立同级 kernel。

## 核心心智

图表先固定语义事实，再引入 locale、主题、尺寸、视觉槽位和宿主链接。

```text
Chart / Series / convenience props
              └─> compileChart(props) ─> ChartCompilation
                                           ├─> ChartProjectionOptions
                                           └─> ChartModel
                                                  │
                                      projectChartFacts(locale)
                                                  │
                                                  ▼
                                      ChartProjectionFacts
                                           ┌──────┴──────┐
                                           ▼             ▼
                                    projectText    projectWeb
                                           │             │
                                    TextProjection   WebProjection
                                                         │
                                          ┌──────────────┼──────────────┐
                                          ▼              ▼              ▼
                                      WebScene   ExactValueRows   EnhancementPayload

Table rows ─> TableContent ─> web tokens + TableViewState ─> Table controller
```

`ChartModel` 不接收 render context。
它保留 typed value、MetricValue、缺失、逻辑视觉身份、证据 refs、`LocalizedText` 和 `ReportTarget`。

`ChartProjectionOptions` 独立保存 width、height、aspect、layout、legend、tooltip、grid、locale 与 className。
两个 projector 都显式接收它；这些展示属性不会混入语义模型。

`ChartProjectionFacts` 按 effective locale 一次生成逐 channel display、coverage、refs 和原 `ReportTarget`。
text 与 web 复用它，不各自合并证据或格式化 MetricValue。

两个 projector 同时接收 model、facts 与 projection options。
图中只画 facts 主路径，避免把三条输入线叠在一起。

text 投影独占终端宽度与字符布局。
web 投影独占像素、tick、最终 scale domain、主题样式、dimension slot 和最终 href。

宿主给 web 投影确定的 available width。
数值 width 优先，百分比 width 乘 available width；height 优先于 aspect，未声明两者时使用 1.9 的默认 aspect。

SVG、精确值表与增强 payload 来自同一次 web 投影。
浏览器 controller 只改变阅读焦点，不计算指标，也不从 SVG 或文字反推业务状态。

## 作者心智

`Chart` 与 `Series` 是公开的 closed-mark 组合 DSL。
作者可以组合 `line`、`bar`、`area` 与 `scatter`，但不能注册新的 mark 或拿到内部 scene。

```tsx
<Chart
  points={performance}
  label={{ en: "Quality and cost", "zh-CN": "质量与成本" }}
  description={{ en: "Evaluation-weighted metrics", "zh-CN": "按 Eval 加权" }}
  axes={[
    { id: "cost", channel: "x", unit: "$", format: "currency", better: "lower" },
    { id: "quality", channel: "y", unit: "%", format: "percent", better: "higher" },
  ]}
>
  <Series
    id="actual"
    mark="scatter"
    x="costUSD"
    y="passRate"
    pointLabel="experiment"
    by="agent"
    xAxis="cost"
    yAxis="quality"
  />
  <Series
    id="budget"
    mark="line"
    external
    points={budgetTargets}
    x="costUSD"
    y="targetRate"
    xAxis="cost"
    yAxis="quality"
  />
</Chart>
```

`Chart.points` 是 series 的默认 rows；`Series.points` 可以换成另一组 rows。
证据校验逐 series 进行，因此同一张图可以组合 EvidenceRow 与显式 `external` series。

Evidence 与未包装的 external scalar 共用数值轴时，作者必须声明具名 axis 及其 `format`。
axis 是 unit、format、better 与 bounds 的共同语义 owner，external scalar 不会被包装成伪 MetricValue。

Analysis-backed closed rows 的读数字段必须是 `MetricValue`，并逐 channel 保留 refs 与 coverage。
point target 只来自具名 evidence family 的条件式默认值，或 object-bound `pointTarget`。
`external` series 只接 JSON scalar，没有 Attempt refs，也不能声明 `pointTarget`。

`Scatter`、`Line`、`Bars` 与 `Area` 继续是单 series 的便利入口。
它们与 `Chart` / `Series` 编译到同一个 `ChartModel`，并且同样要求本地化 `label`。

## Beta API 迁移

目标作者契约以 points 为输入，不再让作者先构造 `Dataset`。
这会改变当前 beta 的低层图表写法：

| 当前写法 | 目标写法 |
|---|---|
| `Chart data={dataset}` | `Chart points={rows}` |
| `Chart x="cost" y="score"` | 每个 `Series` 声明 `x` 与 `y` |
| `Series points="experiment"` | `Series pointLabel="experiment"`；身份仍来自 `ReportRowKey` |
| `Series point="circle"` | `Series shape="circle"` |
| 所有 series 共用一份 Dataset | series 继承 `Chart.points` 或自带 `points` |
| 全图只有一种证据模式 | 每个 series 独立声明 EvidenceRow 或 `external` |
| 字段名拼接 SVG 可访问名 | `Chart` 与便利组件必填 `label` |

`Dataset` 只作为内核规范化 rows 的内部类型；普通报告作者用 `aggregate()` 返回的 closed rows 输入 Evidence 图表，external series 才传带
显式 stable `key` 的 scalar rows。
NiceEval 内建图表、官方报告、类型测试和文档示例都使用目标写法。

## 初始一致性

相同 locale 下，text 与 web 初始输出必须具有：

- 相同的 logical point key 集合与 series 声明顺序。
- 相同的 typed channel value、缺失状态和缺失原因。
- 相同的完整本地化 scalar 字符串、coverage 文案和证据 refs。
- 相同的未求值 `ReportTarget`；宿主不能服务时，两面都不得伪造入口。
- 相同的 hidden、stack、connect 与 null policy 语义。

字符图、SVG 几何、换行、tick 数量、视觉槽位和链接文本可以不同。
终端布局即使省略空间关系，也必须在精确值区保留完整 scalar 字符串。

## 无 JavaScript 与可访问性

每张 web 图表始终输出以下三个同级部分：

1. 带本地化名称和说明的 SVG。
2. 原生 `<details>` 内的精确值 `<table>`。
3. 供渐进增强读取的有版本 payload。

精确值表不是 tooltip 的 fallback。
它在 JavaScript 关闭时仍可通过键盘展开，并列出所有 channel、missing、coverage、refs 与宿主可服务的链接。

启用 JavaScript 后，图表根只有一个顺序 tab stop。
方向键在 scene 的稳定点顺序中移动，Enter 打开当前点目标，Escape 清除固定 tooltip。

Pointer 与 keyboard 更新同一个 point key。
tooltip、focus marker、状态区和链接都读取同一份 `EnhancementPayload`。

## Table 的局部边界

Table 不增加 `TableModel`。
公开 rows 仍先规范化为 `TableContent`，text 与 web 继续消费这份内容。

普通作者的最短路径保持不变：

```tsx
<Table rows={performance} />
```

同构的树形 rows 只需声明 child field：

```tsx
<Table
  rows={results}
  subRows="children"
  columns={["name", "passRate"]}
  search
  sort={{ field: "passRate", direction: "desc" }}
/>
```

[完整 Table 语法示例](example/README.md)集中展示 flat rows、自定义列、枚举排序和 nested rows。
搜索和排序仍是顶层能力，不增加 `features` builder 或公开 table instance。

`sort={true}` 启用交互并保留声明顺序；对象形态同时规定 text、无 JavaScript web 与增强首帧的顺序。
`search` 总是从空 query 启动，并且只匹配 effective locale 下实际呈现的 cell 文本。

列的 `field` 是唯一 identity，`header` 只提供本地化表头。
`sortValue` 是构建期纯投影，不是通用 accessor；它不能读取整行、改变 Cell、coverage 或 refs。

公开 API 不提供 controlled state、row model、算法注册表、display/group column 或 renderer callback。
业务计算列、分组与 population narrowing 必须先定义 Analysis fields。Table 只做显示排序、可见列与格式选择；浏览状态
由静态 HTML 上的 controller 局部拥有。

web renderer 为每个 row 与 column 输出稳定 key，并在服务端生成 locale 对应的 sort rank 与 search token。
controller 以 `TableViewState` 纯计算可见 row key，不读取 `textContent`，也不把当前 DOM 顺序当成状态。

`subRows` 是和 `x="costUSD"` 相同的字段选择器，不是 callback。
它只表达所有层级共用可见列的树；不同 schema 的子表与任意详情内容继续用组合组件表达。
排序递归作用于每组 siblings，parent 与 descendants 不会混排。

text 与无 JavaScript web 都从同一个 initial state 派生首屏顺序和可见 rows。
默认 query 为空、父 row 全展开；启用脚本后的第一次投影不得重排或隐藏首屏内容。

search token 与 query 都执行 NFKC、locale lower-case、首尾去空白和 Unicode 空白折叠。
query 再按空格拆词，一行必须命中所有词。
query 非空时只显示直接命中的 rows 及其 ancestors，不因 parent 命中而带出未命中的 subtree。
搜索结果临时视为全部展开并隐藏 disclosure；清空 query 后恢复搜索前的折叠状态。

排序表头使用可聚焦 button，`th` 同步 `aria-sort`。
过滤输入有可访问名称。
无 JavaScript 时所有层级 row 都是原生 `<tr>` 并完整可读，disclosure button 隐藏；增强后 button 通过 `aria-expanded` 暴露折叠状态并响应 Enter 与 Space。

这是 beta breaking migration。
顶层 `searchable` 改为 `search`，列的 `label` 改为 `header`，旧字符串 `sort` 改为布尔值或 `{ field, direction }`。
列的 `hidden` 不保留 alias；显式 `columns` 本身就是可见列集合。

## 扩展边界

新内建 mark 必须同时提供：

- props 到 `ChartModel` 的 typed channel 编译。
- text 投影与精确值表达。
- web scene、键盘焦点和 pointer 命中点。
- EvidenceRow、`external`、missing、locale 与静态导出 fixture。

目标作者面不再导出 `defineRenderer`。普通自定义 component 只组合已有 primitives；新 heatmap 等显示形状必须作为
NiceEval core primitive 同时提供 terminal、Web、static 与可访问行为，不能通过 renderer plugin 绕过。

公开自定义 mark 需要单独的插件契约与兼容承诺，不在本主题预埋半公开入口。

## 页级视觉身份

page render 与 report tree 求值只执行一次，并建立内部 `ReportRenderPlan`。
每个 Chart node 在 plan 中只编译一次，text 与 web 复用同一份 `ChartCompilation`。

plan 先从全部组件收集 `VisualIdentityToken`，再由页级 allocator 合并 `dimensionPins` 并分配 visual keyset。
web projector 只接已分配 keyset；它不读取 pins，也不在单张图里重新编号。

theme 把 keyset slot 换成颜色、形状、线型或填充图案。
改变 theme 不重新编译 Chart，也不改变 point key、MetricValue、missing、refs 或 ReportTarget。

## 验收切片与体积预算

纵向 fixture 使用三种 series、每种 24 个 logical point，其中同时包含 EvidenceRow、`external`、missing 和多 refs。
Evidence 与 external 共用的数值轴显式声明 unit、format、better 与 bounds。
同一 fixture 在 `en` 与 `zh-CN` 下运行，并固定 theme、dimensionPins 与导出尺寸。

fixture 必须证明：

- text、无 JavaScript HTML 与增强后的 web 都满足初始一致性。
- SVG 与精确值表按 point key 一一对应，missing row 也有稳定 key。
- pointer 与 keyboard 聚焦同一点，并得到相同 tooltip rows 与链接。
- 静态导出不测量 DOM，也不执行 definition 或 page render 第二次。
- theme 与 dimensionPins 只改变 web style，不改变 point、value、missing 或证据。

验收输出分别列出 SVG、精确值表、payload 和整张图的 raw bytes 与 gzip bytes。
该 72-point fixture 的精确值表加 payload 不得超过 48 KiB raw 或 12 KiB gzip。

另一组 closed-mark matrix fixture 检查剩余图形语义：

- band x axis 上的正负 bar stack，并分别生成 vertical 与 horizontal scene。
- numeric x axis 上的 area stack、missing 与 connect policy。
- 每个 bar/area point 在 text、scene 与 exact rows 中具有相同 key 与终值。

两组 fixture 合起来穷尽 `scatter | line | bar | area`、band axis、正负 stack 与 horizontal layout。

payload 不嵌入完整 source row、MetricValue 或 refs object。
它只携带 point key、focus 顺序、几何、本地化 tooltip rows、exact row key 与最终 href。

## 范围

本主题包含：

- context-free `ChartModel` 与 text/web 投影。
- 公开 closed-mark `Chart` / `Series` DSL 及 beta 迁移。
- 始终存在的精确值 HTML、键盘焦点与结构化 tooltip。
- Table 的稳定 token、纯 view state 与可访问 controller。
- 双面一致性、静态导出和 HTML 体积验收。

本主题不包含：

- TanStack Table 或 TanStack Charts 生产依赖。
- 通用 grammar of graphics、作者自定义 mark 或公开 scene API。
- Canvas、动画、brush、zoom、pan、virtualization 或图表级 store。
- 在 renderer 内查询 Sample、重新聚合或改变 MetricValue。
- 为 Table 复制 feature registry、row-model pipeline 或新的语义 kernel。

## 入口

- [Architecture](architecture.md) —— 五类内部形状、所有权、投影与 controller 契约。
- [TanStack 对照研究](../../../../research/report-design/tanstack/README.md) —— 外部事实、版本风险与取舍依据。
