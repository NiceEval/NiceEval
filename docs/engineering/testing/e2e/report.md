# 功能域 · 报告与读面

本域回答一个问题：**一次真实运行落盘的结果、对外的机器出口，以及用户在 show / view 里看到的读面与渲染，是否符合公开契约。** 它由 `e2e/report/` 仓库承担（group `report`）。适配器仓库不复制格式知识，读结果只走公开读取面（见[总则 · Results 读取边界](README.md#42-results-读取边界)）。

仓库使用真实 Agent 与真实模型产生结果——真实优先没有例外。稳定性来自断言对象：只对这次运行的产物做确定性断言（文件集合、字段形状、口径一致性、渲染结构与排版），不断言模型输出质量。一次真实运行产出的证据被下面全部验收组共用，断言条数不增加模型成本。

## 验收计划

仓库运行一个小型真实 Experiment，覆盖 passed / failed / errored 三态 attempt，然后对同一份事实逐出口核对：

### 1. 落盘格式

`snapshot.json`、attempt 目录的 `result.json`、`events.json`、`sources.json`、`o11y.json`（有 tracing 面时含 `trace.json`）的字段与版本依据 [Results Format](../../../feature/results/architecture.md) 契约逐项断言——`verdict` 四态、断言明细、`durationMs` / `usage` / `estimatedCostUSD` 三件套成组出现、`snapshot.json` 不含逐 attempt 数据。

### 2. 公开读取面

`openResults()` 遍历出的快照、attempt 与推导聚合和盘上文件一致——读取面是落盘事实的忠实投影，不是第二份口径。

### 3. 机器出口

- CLI `--json` 输出的机器摘要与读取面口径一致。
- 显式 `--junit` 文件里 `failed` 折叠为 `<failure>`、`errored` 折叠为 `<error>`，用例集合与实际 attempt 对应。

### 4. 读面 CLI 行为

show / view 对这份真实结果的可观察行为按 [Show](../../../feature/reports/show.md) 与 [View](../../../feature/reports/view.md) 契约验收：

- **选择与收窄**：位置参数按 eval id 前缀、`--exp` / `--results` 在两个宿主用同一套规则；漏写 `@` 的 locator 按前缀处理并明确报无匹配、列出候选。
- **历史与多页**：`show --history` 按 attempt 身份键跨快照去重、升序逐轮列出，与 `--report` 互斥按用法错误退出；多页报告渲染初始页并附带可复现上下文的 `--page` 索引命令。
- **证据切面**：`show @<locator>` 与 `--source` / `--execution` / `--timing` / `--diff` 在真实证据上工作；`--timing` 的有界诊断树与 `--timing=full` 全量展开按契约取样；落盘无 phases 时如实显示 unavailable，不猜。
- **Scope warnings**：局部补跑、过旧、不可读快照形成结构化 warning 且两宿主一致；单个坏快照不阻塞其余；零可读结果时 `show` 非零退出、`view` 不启动 server。
- **导出与 server**：`view --out` 导出站与本地 server 对同一路径逐字节一致；收窄对页面 Scope 与 `artifact/` 证据树同步生效；`attempt/<locator>.html` 无 JavaScript 完整可读；`o11y.json` 永不出站。

### 5. 渲染面

show 的终端输出与 view 的 HTML 是渲染契约的唯一验收面，对真实产物断言 [Reports](../../../feature/reports/README.md) 声明的呈现行为：

- **结构**：区块存在与相对顺序、默认展开 / 折叠（原生 `<details>` 的 `open` 标记）、计数、expected / received 文本、失败断言的默认可见性、locator 链接与下钻命令；空证据位的组件零输出，不留空占位；`PoweredBy` / `HeroCard` 品牌行的固定链接（`utm_source=report&utm_medium=powered-by`、`rel="noopener"` 不含 `noreferrer`）与 web 恒含、text 零输出的两面差异；同一维度键在 `MetricTable` / `MetricMatrix` / `Scoreboard` / `AttemptList` / `ExperimentList` / `MetricScatter` 之间的配色类名一致（`colorClassForKey` / `seriesClassForKey` 稳定散列，与渲染顺序无关）；`MetricScatter` 轴方向随指标 `better` 反向、刻度显示真实值、connect 折线与图例的一致性。
- **终端排版**：Table 的列宽 / 折行 / 丢列标注、Section 框线与窄宽降级、Grid 列数规划、显示宽度口径（CJK 记 2 列）——对 show 输出逐行断言，语义来源是 [Library · 排版原语](../../../feature/reports/library/layout.md)；`MetricScatter` 字符坐标图的标记分配顺序（图例字典序、series 内 x 升序）、图例文本与 `connect` 逐段位移摘要，语义来源是 [Library · 指标组件](../../../feature/reports/library/metric-views.md#metricscatter)。
- **双面同源**：text 与 web 显示同一份解析终值、覆盖率、判定构成和 warning，渲染不重算不丢值；不逐字比较布局。
- **视觉与交互**：对同一次运行执行 `niceeval view --out` 导出静态站，用真实浏览器打开 index 与失败 attempt 的 `attempt/<locator>.html` 文档，验收「组件 + 官方 stylesheet」在真实证据上的组合成立：详情各语义块是结构化布局而非 UA 默认排版；源码行按 [`AttemptSource` 视觉规范](../../../feature/reports/library/attempt-detail.md#attemptsource-web-面视觉规范)呈现状态染色与行号位标记；点击 send / assertion 行由原生 `<details>` 展开行内回复与断言细节，普通行不可展开；文档零 JS 依赖（禁 JS 后上述内容仍完整可读）。
- **自定义报告的用户操作回归**：渲染验收不只对内建 `standard` 报告做。仓库签入一组代表性自定义报告文件（`extends: standard` 叠外壳、自定义多页、自定义组件与 attempt page），对每份用 `show --report` / `view --report` 走同一条读面与渲染验收：页导航与 `--page` 索引、折叠展开、过滤框、locator 深链与下钻命令在真实浏览器里逐项操作可达。用户改一份报告文件就能踩到的路径，回归也要踩到。

渲染断言停在「规则生效、结构正确、交互可达」，不锁颜色值、像素或完整 class 列表。格式或渲染变更只需要更新这个仓库，不需要修改任何适配器仓库。

## 边界

判定、聚合、计算口径、装载校验与错误反馈这些**数据语义**归[单元测试 Reports](../unit/reports.md)——`*Data` 函数与 resolve 管线在 fixture 上证明，不需要真实运行。本仓库承接从数据到呈现的一切：渲染出来的结构、排版、样式与交互，以及 CLI 读面的进程级行为。

每个仓库验收链尾的 [CLI 读回](README.md#43-cli-读回)会在真实数据上驱动 show 的读取与渲染路径，但断言停在自有事实的出现与口径一致；逐字段的格式、出口与渲染契约只在本仓库验收一次。
