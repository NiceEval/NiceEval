# Reports —— 架构

Reports 把同一份结果事实呈现到三个位置：终端宿主 `show`、网页宿主 `view`、用户自己的 React 页面。三个入口共用指标与数据计算；两个官方宿主共用 Scope 规则，自有 React 页面显式选择 `results.current()` 或历史 `Snapshot[]`。`--report` 的自定义报告树可在两个官方宿主间复用。

```text
.niceeval/ ── openResults / Scope ── resolve（*Data 计算）── 可序列化数据
                                                        │
                         ┌──────────────────────────────┼────────────────────┐
                         ▼                              ▼                    ▼
                  report tree text 面          report tree web 面       React 组件
                  niceeval show                  niceeval view            用户页面
```

## 概念分层

可装载的分层只有三个概念，每个概念一句话，每个词只出现在一层：

| 概念 | 形态 | 职责 |
|---|---|---|
| 组件 | `defineComponent`（双面或组合） | 唯一的取数与渲染单位 |
| 页 | `{ id, title, content }` 字面量 | 给一棵树一个地址和导航名 |
| 报告 | `defineReport(外壳 + 内容)` | 唯一可被宿主装载的产物 |

`define*` 只出现在有契约需要在定义时强制的两处：组件的渲染面资格与外壳/页列表的形状。页没有这种契约——它是纯绑定记录，id 在装载期校验即可——所以页是字面量，不设 `definePage`。

## 事实与看法

Results 保存事实：判定、断言、runner 时间树、事件、trace、diff 和运行元数据。Reports 只派生看法：指标、聚合、排序、图表和列表。Attempt 的统一时间视图属于宿主证据面:它读取 `phases` 作为生命周期/hook/command/turn 骨架,按 turn 的 `traceId` 临时挂接 `trace.json` spans；组合结果不写回任一 artifact。

派生数据不写回结果根，不带独立 schemaVersion——支持口径是同一 niceeval 版本写读，删除报告缓存后可从原始结果重新计算。渲染面消费 `data` 时校验结构，不符合当前版本的形状按完整用户反馈报错并提示可能的版本漂移；漂移因此以显式错误浮出，不静默错渲染。

## Scope 是计算入口

所有官方 `*Data(input, options?)` 计算函数接受 `ReportInput = Scope | readonly Snapshot[]`。Scope 同时携带快照和选择警告，避免报告把数据与“这批数据是否完整”的信息拆开。宿主是 warning 的唯一呈现者：`show` / `view` 在报告树外统一显示 Scope warning，组件数据不复制 warning，自有 React 页面则直接消费 `scope.warnings`。

`show` 与 `view` 对命令行范围使用同一套选择规则：

1. `--results` 确定结果根。
2. `--experiment` 和 eval id 位置参数收窄范围。
3. 宿主调用 `results.current()`——官方现刻水位口径（每个 experiment × eval 取「包含该 eval 的最新快照」里的 attempt），单点定义在 [Results · 官方现刻水位](../results/library.md#官方现刻水位resultscurrent)，宿主不自带第二套选择规则。
4. 局部补跑、过旧或未完成快照形成结构化 warning。
5. 同一份 Scope 交给各宿主默认首页或 `--report`。

宿主把这份 Scope 注入报告：树中每个数据组件的 `input` 默认就是它，组合组件从 ctx 拿到它。这个默认不是猜测——「所有页共享同一宿主 Scope」本身就是契约，默认值只有一个候选；要收窄就显式传 `input`。报告若需要历史趋势，可从组合组件 ctx 的 `results` 自行选择 `Snapshot[]`；不能把宿主注入的现刻水位 Scope 当成完整历史。

## 可比组是默认报告的聚合边界

Experiment 的路径同时声明身份与可比性。默认 `ExperimentComparison` 从 experiment id 派生可比组键：有 `/` 时取完整父路径，没有 `/` 时取完整 id 并形成单例组。这个派生只依赖身份字段，不解析 agent、model、flags 或文件名后缀，也不把共同字符串前缀当成组。id 的路径就是分组 API——第三方 writer 要分组，让 id 带路径；要路径之外的分组语义，用组合组件自行分区并逐组组合通用组件，`ExperimentComparison` 不设分组配置。

分区发生在 Scope 已完成范围收窄和现刻水位选择之后、任何指标计算之前。每个组独立调用 `scopeSummaryData`、`metricScatterData` 与 `experimentListData`；所以组外 attempt 不可能污染该组的坐标尺度、series 连线、成功率、成本、排序或缺数据计数。Scope warning 仍属于整份选择，宿主在组索引上方统一显示，不复制进每组。

这条隔离是不传 `--report` 时的产品契约，不是所有报告组件的全局魔法。`MetricScatter`、`MetricTable` 和 `ExperimentList` 仍忠实消费作者给出的数据范围；自定义报告可以为了横跨项目的分析显式合并组。默认报告不能这样做，因为 Experiments 已用“同一文件夹才互相对比”建立了可归因边界。

## 组件模型：解析面与渲染面

组件由 `defineComponent` 定义，两种入参形态产出同一种可入树的报告组件：

- **双面组件**（对象形态 `{ resolve?, text, web }`）：自己渲染。`resolve` 是组件唯一的异步 / IO 面，把作者写下的 props 规范化成渲染 props；`text` 与 `web` 是同步纯函数，只消费 resolve 之后的渲染 props——两面因此天然消费同一份终值。
- **组合组件**（函数形态 `(props, ctx) => 树`）：只装配已有组件，不自己渲染，可以异步；`ctx` 携带宿主注入的 `scope`、结果根读取面 `results` 与规范化报告声明 `report`（[契约](library/shell.md#行为约束)）。心智与 React 同构：双面组件像 host component 自己落渲染，组合组件像 function component 只组合别人。

官方数据组件的 props 有两种形态，以 `data` 字段判别：

```tsx
<MetricScatter points="experiment" series="agent" x={costUSD} y={endToEndPassRate} />  // spec 形态
<MetricScatter data={await metricScatterData(scope, options)} />                    // data 形态
```

- **spec 形态**：计算选项直接作为 props，`input` 可省略、默认宿主注入的 Scope。管线在 resolve 阶段代为调用同名 `*Data` 函数——spec 形态与「先手工调 `*Data` 再传 `data`」严格等价，终值、覆盖率与 attempt 引用逐字段相同。
- **data 形态**：接收配套 `*Data` 函数算好的可序列化数据，跳过取数。它是显式降级口，服务三类场景：算完后用普通 JavaScript 加工（filter / slice / 排序）、把同一份数据写成 JSON 给 SPA、在没有 niceeval 解析阶段的自有 React 页面里渲染。同一组件同时给出 `data` 与 spec 字段时，按完整用户反馈报错，不静默取一边。

`*Data` 计算函数与组件成对导出——它们是双面组件解析面的具名形式（`MetricTable` / `metricTableData`、`ExperimentList` / `experimentListData`），只住在 `niceeval/report`。`niceeval/report/react` 只导出纯 web 渲染面：组件只收 `data`，不含任何读盘 / artifact 计算代码；spec 形态与组合组件只在报告树里成立。

resolve 在一次页渲染内按「同引用 `input` + 深相等 spec」记忆化：声明式重复同一 spec（如 `MetricMatrix` 与 `MetricBars` 消费同一矩阵）只计算一次，声明式写法不劣于手工共享数据。深相等只递归比较可序列化值；spec 里的函数与 `Metric` / `Dimension` / `NumericAxis` 实例按引用比较——共享计算的成立条件是引用同一实例（同一次 import 天然满足），引用不同的等价定义只是各算一次，不构成错误。

这个模型保证四条边界：

- 可达数百 MB 的 diff 只在 resolve 阶段被懒加载（经 `AttemptHandle`），不进入任何渲染调用。
- 计算产物永远是可序列化普通数据，可以在 RSC 中直接传递，也可以写成 JSON 给 SPA。
- text 与 web 面消费同一次 resolve 的产物，终值、覆盖率和 attempt 引用两面相同。
- 缺 artifact 时计算返回 `null`，渲染面不自行猜值。

## 报告树与两个宿主

报告树由 `Row`、`Col`、`Section`、`Text`、`Style`、`Tabs`、`Tab`、`Table` 等排版原语与双面组件、组合组件的节点组成；节点的穷尽形状（数组、Fragment、空分支的资格与裸字符串的拒绝）单点定义在 [Library · `ReportNode`](library/layout.md#树的节点reportnode)。宿主管线固定为：

```text
装载（规范化外壳与页列表，静态校验）
  → resolve（展开组合组件 + 执行 spec 形态取数；同层并行、保持声明顺序、按 (input, spec) 记忆化）
  → validate（展开后的树逐节点校验渲染面资格）
  → render（纯同步输出终端文本或静态 HTML）
```

- **resolve：** 页内唯一的异步 / IO 边界。递归展开组合组件（调用其函数并 await 返回树）、执行双面组件的解析面；同层 sibling 并行取数且不改变节点顺序。非法节点——React 组件、未经 `defineComponent` 的普通函数、任意 HTML intrinsic——在展开遇到时立即以完整用户反馈拒绝，不为非法节点取数。
- **validate：** 确保展开后树中每个组件都有 text 和 web 两面。校验只看节点资格，不限定树形：根节点可以是单个组件、`Col` 或 `Tabs`，宿主不强制任何最外层容器。
- **render：** 纯同步。text 面与 web 面消费同一棵已解析的树。

`defineComponent` 的对象形态要求同时给出 `text` 与 `web`，缺一面在定义时报错。因此任何可放入 `--report` 的组件都能被两个官方宿主判读；只用于用户网站的普通 React 组件不受这项约束，也不能进报告树。

## 外壳与页：装载规范化

`--report` 文件的默认导出恒为 `defineReport` 产物，产物只有一种：一层外壳（标题、外链、页脚、脚本、样式）加**非空页列表**——单页与多页不是两种机制，页数只是列表长度。入参有两级缩写，各有精确展开：

- 树入参是 `defineReport({ content: 树 })` 的缩写。
- `content: 树` 是 `pages: [{ id: "report", title: 内置页名「报告 / Report」, content: 树 }]` 的缩写。
- `content` 与 `pages` 恰好声明一个：同时声明或都省略，装载按完整用户反馈报错——省略不是一种有含义的取值，缩写的展开则完全由写下的值决定。

`defineReport` 产物只有一个去处：文件默认导出，交给宿主装载。页内复用的单位是组件与树的具名导出；`ReportDefinition` 不在 `ReportNode` 类型里，外壳不嵌套由类型天然保证——给一个报告文件加外壳永远不会破坏别处对它内容的复用，因为复用从不消费默认导出。

裸 `show` 与裸 `view` 不是第二条路径：宿主默认装载的就是 `niceeval/report/built-in` 的默认导出——内容为一行 `<ExperimentComparison />` 的普通 `defineReport`（见 [Library · 内建报告](library/built-in.md)），与任何 `--report` 文件走同一条 `装载 → resolve → validate → render` 管线。「builtin」不是装载逻辑里的类别，只是宿主默认拿哪个值的事实；标题取值链与 `Powered by niceeval` 页脚行因此对默认视图和自定义报告一致生效。字段穷尽见 [Library · 外壳与多页](library/shell.md)。

页层的边界规则：

- **页是宿主寻址单位。** 每页有唯一 id：`show --page <id>`、view 的 `#/page/<id>` 路由和导航项都用它。`Tabs` 是页内浏览状态，没有 id、路由或 CLI 选择器。这条分工决定内容放哪层：要能被单独打开、深链、在终端独立渲染的内容成为页；同页内的并列视图用 tab。
- **所有页共享同一 Scope。** 宿主完成范围收窄与现刻水位选择后，把同一份 Scope 注入每一页。页是对同一批数据的不同看法，不承担数据过滤职责。
- **管线以页为单位执行。** `resolve → validate → render` 逐页跑：本地 view 只 resolve 被打开的页，某页 resolve 或树校验失败时该页显示完整错误反馈，其它页照常可读；`show --page` 的目标页失败时非零退出；静态导出在写任何文件前 resolve 和校验全部页，任何一页失败都整体失败，不产出半套站点。外壳形状、page id 和资产路径是不需要 Scope 的静态信息，在装载期先校验；页内节点在 resolve 展开时逐个校验资格。
- **外壳是 web 面元数据，`title` 例外。** 双面同源约束只作用于页内报告树；外壳不携带数据。`show` 只把 `title` 用作页索引标题，`links`、`footer`、`scripts`、`styles` 不进 text 面。
- **自定义脚本属于增强层。** 与官方增强脚本同一不变量：初始静态 HTML 无 JS 完整可读，脚本只添加浏览行为，不改变计算口径或初始数据。这条不变量是对报告作者的义务约定，宿主不校验也无法校验脚本内容——脚本在读者浏览器里能做任何事，违反义务的站点其数字可信度由作者自己负责。注入顺序固定：官方样式 → 外壳 `styles`（声明序）→ 页面内容 → 官方增强脚本 → 外壳 `scripts`（声明序）。

外壳配置住在报告文件而不是 `niceeval.config.ts` 或快照里，因为它是「怎么看」的看法而非运行事实：改一个 GitHub 链接不应该要求重跑，也不应该改写任何落盘结果。快照里的 `name`（来自 `config.name`）仍是零配置时的身份兜底，定义的 `title` 覆盖它。

### 证据页不属于报告定义

view 的导航由两类项组成：报告页按声明序在前，内置 Attempts、Traces 证据页恒排其后。证据页由宿主拥有——不进 `pages`、不可移除、不可重排。三条既有不变量决定这个归属：证据室始终保留结果根的完整 attempt 集，而报告页共享的是收窄后的 Scope，若证据页是普通页，`#/attempt/@<locator>` 深链就会因首页收窄失效；页内组件受双面约束，而 Traces 瀑布没有独立成立的 text 面——终端侧对应能力由 `show` 以 attempt 为单位的证据切面提供；报告里每个数字能下钻到证据，依赖证据室恒在，这不交给报告作者配置。要在自定义页里做「最近失败」一类列表，用 `FailureList` / `AttemptList` 等报告组件，不需要证据页组件化。

### text 面的省略规则

两面同源不等于两面同长。数据组件在两个面输出同一份终值；web 的浏览增强（tab 切换、排序、过滤）在 text 面没有交互，但其覆盖的内容全量可读；纯视觉件（`Style`、`className`）与外壳的 web 字段（`links`、`footer`、`scripts`、`styles`、`Powered by niceeval` 行）在 text 面零输出。text 面折叠成索引的只有带可复制下钻命令的结构——可比组和页；tab 没有选择器，索引只能是死路，所以既不索引也不省略。

## `show` 与 `view` 的职责

两个宿主共享 Scope 与自定义报告协议，但默认首页和证据体验不同：

| 层 | `show` | `view` |
|---|---|---|
| 报告槽 | text 面 | static HTML web 面 |
| 默认填充 | `ExperimentComparison`：多组时只输出组索引与单组查看命令；单组时输出该组独立的成本 × 端到端成功率散点与 `ExperimentList` | 同一 `ExperimentComparison`：完整组索引 + 当前组独立的散点与可排序、可过滤 `ExperimentList` 固定列表格；切组不重新读取 Scope |
| attempt 下钻 | `niceeval show @<locator>` | `#/attempt/@<locator>` |
| 证据 | `--source` / `--execution` / `--timing` / `--diff` | Attempts / Traces / Attempt modal |
| 自定义 | `--report <file>`（单页或多页定义） | `--report <file>`（单页或多页定义） |
| 页选择 | `--page <id>`；多页定义默认只输出页索引与单页命令 | `#/page/<id>` 路由；`--page <id>` 定初始页 |

裸 `show` 与裸 `view` 只是在同一默认 definition 上选择不同渲染面；显式 `--report` 也替换同一个报告槽。`view` 的导航壳与证据室不属于报告树；attempt locator 仍由宿主注入，组件中的证据引用继续通向证据室。

## 指标聚合不变量

- `null` 表示测不了，不参与聚合；`0` 表示测得为零，正常参与。
- 一般指标先把同一 experiment × eval 的多个 attempt 折成题级值，再跨 experiment × eval 聚合，避免重试次数改变题目权重，也避免不同 experiment 的同名 eval 被误当成重试。
- 无限定词的“Pass rate / 成功率”和所有默认总览统一指 `endToEndPassRate`：`passed = 1`，`failed / errored = 0`，`skipped = null`，同一 experiment × eval 多轮先求均值，再跨 experiment × eval 求均值。多轮 attempt 的最终 Eval verdict 另按 `passed > failed > errored > skipped` 折叠（任一轮 passed 即 Eval passed），只用于判定构成和运行器结论，不从它反推另一个同名成功率。`taskPassRate` 是条件于已形成可信判定的诊断指标，必须带限定名称展示，不能作为默认排名或被简称为成功率。
- Scoreboard 的 `questions` 是必填固定题集；未跑题按 0 分并计入 `notRun`，跑了但指标为 `null` 的题同样按 0 分并计入 `unscorable`，两个计数不合并。组件不从已观测 attempt 的并集猜分母。
- 报告消费落盘 verdict，不重新判卷。
- 跨快照计算先按 Results 的 attempt 身份键去重。
- 每个 `MetricCell` 保留 `samples`、`total` 和完整 `refs`，覆盖率与证据链不可被渲染层丢弃。

## 静态网页

web 面先输出完整可读的静态 HTML。官方 CSS 使用稳定 `nre-*` 类名；`className` 和 `Style` 提供样式入口。增强脚本只增加临时排序、过滤和 tooltip，不改变计算口径或初始数据；站点的 `scripts` / `styles` 加入同一增强层并遵守同一不变量。`{src}` 资产在导出时按内容哈希写入 `assets/<sha256><ext>`，HTML 引用同步改写；同内容去重，同名文件不冲突。

组件的实体边界不限制其视觉形态。`ExperimentList` 仍然严格保持“一项一个 experiment、展开到 eval”的实体语义，但 web 面必须把顶层项渲染为带列头的固定比较表；不能因为组件名是 `List` 就退化成无列头的 flex 文本行。text 面可以采用紧凑列表，因为终端与网页的排版目标不同；两面共享的约束是组划分、数据、指标、排序基准和证据引用同源。web 的组选择器只是渐进增强：静态 HTML 必须保留每组完整内容，且任意时刻显示的图和表都只消费该组数据。

`view --out` 把报告 HTML、证据室壳和前端会读取的 artifact 一起导出。报告 HTML 不是结果格式，`__NICEEVAL_VIEW_DATA__` 也不是编程读取契约；程序消费结果应使用 `niceeval/results`。

## 相关阅读

- [README](README.md) —— 三种查看入口怎么选。
- [Library](library.md) —— 组件与组合配方。
- [Show](show.md) / [View](view.md) —— 两个官方宿主。
- [Results](../results/README.md) —— 持久化事实与 attempt 身份。
