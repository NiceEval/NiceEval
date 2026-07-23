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

## 共享内核与两个宿主的代码边界

`Reports` 是功能总称，包含 `show`、`view` 和可编程的 `niceeval/report`；单数的 `report` 不是 `show` 或 `view` 的别名，而是两个宿主共用的报告内核。报告的内容单位只有 page，page 的内容单位只有组件树。view 没有一套 page 之外的“attempt 证据面”：attempt 的事实由 Results 提供，详情只是以 locator 为输入的一张参数化 page。

```text
niceeval/results ── Scope / AttemptEvidence ──▶ niceeval/report ──┬── text 面 ──▶ show
                                                               └── web 面  ──▶ view
```

| 所有者 | 责任 |
|---|---|
| `niceeval/report` | `ReportDefinition` / page / 报告树的唯一模型；静态页与参数化页的装载、规范化与 resolve；Scope / AttemptEvidence 注入；指标、维度和可序列化组件数据；text / web 两个渲染面；内建报告；官方样式与渐进增强资产。 |
| `show` | 终端宿主：范围 / 切片 / 形态的 CLI 输入组合、page / locator 寻址与 text 输出。切片不是宿主内容——每个切片都解析为报告组件的装配（见[「show 的切片是组件选择」](#show-的切片是组件选择)），show 保留的是 flag 解析、逐 attempt 分节映射与 text 渲染的机器。`show @<locator>` 是选择 attempt-input page 并传入 locator 的快捷语法。 |
| `view` | 网页宿主：站点产物清单、本地服务与静态导出、page 路由、导航、语言切换与 artifact 交付。所有 HTML 都是 `niceeval/report` 的 page 输出；view 可把参数化详情页渐进增强成 modal，但不拥有固定 modal 内容。 |
| `niceeval/results` | 持久化事实、Scope 选择、locator 解析与中性 `AttemptEvidence` 装配。两宿主与 report 组件共用同一份证据模型，不各自重读 artifact 或重建时间树。 |

依赖方向只能从宿主指向 `niceeval/report` 和 `niceeval/results`。`show` 与 `view` 之间不互相 import；两者都需要的报告装载、规范化、标题回退、静态 / 参数化 page 解析或渲染适配属于 report，共用的结果事实与证据投影属于 Results。“先放在某个宿主里、另一宿主反向 import”不是共用机制。

### 单一 report runtime 身份

`niceeval/report`、`niceeval/report/react` 与 `niceeval/report/built-in` 是同一个 package-owned 构建单元的三个入口。官方宿主通过一个中性的 host facade 调用这个构建单元；装载、`ReportDefinition` 品牌、resolve 状态和 text / web 渲染都来自同一个物理 runtime。

同一进程不混用 raw `src/report/**` 与预编译产物的两份模块实例，宿主也不通过多处相对路径直接探测构建目录。构建产物缺失或过期是构建失败，不由宿主保留旧 `ReportDefinition` 形状、重复类型或运行时 fallback 来遮蔽。

### 内部按功能纵切

公开入口保持 `niceeval/report`、`niceeval/report/react` 与 `niceeval/report/built-in` 的扁平使用面；源码内部按责任与组件族分层，不把所有组件的计算、类型、text 面和装配继续堆进各自的横切大文件：

```text
report/
├── definition/                 ReportDefinition、页、外壳、报告树与组件协议
├── model/                      跨组件共用的 Metric、Dimension、聚合与格式化原语
├── components/                 跨组件族共用的数据组件协议（spec/data 校验、构造、hrefOf/ChromeProps）
│   │                            与文案惯例（缺数据/覆盖率展示、attempt 统计与筛选口径）
│   ├── summaries/              ScopeSummary / ExperimentComparison
│   ├── entity-lists/           Experiment / Eval / Attempt / Failure 列表
│   ├── metric-views/           Table / Matrix / Bars / Scoreboard / Scatter / Line / Delta
│   ├── attempt-detail/         Summary / Error / Assertions / Source / FixPrompt / Timeline /
│   │                            Conversation / Diagnostics / Usage / Trace / Diff
│   └── site-components/        Hero / Warnings / SnapshotDiagnostics / CopyFixPrompt / TraceWaterfall
├── runtime/                    装载、resolve、validate、text/web 渲染与 host facade
├── built-in/                   只用公开组件装配的内建报告
└── assets/                     官方样式、渐进增强与共享设计令牌入口
```

每个组件族在自己的边界内完成“数据契约 → `*Data` 计算 → spec/data 装配 → text 面 → web 面 → 样式”。与数据模型无关、但被两个以上组件族复用的组件层原语（数据组件构造协议、文案惯例、统计口径）留在 `components/` 根目录，不归属某一族；真正与组件形态无关的计算与格式化原语才下沉到 `model` / `definition`。`runtime` 可以依赖 definition、model 和 components；组件计算与渲染面不反向依赖宿主或 runtime 的 IO 编排。

### Attempt 详情是一张参数化 page

`ReportDefinition` 只有一个非空 `pages` 列表，不再在旁边增加 `attempt`、`modal` 或其它内容槽。page 按输入分两种形态，但仍是同一个类型族、走同一条 `resolve → validate → render` 管线：

- `input` 省略或为 `"scope"`：静态 page，消费宿主选择的 Scope；默认进入导航。
- `input: "attempt"`：以 locator 为参数的 page，消费 Results 装配的一份 `AttemptEvidence`；必须 `navigation: false`，因为没有 locator 时不能打开，也不应出现在全局导航。

一份报告至多声明一张 attempt-input page，避免 `show @<locator>` 与 locator 链接出现多个目标。报告未声明它时 locator 只是普通文本，宿主不悄悄补一张官方详情页。view 的 locator URL 与 `show @<locator>` 只是定位这张 page 并传参的宿主语法，不构成第二种内容模型。

内建 `standard` 的 `pages` 因而有四项：报告、Attempts、追踪三张导航页，以及一张 `id: "attempt"`、`input: "attempt"`、`navigation: false` 的参数化页。它的 `content` 是普通 [`AttemptDetail`](library/attempt-detail.md) 组合组件；`AttemptDetail` 与 `ExperimentComparison` 同级，都只用公开叶子组件装配，没有私有 renderer。用户可以直接用成品组合，也可以在该 page 的 `content` 里用 `AttemptSummary`、`AttemptAssessment`、`AttemptTimeline` 等区块重新组装。

view 只保留 page 寻址、locator 历史记录与内容摆放机制。它可把已渲染的参数化 page 渐进增强成 dialog，但 dialog 内部的区块、顺序、样式和取舍全部来自 page content。本地模式与静态导出对同一 locator 物化相同字节的独立 page 文档；基线链接直接指向该文档，所以无 JavaScript 仍能打开，JavaScript 只拦截链接并把同一内容放进 dialog，不另造一份内容实现。`show @<locator>` 渲染同一 page 的 text 面；`--source` / `--execution` / `--timing` / `--diff` 选择 attempt-detail 组件族对应区块的 text 面（见下节）。

### show 的切片是组件选择

show 的每个切片都解析为报告组件的装配，`--json` 输出该视图组件 resolve 产物的信封包装——「text 面与 JSON 共有派生字段同值」因此由构造保证（同一次 resolve 的产物），不是两套手写投影之间的纪律：

| 切片 | 组件（+ 配套 `*Data`） |
|---|---|
| 缺省榜单 | 内建报告首页（`ExperimentComparison` / `ExperimentList`） |
| 对照矩阵（多 `--exp`） | `DeltaTable`（多条件对照：翻转标记、各条件汇总、共同题 paired delta） |
| `--stats` | `StabilityMatrix`（历史全执行证据面的稳定性矩阵） |
| `--usage` | `UsageTable`（与 attempt 详情 `usage:` 行共享组装口径单源） |
| 缺省 attempt 首页与 `--source` / `--execution` / `--timing` / `--diff` | attempt-detail 组件族（`AttemptDetail` 及其区块） |

- scope 级切片消费宿主注入的 Scope；证据切片消费 locator 解析出的 `AttemptEvidence`。范围含多个 attempt 时，宿主机器把同一组件逐 attempt 映射并分节——分节是宿主机器，节内内容仍由组件拥有。
- 终端专属行为——卡片预览预算、`--expand` 句柄、`--grep`——是这些组件 **text 渲染面的选项**，不是事实过滤器；JSON 面恒为完整 resolve 产物。「`--json` 不受 text 预算约束」「`--expand` 与 `--json` 组合是用法错误」由此成为推论而非特判。
- `--json` 的信封见 [Show `--json`](show/json.md)；逐视图 data 形状单源在各组件分篇的 `*Data` 声明，json 页只保留信封与指针，不手写第二套形状。
- CLI 缺省切片与报告库组件因此不是两套实现：终端矩阵与报告页矩阵是同一组件的两处装配，语义与数字必然一致。

## 事实与看法

Results 保存事实：判定、断言、runner 时间树、事件、trace、diff 和运行元数据。`loadAttemptEvidence` 把一个 attempt 的 locator、身份、主记录、标注源码、执行树、trace、diff、artifact 路径与能力位一次装成中性 `AttemptEvidence`；report 组件和宿主不各自重读 artifact。Reports 只派生看法：指标、聚合、排序、图表、列表和 attempt 详情布局。Attempt 的统一时间视图以 `phases` 作为生命周期/hook/command/turn 骨架，按 turn 的 `traceId` 临时挂接同一份 evidence 中的 spans；组合结果不写回任一 artifact。

派生数据不写回结果根，不带独立 schemaVersion——支持口径是同一 niceeval 版本写读，删除报告缓存后可从原始结果重新计算。渲染面消费 `data` 时校验结构，不符合当前版本的形状按完整用户反馈报错并提示可能的版本漂移；漂移因此以显式错误浮出，不静默错渲染。

## Scope 是计算入口

所有官方 `*Data(input, options?)` 计算函数接受 `ReportInput = Scope | readonly Snapshot[]`。Scope 同时携带真实快照、覆盖事实（coverage）和选择警告，避免报告把数据与“这批数据是否完整”的信息拆开。warning 的呈现件是 [`ScopeWarnings`](library/site-components.md#scopewarnings)，快照实体上开放词表 diagnostics 的呈现件是 [`SnapshotDiagnostics`](library/site-components.md#snapshotdiagnostics)；宿主不在报告树外另设通道，[内建报告](library/built-in.md)的三张 scope-input page 都相邻放置两者（attempt-input page 不重复站点范围信息），自定义报告放不放是作者义务。`SnapshotDiagnostics` 对 Scope 只投影 `scope.snapshots`，对裸 `Snapshot[]` 同样工作；它的 data 形态只携带 experimentId、startedAt 与 DiagnosticRecord[]，不把 Snapshot 拖进浏览器。覆盖缺口由 `experimentListData` 消费成占位行、时效由 attempt 行的时效标注呈现（见[实体列表](library/entity-lists.md)），指标与列表组件的数据不复制 warning 或 diagnostic。

指标与列表组件的数据样本一律来自 `Scope.attempts`——按 `current()` / `latest()` 口径挑好的 attempt 全集，组件不各自 `flatMap` `snapshots` 重新展开，避免同一道题的历史 attempt 被不同组件用不同口径重复计入或漏算。配置（agent / model / flags / sandbox 等）、diagnostics 与快照目录这类**快照级**信息来自真实 `Scope.snapshots`。`current()` 下同一个 experiment 可能有多个贡献 Snapshot（不同 eval 取自不同历史快照，见 [Results · 官方现刻水位](../results/library.md#官方现刻水位resultscurrent)）；此时该 experiment 展示用的“水位基准 Snapshot”是这些贡献来源里 `startedAt` 最新的一个——表头、hero 与 `config()` 桥接读取的 agent / model / flags 都以这一个为准，不是任取某个来源或合并多个来源的字段。

`show` 与 `view` 对命令行范围使用同一套选择规则：

1. `--results` 确定结果根。
2. `--exp` 和 eval id 位置参数收窄范围。
3. 宿主调用 `results.current()`——官方现刻水位口径（每个 experiment × eval 取「包含该 eval 的最新快照」里的 attempt），单点定义在 [Results · 官方现刻水位](../results/library.md#官方现刻水位resultscurrent)，宿主不自带第二套选择规则。
4. 局部补跑、过旧或未完成快照形成结构化 warning。
5. 同一份 Scope 交给各宿主默认首页或 `--report`。

宿主把这份 Scope 注入每张 scope-input page：其中数据组件的 `input` 默认就是它，组合组件从 ctx 拿到它。attempt-input page 仍可从 ctx 读取站点 Scope，但详情叶子的默认输入是 `ctx.page.evidence`，两者由 page input 判别，不靠猜测。报告若需要历史趋势，可从组合组件 ctx 的 `results` 自行选择 `Snapshot[]`；不能把宿主注入的现刻水位 Scope 当成完整历史。

## Scope 是默认报告的比较边界

`experimentListData`、`scopeSummaryData` 与 `metricScatterData` 不推导第二层实验组，直接消费宿主已经收窄并完成现刻水位选择的 Scope；每个 experiment 当前有效的 eval 集从 `Scope.coverage` 读取——该 experiment 的 `knownEvalIds` 去掉 `missingEvalIds` 就是当前口径下真正有判定的分母（已经过 `--exp` / 位置参数范围收窄）；`missingEvalIds` 本身进入榜单占位行，不进分母也不补成失败。这条读法不依赖任何单一快照的 `ExperimentRunInfo.selectedEvalIds`——`current()` 下一个 experiment 的有效题集由多个贡献 Snapshot 共同撑起，没有哪一个来源的 `selectedEvalIds` 能单独代表它。这是三个函数自己的契约：直接调用与经 `ExperimentComparison` 展开后走到的调用深相等。

`ScopeSummary`、`MetricScatter` 与 `ExperimentList` 都消费同一份 Scope。用户用 `--exp` 按 experiment id 路径收窄，或在自定义报告里显式 `filter`；组件不从路径、文件名、agent、model、flags 或 labels 猜比较边界。

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

报告树由 `Row`、`Col`、`Grid`、`Section`、`Stat`、`Text`、`Style`、`Tabs`、`Tab`、`Table` 等排版原语与双面组件、组合组件的节点组成；节点的穷尽形状（数组、Fragment、空分支的资格与裸字符串的拒绝）单点定义在 [Library · `ReportNode`](library/layout.md#树的节点reportnode)。宿主管线固定为：

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

### 排版原语的语义层与面内布局

排版原语不把终端字符布局和浏览器像素布局强行做成同一份几何结果。两面共享的是节点顺序、分组、字段终值和降级不变量；各面再用自己的宽度单位排版：text 面使用终端显示列，web 面使用 CSS container 的可用 inline size。`show` / `view` 只提供可用宽度或承载 HTML，不参与 Grid、Stat、Section 的布局决策。

`Grid` 固定走下面的内部边界：

```text
resolved ReportNode children
  → normalizeGrid（校验 props；递归展开数组 / Fragment；去掉空分支）
  → NormalizedGrid（有序、不可拆的 cell 列表 + columns / variant / density）
       ├─ text：planTextGrid(available columns) → TextGridPlan → 逐 cell ctx.render(width)
       └─ web：稳定 root / cell 语义结构 → CSS Grid 按 container width 自动排轨
```

`NormalizedGrid` 不是公开 data shape，也不进入结果或 artifact；它只是两个渲染面共享的同步排版中间值。每个展开后的直接子节点是一格，格内节点对 Grid 是不透明块：`Col` 内的多个 `Stat` 始终跟着该格移动，响应式减列不能拆开；任意自定义双面组件也不需要实现 Grid 私有协议。Grid 不探测领域字段、不读取 Scope，也不根据内容类型改写子节点 props。

text 面的 `TextGridPlan` 是确定的纯值，至少携带实际列数、各 cell 的外框 / 内容显示宽度、row-major 的 cell 索引和 gutter。规划器只依赖 `availableWidth`、cell 数和规范化 Grid props：先预留 `boxed` 的四边框、左右 padding 与格间 gutter，再从 `min(columns, cellCount)` 向一列尝试，选择每格达到契约最小可读内容宽度的最大列数；一列是无条件 fallback。余下的显示列从左向右分配，因整除产生的一列宽差不会累积到行尾。确定计划后才以各格的内容宽度调用 `ctx.render`，随后按显示宽度补齐并顶对齐多行块；renderer 不为试探列数重复 resolve 或执行组件计算。`boxed` 把每个 cell 各自包成完整 `┌─┐ / │ │ / └─┘`，同行 box 只用 gutter 相隔，换排重新起 box；`plain` 复用同一计划，只去掉边框与内边距。

web 面输出完整有序 cell 和声明的最大列数事实，由官方 stylesheet 用 CSS Grid 的 `auto-fit` / `minmax` 与 container inline size 减列；不读 viewport、不测 DOM、不靠增强脚本重排。最大列数通过一个受控 CSS custom property 传给 stylesheet，用每格最小 inline size 同时保证“最多 columns 列”和窄容器降到一列。无 JavaScript 时节点、顺序与全部文本已经完整。`boxed` 给每个 `.nre-grid-cell` 独立的完整四边框并用 gap 分开；`Col` 无框。这样响应式换行不需要判断首列 / 末列，也不用写死 `nth-child(6n)`，不会因实际列数变化产生缺边或双边。

`Stat` 在进入任一面前用同一 helper 解析为 `StatDisplay`：按 locale 得到 label / value / detail，number 用同一 `Intl.NumberFormat`，`null` 变成 `—`，tone 原样保留。两面只决定结构和折行，不再各自解释字段。label、value、detail 都按 inline-start 对齐；web 只给 value 使用 tabular numerals 和 tone，text 无 ANSI 时仍靠三行语义自足。text Grid 只把 Stat 当成普通多行块：label → value → detail，省略 detail 不占行；字段超过计划宽度时用统一显示宽度工具折行。

这条边界对应的物理实现固定为：`src/report/definition/grid-layout.ts` 放 `normalizeGrid` 与 text plan 纯函数，`src/report/definition/primitives.tsx` 只声明 Grid / Stat / Section 及两面适配，`src/report/model/text-layout.ts` 保持 CJK 计宽、折行和补齐的底层工具，`src/report/assets/styles.css` 负责 web 几何与视觉。不得把规划器放进 `src/show/**`、`src/view/**`，也不得让 CSS 反向决定 text 输出。

## 外壳与页：装载规范化

`--report` 文件的默认导出恒为 `defineReport` 产物，产物只有一种：一层外壳（标题、外链、页脚、主题、脚本、样式）与**非空 page 列表**——单页、多页与参数化详情都不换机制，差别只在 page 数量和输入。入参的页内容有两级缩写，各有精确展开：

- 树入参是 `defineReport({ content: 树 })` 的缩写。
- `content: 树` 是 `pages: [{ id: "report", title: 内置页名「报告 / Report」, content: 树 }]` 的缩写。
- `content` 与 `pages` 恰好声明一个：同时声明或都省略，装载按完整用户反馈报错——省略不是一种有含义的取值，缩写的展开则完全由写下的值决定。
- 树 / `content` 缩写展开出的 page 是 `input: "scope"`、`navigation: true`；它不会偷带参数化详情。要有 locator 详情，就在 `pages` 中显式声明一张 attempt-input page，或 `extends: standard` 继承内建全部 pages。

`defineReport` 产物只有一个去处：文件默认导出，交给宿主装载。页内复用的单位是组件与树的具名导出；`ReportDefinition` 不在 `ReportNode` 类型里，外壳不嵌套由类型天然保证——给一个报告文件加外壳永远不会破坏别处对它内容的复用，因为复用从不消费默认导出。

裸 `show` 与裸 `view` 不是第二条路径：宿主默认装载的就是 `niceeval/report/built-in` 的默认导出——报告、Attempts、Traces 三张导航 page 加一张参数化详情 page 的普通 `defineReport`（全文见 [Library · 内建报告](library/built-in.md)），与任何 `--report` 文件走同一条 `装载 → resolve → validate → render` 管线。「builtin」不是装载逻辑里的类别，只是宿主默认拿哪个值的事实。

页层的边界规则：

- **页是宿主寻址单位。** 每页有唯一 id：`show --page <id>`、view 的 `#/page/<id>` 路由和导航项都用它。`Tabs` 是页内浏览状态，没有 id、路由或 CLI 选择器。这条分工决定内容放哪层：要能被单独打开、深链、在终端独立渲染的内容成为页；同页内的并列视图用 tab。
- **所有 scope-input pages 共享同一 Scope。** 宿主完成范围收窄与现刻水位选择后，把同一份 Scope 注入这些 pages；attempt-input page 则额外接收 locator 对应的一份 `AttemptEvidence`。page 不承担数据过滤职责。
- **管线以 page 实例为单位执行，产物清单与内容求值分离。** `SitePlan` 是一份路径到内容产出器的清单；本地 server 与 `--out` 共享同一份清单和同一套产出器——给定同一输入，同一路径最终字节恒相同，区别只在求值时机与失败的影响范围：
  - **求值时机。** 本地 server 按收到的请求求值对应路径的产出器，并缓存进当前 plan，同一 server 生命周期内同一路径不重复计算；`writeSite` 在写任何文件前对清单中的每个产出器求值一次。
  - **失败隔离的单位是 page 实例，不是文件。** `index.html` 由全部 scope-input page 各自独立的实例拼装而成——某个 scope-input page 实例 resolve 失败时，该实例的槽位显示完整错误反馈，其它 scope-input page 实例仍正常出现，不因共享同一份文件而互相污染；`attempt/<locator>.html` 每份文件对应恰好一个 attempt-input page 实例，resolve 失败即该文件整体给出错误反馈。
  - **`writeSite` 的整体失败语义。** 静态导出对清单中的每个产出器求值——即全部 scope-input page 实例与全部可达 locator 的 attempt-input page 实例；任一次求值失败，整体导出失败、不留半套目录。本地 server 按请求求值，某个路径求值失败不影响已经服务过的其它路径。

  外壳、page id、输入声明与导航资格在装载期先校验；content 在 resolve 展开时逐节点校验。
- **外壳是 web 面元数据，`title` 例外。** 双面同源约束只作用于页内报告树；外壳不携带数据。`show` 只把 `title` 用作页索引标题，`links`、`footer`、`theme`、`scripts`、`styles` 不进 text 面。
- **主题与自定义资产属于视觉 / 增强层。** `theme` 只规范化为宿主 chrome 与报告组件共用的 CSS 语义令牌，不进 `ctx.report`、不改变组件树或计算口径；精确色槽、Library DX 与样式级联见[主题与 CSS](library/theme.md)。自定义脚本与官方增强脚本遵守同一不变量：初始静态 HTML 无 JS 完整可读，脚本只添加浏览行为，不改变计算口径或初始数据。这条不变量是对报告作者的义务约定，宿主不校验也无法校验脚本内容——脚本在读者浏览器里能做任何事，违反义务的站点其数字可信度由作者自己负责。

外壳配置住在报告文件而不是 `niceeval.config.ts` 或快照里，因为它是「怎么看」的看法而非运行事实：改一个 GitHub 链接不应该要求重跑，也不应该改写任何落盘结果。快照里的 `name`（来自 `config.name`）仍是零配置时的身份兜底，定义的 `title` 覆盖它。

### 宿主保留的只有机器

报告定义拥有全部 page 内容——包括裸宿主导航里的 Attempts、Traces 与 locator 打开的参数化详情页：它们都是[内建报告](library/built-in.md)显式声明的普通 page + 组件树，换 `--report` 后要不要它们由报告文件决定。宿主没有保留内容，保留的是机器加一个恒定品牌位，清单穷尽如下：

- **管线与路由**：装载 → resolve → validate → render、`#/page/<id>` / `--page` 页寻址、导航条的渲染（渲染什么完全由页列表与外壳声明决定）、语言切换。
- **参数化 page 寻址与摆放**：`view` 解析 locator URL、`show` 解析 `@<locator>`，选择报告中唯一的 attempt-input page，并把 locator 解析为 `AttemptEvidence` 注入该 page；宿主不在 page content 外追加断言、时间、对话、trace 或 diff 区块。show 的切片 flag 解析与多 attempt 范围的逐 attempt 分节映射同属机器（内容归组件，见[「show 的切片是组件选择」](#show-的切片是组件选择)）。本地 view 与 `show` 按它们各自的结果根语义寻址；导出站只携带有效根内的证据，范围外 locator 如实显示缺失。
- **文档单例**：浏览器 `<title>`（消费外壳 `title` 的回退链）、`meta charset` / `viewport`。
- **品牌位**：`view` 页头左端恒定的 NiceEval 字标（45° 方块 mark + 文字），外链官网、带 `utm_medium=brand`。它是产品品牌位，报告定义不能覆盖或移除；与页内 `PoweredBy` 品牌行同族（`utm_medium=powered-by` 区分点击来自哪个位）。报告 `title` 的落点是页内 hero 与浏览器 `<title>`，不进这个品牌位。

scope-input page 与 attempt-input page 是 page 协议的两个明确输入分支，不靠宿主内容特例调和。Traces 的 text 面同样不是特例——`TraceWaterfall` 的 text 面是带 `--timing` 下钻命令的 attempt 索引（[契约](library/site-components.md#tracewaterfall)），符合「索引终结于可执行命令」的省略规则。

### text 面的省略规则

两面同源不等于两面同长。数据组件在两个面输出同一份终值；web 的浏览增强（tab 切换、排序、过滤）在 text 面没有交互，但其覆盖的内容全量可读；纯视觉与纯 web 操作件在 text 面零输出。text 面只把页与 `TraceWaterfall` 的 attempt 行折成带命令的索引；tab 没有选择器，所以不索引也不省略。

## `show` 与 `view` 的职责

两个宿主共享 Scope 与自定义报告协议，但默认首页和证据体验不同：

| 层 | `show` | `view` |
|---|---|---|
| 报告槽 | text 面 | static HTML web 面 |
| 默认填充 | [内建报告](library/built-in.md)首页：`ExperimentComparison` 输出当前 Scope 的摘要、成本 × 主读数散点（通过制通过率 / 计分制总分，[映射单点](library/metrics.md#题型构成与主读数)）与 `ExperimentList`；尾部附 Attempts / Traces 页索引 | 同一内建报告：`ExperimentComparison` 输出同一份摘要、散点与可排序、可过滤的 `ExperimentList` |
| attempt 下钻 | `niceeval show @<locator>` | `#/attempt/@<locator>` |
| attempt 内容 | 同一 report definition 中 attempt-input page 的 text 面；显式 flag 选择 attempt-detail 组件区块的 text 面 | 同一 page 的 web 面；可渐进增强为 dialog |
| 自定义 | `--report <file>` 替换整份 page 声明 | `--report <file>` 替换整份 page 声明 |
| 页选择 | `--page <id>`；渲染初始页，多页时尾部附其余页索引 | `#/page/<id>` 路由；`--page <id>` 定初始页 |

裸 `show` 与裸 `view` 只是在同一默认 definition 上选择不同渲染面；显式 `--report` 替换同一个 page 列表。`view` 的导航条、locator 寻址和 dialog 摆放是机器不是内容（[边界清单](#宿主保留的只有机器)）；组件中的证据引用只在当前定义声明了 attempt-input page 或显式 `attemptHref` 时成为 web 链接。

## 指标聚合不变量

- `null` 表示测不了，不参与聚合；`0` 表示测得为零，正常参与。
- 一般指标先把同一 experiment × eval 的多个 attempt 折成题级值，再跨 experiment × eval 聚合，避免重试次数改变题目权重，也避免不同 experiment 的同名 eval 被误当成重试。
- 无限定词的“Pass rate / 通过率”和所有默认总览统一指 `endToEndPassRate`：`passed = 1`，`failed / errored = 0`，`skipped = null`，同一 experiment × eval 多轮先求均值，再跨 experiment × eval 求均值。完整口径名是“End-to-end pass rate / 端到端通过率”，默认组件使用前述短标签。多轮 attempt 的最终 Eval verdict 另按 `passed > failed > errored > skipped` 折叠（任一轮 passed 即 Eval passed），只用于判定构成和运行器结论，不从它反推通过率。`taskPassRate` 是条件于已形成可信判定的诊断指标，必须带限定名称展示，不能作为默认排名或被简称为通过率。
- Scoreboard 的 `questions` 是必填固定题集；未跑题按 0 分并计入 `notRun`，跑了但指标为 `null` 的题同样按 0 分并计入 `unscorable`，两个计数不合并。组件不从已观测 attempt 的并集猜分母。
- 报告消费落盘 verdict，不重新判卷。
- 跨快照计算先按 Results 的 attempt 身份键去重。
- 每个 `MetricCell` 保留 `samples`、`total` 和完整 `refs`，覆盖率与证据链不可被渲染层丢弃。

## 静态网页

web 面先输出完整可读的静态 HTML。官方 CSS 使用稳定 `nre-*` 类名；`className` 和 `Style` 提供样式入口。增强脚本只增加临时排序、过滤和 tooltip，不改变计算口径或初始数据；站点的 `scripts` / `styles` 加入同一增强层并遵守同一不变量。`{src}` 资产在导出时按内容哈希写入 `assets/<sha256><ext>`，HTML 引用同步改写；同内容去重，同名文件不冲突。

CSS 的作者工具是内部实现选择：可以手写 CSS，也可以用 Tailwind 或其它构建时工具；对外契约始终是一份随包发布、可独立加载的已生成 CSS，消费方不需要安装或运行同一构建工具。`nre-*` 是组件结构与 cascade 覆盖的稳定语义入口，utility class 可作为内部生成细节，不取代这些公开覆盖点。

report 组件与 view 宿主使用同一份设计令牌源，不在两份样式表里手工复制颜色、线条、字体或状态值。生成的 report stylesheet 在每个 `var(--nre-*, <default>)` 使用点携带同源默认值，因此仍能独立嵌入任意宿主；view 把规范化 `theme` token 挂到站点根，由 `.nre` 报告边界继承，只为导航、路由与 dialog 摆放增加宿主样式，不复制 report 组件规则。官方 stylesheet 与增强 runtime 作为 report 构建单元的资产产出，宿主不从 raw 源码路径读取它们。公开 `--nre-*` token 与覆盖层次见[主题与 CSS](library/theme.md)。

组件的实体边界不限制其视觉形态。`ExperimentList` 保持“一项一个 experiment、展开到 eval”的实体语义，web 面渲染为带列头的固定比较表，text 面采用紧凑列表。两面共享数据、指标、排序基准和证据引用。

`view --out` 把报告页、报告定义为每个可达 attempt 渲染的独立详情文档和前端会读取的 artifact 一起导出。报告 HTML 不是结果格式，`__NICEEVAL_VIEW_DATA__` 也不是编程读取契约；程序消费结果应使用 `niceeval/results`。

## 相关阅读

- [README](README.md) —— 三种查看入口怎么选。
- [Library](library.md) —— 组件与组合配方。
- [Show](show.md) / [View](view.md) —— 两个官方宿主。
- [Results](../results/README.md) —— 持久化事实与 attempt 身份。
