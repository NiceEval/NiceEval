# Reports —— 架构

Reports 把同一份结果事实呈现到三个位置：终端宿主 `show`、网页宿主 `view`、用户自己的 React 页面。三者共用选择规则、指标与数据计算；`--report` 的自定义报告树可在两个官方宿主间复用。

```text
.niceeval/ ── openResults / Selection ── 组件.data() ── 可序列化数据
                                                        │
                         ┌──────────────────────────────┼────────────────────┐
                         ▼                              ▼                    ▼
                  report tree text 面 /          report tree web 面       React 组件
                  report tree text 面            niceeval view            用户页面
```

## 事实与看法

Results 保存事实：判定、断言、runner 时间树、事件、trace、diff 和运行元数据。Reports 只派生看法：指标、聚合、排序、图表和列表。Attempt 的统一时间视图属于宿主证据面:它读取 `phases` 作为生命周期/hook/command/turn 骨架,按 turn 的 `traceId` 临时挂接 `trace.json` spans；组合结果不写回任一 artifact。

派生数据不写回结果根，不带独立 schemaVersion。删除报告缓存后可从原始结果重新计算；跨部署保存组件 data 时，计算端与渲染端必须使用同一 niceeval 版本。

## Selection 是计算入口

所有官方 `.data(...)` 接受 `Selection | Snapshot[]`。Selection 同时携带快照和选择警告，避免报告把数据与“这批数据是否完整”的信息拆开。

`show` 与 `view` 对命令行范围使用同一套选择规则：

1. `--run` 确定结果根。
2. `--experiment` 和 eval id 位置参数收窄范围。
3. 宿主调用 `results.current()`——官方现刻水位口径（每个 experiment × eval 取「包含该 eval 的最新快照」里的 attempt），单点定义在 [Results · 官方现刻水位](../results/library.md#官方现刻水位resultscurrent)，宿主不自带第二套选择规则。
4. 局部补跑、过旧或未完成快照形成结构化 warning。
5. 同一份 Selection 交给各宿主默认首页或 `--report`。

报告若需要历史趋势，可从 `ReportContext.results` 自行选择 `Snapshot[]`；不能把宿主注入的现刻水位 Selection 当成完整历史。

## 可比组是默认报告的聚合边界

Experiment 的路径同时声明身份与可比性。默认 `ExperimentComparison` 从 experiment id 派生可比组键：有 `/` 时取完整父路径，没有 `/` 时取完整 id 并形成单例组。这个派生只依赖身份字段，不解析 agent、model、flags 或文件名后缀，也不把共同字符串前缀当成组。

分区发生在 Selection 已完成范围收窄和现刻水位选择之后、任何指标计算之前。每个组独立调用 `GroupSummary.data`、`MetricScatter.data` 与 `ExperimentList.data`；所以组外 attempt 不可能污染该组的坐标尺度、series 连线、成功率、成本、排序或缺数据计数。Selection warning 仍属于整份选择，宿主在组索引上方统一显示，不复制进每组。

这条隔离是不传 `--report` 时的产品契约，不是所有报告组件的全局魔法。`MetricScatter`、`MetricTable` 和 `ExperimentList` 仍忠实消费作者传入的数据；自定义报告可以为了横跨项目的分析显式合并组。默认报告不能这样做，因为 Experiments 已用“同一文件夹才互相对比”建立了可归因边界。

## 计算与渲染分离

组件的 `.data(...)` 是异步计算面，可以通过 `AttemptHandle` 懒加载 artifact。组件渲染面是同步纯函数，只接收计算完成的普通数据。

这条边界保证：

- 可达数百 MB 的 diff 不会意外进入每次 React render。
- 同一份 data 可以在 RSC 中直接传递，也可以写成 JSON 给 SPA。
- text 与 web 面拿到相同终值、覆盖率和 attempt 引用。
- 缺 artifact 时计算返回 `null`，渲染层不会自行猜值。

## 报告树与两个宿主

`defineReport` 的 build 函数返回由 `Row`、`Col`、`Section`、`Text`、`Style`、`Table` 和双面组件组成的树。宿主管线固定为：

```text
definition.build(ctx)
  → resolveReportTree(node)
  → validateReportTree(node)
  → render text 或 static HTML
```

- **build：** 报告作者可 `await` 数据、过滤数组、组合组件。
- **resolve：** 框架把 selection-form 组件解析成 data-form。当前 `MetricScatter` 可直接接 `selection`；实体列表需由作者显式调用 `.data()`，以便用普通数组 API 过滤。
- **validate：** 确保树中每个报告组件都有 text 和 web 两面，不接受任意 HTML intrinsic。
- **render：** 纯同步输出终端文本或静态 HTML。

`defineComponent` 要求同时定义 `text` 与 `web`。因此任何可放入 `--report` 的组件都能被两个官方宿主判读；只用于用户网站的普通 React 组件不受这项约束。

## 站点：页之上的宿主外壳

`--report` 文件的默认导出有两种形状，宿主按导出类型分派，共用同一个 flag：

- `defineReport(...)`：一棵报告树，填进宿主默认外壳的报告槽。
- `defineSite(...)`：若干个页（每页一个 `ReportDefinition`）加导航外壳元数据（标题、外链、页脚、脚本、样式）。字段形状见 [Library · 站点](library.md#站点多页与导航外壳)。

站点层的边界规则：

- **页是宿主寻址单位。** 每页有唯一 id：`show --page <id>`、view 的 `#/page/<id>` 路由和导航项都用它。`Tabs` 是页内浏览状态，没有 id、路由或 CLI 选择器。这条分工决定内容放哪层：要能被单独打开、深链、在终端独立渲染的内容成为页；同页内的并列视图用 tab。
- **所有页共享同一 Selection。** 宿主完成范围收窄与现刻水位选择后，把同一份 Selection 注入每一页的 build。页是对同一批数据的不同看法，不承担数据过滤职责。
- **管线以页为单位执行。** `build → resolveReportTree → validateReportTree → render` 逐页跑：本地宿主只 build 被打开的页，静态导出 build 全部页。本地某页 build 或校验失败时，该页显示完整错误反馈，其它页照常可读；静态导出遇到任何一页失败则整体失败，不产出半套站点。
- **外壳是 web 面元数据，`title` 例外。** 双面同源约束只作用于页内报告树；外壳不携带数据。`show` 只把 `title` 用作页索引标题，`links`、`footer`、`scripts`、`styles` 不进 text 面。
- **自定义脚本属于增强层。** 与官方增强脚本同一不变量：初始静态 HTML 无 JS 完整可读，脚本只添加浏览行为，不改变计算口径或初始数据。注入顺序固定：官方样式 → 站点 `styles`（声明序）→ 页面内容 → 官方增强脚本 → 站点 `scripts`（声明序）。

外壳配置住在报告文件而不是 `niceeval.config.ts` 或快照里，因为它是「怎么看」的看法而非运行事实：改一个 GitHub 链接不应该要求重跑，也不应该改写任何落盘结果。快照里的 `name`（来自 `config.name`）仍是零配置时的身份兜底，`site.title` 覆盖它。

## `show` 与 `view` 的职责

两个宿主共享 Selection 与自定义报告协议，但默认首页和证据体验不同：

| 层 | `show` | `view` |
|---|---|---|
| 报告槽 | text 面 | static HTML web 面 |
| 默认填充 | `ExperimentComparison`：多组时只输出组索引与单组查看命令；单组时输出该组独立的成本 × 端到端成功率散点与 `ExperimentList` | 同一 `ExperimentComparison`：完整组索引 + 当前组独立的散点与可排序、可过滤 `ExperimentList` 固定列表格；切组不重新读取 Selection |
| attempt 下钻 | `niceeval show @<locator>` | `#/attempt/@<locator>` |
| 证据 | `--eval` / `--execution` / `--timing` / `--diff` | Runs / Traces / Attempt modal |
| 自定义 | `--report <file>`（报告树或站点） | `--report <file>`（报告树或站点） |
| 站点页选择 | `--page <id>`；多页站点默认只输出页索引与单页命令 | `#/page/<id>` 路由；`--page <id>` 定初始页 |

裸 `show` 与裸 `view` 只是在同一默认 definition 上选择不同渲染面；显式 `--report` 也替换同一个报告槽。`view` 的导航壳与证据室不属于报告树；attempt locator 仍由宿主注入，组件中的证据引用继续通向证据室。

## 指标聚合不变量

- `null` 表示测不了，不参与聚合；`0` 表示测得为零，正常参与。
- 一般指标先把同一 eval 的多个 attempt 折成题级值，再跨 eval 聚合，避免重试次数改变题目权重。
- 无限定词的“Pass rate / 成功率”和所有默认总览统一指 `endToEndPassRate`：`passed = 1`，`failed / errored = 0`，`skipped = null`。`taskPassRate` 是条件于已形成可信判定的诊断指标，必须带限定名称展示，不能作为默认排名或被简称为成功率。
- Scoreboard 使用固定题集分母，未跑题按 0 分并计入 `missing`；这是其显式考试语义。
- 报告消费落盘 verdict，不重新判卷。
- 跨快照计算先按 Results 的 attempt 身份键去重。
- 每个 `MetricCell` 保留 `samples`、`total` 和完整 `refs`，覆盖率与证据链不可被渲染层丢弃。

## 静态网页

web 面先输出完整可读的静态 HTML。官方 CSS 使用稳定 `nre-*` 类名；`className` 和 `Style` 提供样式入口。增强脚本只增加临时排序、过滤和 tooltip，不改变计算口径或初始数据；站点的 `scripts` / `styles` 加入同一增强层并遵守同一不变量，`{src}` 资产随静态导出复制进 `assets/`。

组件的实体边界不限制其视觉形态。`ExperimentList` 仍然严格保持“一项一个 experiment、展开到 eval”的实体语义，但 web 面必须把顶层项渲染为带列头的固定比较表；不能因为组件名是 `List` 就退化成无列头的 flex 文本行。text 面可以采用紧凑列表，因为终端与网页的排版目标不同；两面共享的约束是组划分、数据、指标、排序基准和证据引用同源。web 的组选择器只是渐进增强：静态 HTML 必须保留每组完整内容，且任意时刻显示的图和表都只消费该组数据。

`view --out` 把报告 HTML、证据室壳和前端会读取的 artifact 一起导出。报告 HTML 不是结果格式，`__NICEEVAL_VIEW_DATA__` 也不是编程读取契约；程序消费结果应使用 `niceeval/results`。

## 相关阅读

- [README](README.md) —— 三种查看入口怎么选。
- [Library](library.md) —— 组件与组合配方。
- [Show](show.md) / [View](view.md) —— 两个官方宿主。
- [Results](../results/README.md) —— 持久化事实与 attempt 身份。
