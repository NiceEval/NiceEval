# 功能域 · 报告与读面

本域回答一个问题：**一次真实运行落盘的结果、对外的机器出口，以及用户在 show / view 里看到的读面与渲染，是否符合公开契约。**
 它由 `e2e/report/` 仓库承担（group `report`）。
适配器仓库不复制格式知识，读结果只走公开 Record 读取面。

仓库使用安装后的 candidate 与签入的 Eval / Experiment 完整运行产生结果。普通消息和固定输出可以使用确定性 Direct Agent；
只有文件、diff、shell、timing 或资源生命周期需要时才使用 Sandbox 或对应 backend。稳定性来自固定输入与公开 expected，
不要求外部模型提供可重复文案。一次真实运行产出的冻结证据可被下面的只读验收组共用。

`.niceeval` 必须在每次 Repo invocation 中由这次完整运行现场生成，不签入、下载或从 Adapter / Record fixture 预置。
一个 Eval 无法制造某条 show / view 分支时，在本 Repo 增加另一条专用 Eval；不把所有展示状态写入同一个 Eval。

## 验收计划

仓库运行一个小型真实 Experiment，包含 passed / failed / errored 三态 attempt，然后对同一份事实逐出口核对：

### 1. 落盘格式

`run.json`、attempt 目录的 `result.json`、`events.json`、`sources.json`、`o11y.json`（有 tracing 面时含 `trace.json`）的字段与版本依据 [Record Format](../../../feature/record/architecture.md) 契约逐项断言。`verdict` 四态、断言明细、`durationMs` / `usage` / `estimatedCostUSD` 三件套成组出现；Run 封口同时写入 `completedAt` 与实验域 diagnostics，`run.json` 不含逐 attempt 数据。

### 2. 公开读取面

`openRecord()` 遍历出的 Run、diagnostics、attempt 与推导聚合和盘上文件一致——读取面是落盘事实的忠实投影，不是第二份口径。
`current()` 的 Sample 保留构成当前结果集的真实 Run，diagnostics 只随这些 Run 透传，不聚合进 Sample 或 Attempt。

### 3. 机器出口

- CLI `--json` 输出的机器摘要与读取面口径一致。
- `niceeval show --json` 的信封用 `sample`回显范围，`view` 判别 10 个内建 task Result 的 `data`形状；history attempt 用 `runStartedAt`。
- 对同一份真实 Record，text 与 JSON 必须选出同一批实体且公共派生字段同值，证明两面消费同一 task Result，不是 CLI 私有公式。
- 显式 `--junit` 文件里 `failed` 折叠为 `<failure>`、`errored` 折叠为 `<error>`，用例集合与实际 attempt 对应。

### 4. 读面 CLI 行为

show / view 对这份真实结果的可观察行为按 [Show](../../../feature/reports/show.md) 与 [View](../../../feature/reports/view.md) 契约验收：

- **选择与收窄**：位置参数按 eval id 前缀、`--exp` / `--record` 在两个宿主用同一套规则；漏写 `@` 的 locator 按前缀处理并明确报无匹配、列出候选。
- **历史与多页**：`show --history` 按 attempt 身份键跨 Run 去重、升序逐轮列出，与 `--report` 互斥按用法错误退出；多页报告渲染初始页并附带可复现上下文的 `--page` 索引命令。
- **用法错误矩阵**：读面 flag 的组合语义在真实进程上以非零退出与 `error:` / `fix:` 三段式验收。
  这些错误全部发生在装载与渲染之前，不产生模型调用。
  逐项核对：
  - `@<locator>` 语法非法、索引未命中、与其它位置参数混用。
  - `--history` / `--stats` 与 `--page`、`--report`、locator 的互斥矩阵。
  - 对照语义（`--exp` 出现两次以上）下每个 `--exp` 必须恰好命中一个 experiment：命中多个时列出全部候选；`@<locator>` 与重复 `--exp` 互斥。
  - `--grep` 必须是合法 JS 正则、只与 `--execution` 组合、与 `--expand` 互斥； `--expand` 要求范围恰好一个 attempt，句柄未命中报实际范围。
  - `--report` 文件缺失、默认导出不是 `defineReport` 返回的定义值、`--page` 未命中列出可用页 id；显式 `@<locator> --report` 遇到缺失 attempt 参数化页时指引解决路径，不静默回退内建详情。
  - view 的 `--record` / `--run` 互斥与不存在路径直说。
- **证据切面**：
  - 项目配置自定义报告且不含 attempt page 时，不带 `--report` 的 `show @<locator>` 仍显示官方诊断首页；显式 `@<locator> --report <file>` 才进入该报告的 attempt page。
  - `--source` / `--execution` / `--timing` / `--diff` 在真实证据上工作；`--timing` 的有界诊断树与 `--timing=full` 全量展开按契约取样；落盘无 phases 时如实显示 unavailable，不猜。
  - `--source` 的 Eval 把断言拆在入口与嵌套断言模块中。运行后修改这些源码，再用旧 locator 读取；展示必须保留运行时捕获的文件树、caller 位置与内容，不回读当前磁盘文件。这条 Journey 同时守住 source location 捕获与 Eval source snapshot 的公开结果。
- **Sample warnings**：局部补跑、过旧、不可读 Run 形成结构化 warning 且两宿主一致；单个坏 Run 不阻塞其余；零可读结果时 `show` 非零退出、`view` 不启动 server。
- **Run diagnostics**：真实 Run 的实验域 diagnostic 在两个宿主都按 experiment → Run 的出处呈现；直接传入的 Run[] 的自定义报告同样可见，出处、时效、level、message、command 与 count 不被合并或改写。
- **导出与 server**：`view --out` 导出站与本地 server 对同一路径逐字节一致；收窄对页面 Sample 与 `artifact/` 证据树同步生效；`attempt/<locator>.html` 无 JavaScript 完整可读；`o11y.json` 永不出站。
- 本地 server 的 attempt 详情路由按完整 Record 根寻址，不受 `--exp` 等收窄限制；与 `show @<locator>` 同一套按 Record 根语义寻址，`--out` 只产出收窄内可达 locator 对应的文档。
- `sources.json` 出站（server 响应与 `--out` 导出）恒为解引用后的 `{path, content}[]`，不是落盘的两层去重引用格式（先例：[memory/attempt-locator-and-source-dedup](../../../../memory/attempt-locator-and-source-dedup.md)）。

### 5. 渲染面

show 的终端输出与 view 的 HTML 是渲染契约的唯一验收面，对真实输出断言 [Reports](../../../feature/reports/README.md) 声明的呈现行为：

- **零配置用户切片**：从公开 CLI 验收多 `--exp` 对照、`--stats`、`--usage`、attempt 首页 facts、`--grep` 命中/空结果，以及 `--source` 对全通过断言的收纳和对失败断言的展开。
  预期来自本仓库签入的 Eval / Experiment 与本轮完整运行生成的 evidence，不 import show renderer、报告原语或数据源生成答案。旧 Record 兼容性 fixture 只归 Record Repo，不作为 show 的常规 producer。

- **结构**：区块存在与相对顺序、默认展开 / 折叠（原生 `<details>` 的 `open` 标记）、计数、expected / received 文本、失败断言的默认可见性、locator 链接与下钻命令。空证据位的组件零输出，不留空占位。
- `runDiagnostics` 的摘要恒可见且暴露最高严重度、web 默认折叠、text 不折叠、单诊断 Run 不摆空壳层级、三张内建 scope-input page 均紧邻 `sampleWarnings` 放置。
- `PoweredBy` / `HeroCard` 品牌行的固定链接（`utm_source=report&utm_medium=powered-by`、`rel="noopener"` 不含 `noreferrer`）：web 恒含、text 零输出。
- 同一维度键在 `measureRows` / `measureMatrix` / `scoreboard` / `attemptRows` / `experimentRows` / 图表图例之间呈现同一种颜色，与渲染顺序无关（同一页一次分配，见[页级色分配](../../../feature/reports/components/README.md#系列色分配单位是页)；比较浏览器实际绘制结果，不比较内部 class 或散列函数）。
- 图表轴方向随读数 `better` 反向、刻度显示真实值、scatter mark 连线与图例的一致性。
- `view` 外壳（topbar）恒有 NiceEval 品牌位、无 hero 区（hero 是页内组件），导航项与顺序等于报告定义中 `navigation !== false` 的页（不多不少、宿主不追加），`ReportLink.icon` 的内联 SVG 渲染在 label 前。
- **终端排版**：Table 的列宽 / 折行 / 丢列标注、Section 框线与窄宽降级、Grid 列数规划、显示宽度口径（CJK 记 2 列）。对 show 输出逐行断言，语义依据是 [Library · 排版原语](../../../feature/reports/library/layout.md)。
- 散点字符坐标图的标记分配顺序（图例字典序、series 内 x 升序）、图例文本与 `line` 逐段位移摘要，语义依据是 [图表 · 两面投影](../../../feature/reports/components/charts/README.md#两面投影)。
- **双面同源**：text 与 web 显示同一份解码终值、证据完整度、判定构成和 warning，渲染不重算不丢值；不逐字比较布局。
- **视觉与交互**：对同一次运行执行 `niceeval view --out` 导出静态站，用真实浏览器打开 index 与失败 attempt 的 `attempt/<locator>.html` 文档，验收「组件 + 官方 stylesheet」在真实证据上的组合成立。
- 详情各语义块是结构化布局而非 UA 默认排版；源码行按 [`attemptSource` 视觉规范](../../../feature/reports/components/primitives/source-view.md#web-面视觉规范)呈现状态染色与行号位标记。
- 源码块后的其它内容区（Other assertions / Other conversation）同样是结构化条目而非 UA 默认排版，分轮卡片与 `attemptConversation` 同视觉语言，工具预览无 JSON 字面转义直出。共享回复 renderer 的每个新渲染容器都要在这里验收一次样式接管（先例：[memory/attempt-detail-components-shipped-without-styles](../../../../memory/attempt-detail-components-shipped-without-styles.md)，同类缺陷在单元层 DOM 断言下恒逃逸）。
- 点击 send / assertion 行由原生 `<details>` 展开行内回复与断言细节，普通行不可展开；文档零 JS 依赖（禁 JS 后上述内容仍完整可读）。
  自定义 `Hero` 的可选 logo、说明与外链由官方 stylesheet 完成排版：宽屏和窄屏都完整可见且不越出视口； text 面保留说明与可复制链接，但不输出视觉 logo。
   `Table` 的单条 MetricValue 证据直接下钻，多条证据默认只占一个带数量的展开入口；展开后每条 Attempt 仍可下钻，收起时证据清单不能撑宽指标列。
- **自定义报告的用户操作回归**：渲染验收不只对内建 `standard` 报告做。
  仓库签入一组代表性自定义报告文件（`pages: [...standard.pages]` 叠外壳、自定义多页、自定义组件与 attempt page）。对每份用 `show --report` / `view --report` 走同一条读面与渲染验收：页导航与 `--page` 索引、折叠展开、过滤框、locator 深链与下钻命令在真实浏览器里逐项操作可达。
  用户改一份报告文件就能踩到的路径，回归也要踩到。
- **候选包的外部消费边界**：把编排器注入的候选 `niceeval` tarball 链接进临时消费方项目。以独立 Node 进程从该项目 cwd 执行 `niceeval show --report`，对同一份真实 Record 分别涵盖消费方无 `tsconfig.json`、classic JSX 与 `react-jsx` 三种配置。
  三种场景都必须从 `niceeval/report/built-in` 成功装载 package-owned 预编译 ESM 并渲染真实证据，不得受消费方 JSX 配置影响或依赖全局 `React`；这个 case 证明的是发布包模块边界，不重复组件渲染断言。

自定义报告验收按用户认识的公开组件族放在 `e2e/report/scripts/report-components/<component-family>.scenarios.ts`。
每个 scenario 只证明一个可观察行为，场景上方用中文 Given / When / Then 注释交代前提、操作和预期；文件边界不跟随 renderer、data builder 或 CSS 等内部实现拆分。
场景共享同一次真实 Evidence、每份报告的一次静态导出和一个浏览器进程，不能为了文件隔离重复跑模型或重复导出。

渲染断言停在「用户可见规则生效、语义结构正确、交互可达」，不锁颜色值、像素或完整 class 列表。
class/tag selector 只是找到元素的手段，除非公开文档把它声明成 DOM、可访问性或导出格式契约，否则不能把具体 class/tag 本身写进预期；样式断言也应证明可见布局或交互效果，而不是规定必须由 grid、flex 或某个组件实现。
格式或渲染变更只需要更新这个仓库，不需要修改任何适配器仓库。

## 自动化 owner

下列 heading 是 E2E 文件的稳定身份；每个文件只接管一个可独立失败的公开结果或完整 Journey。

### report-show-json

`show --json` 对本轮完整运行产生的三态 Sample、JUnit 出口和显式报告入口使用同一批公开事实。

### report-execution-evidence

`show --execution` 从本轮 Record 读回确定的 tool-call 对话证据，不从当前 fixture 重建过程。

### report-source-snapshot

旧 locator 在源码发生变化后仍显示运行时捕获的入口、调用链与导入断言快照。

### report-static-export

`view --out` 把本轮 report evidence 导出为可读静态站，并保留对应用户内容。

### report-config-reload

运行中的 `view` 持续重建项目模块、配置与 Record，报告短暂失效后可在同一 server 上恢复。

### report-project-current

一次真实运行产生 current 结果后，项目身份不变时下一次 `exp` 复用该结果，plain `show` 与 plain `view` 同时展示它。
Eval 源码变化但尚未重跑时，两条读面都排除旧 attempt；下一次 `exp` 不复用旧结果，新结果完成后重新进入两条读面。
这条 Journey 回归 `052b13bb`，以 Eval fingerprint 变化代表三层 project-current 身份门；Run config hash 与逐 Eval result config hash 的算法矩阵仍由 Sample / Runner 的最小 Unit 例外拥有。

### report-browser-journey

自定义报告在静态导出与真实 `view` server 中都能完成导航、证据下钻和无 JavaScript 可读终态。

## 边界

判定、聚合、计算口径与报告定义的装载规范化这些**数据语义**归[单元测试 Reports](../unit/reports.md)——数据源的 `compute()` 与树解码管线在 fixture 上证明，不需要真实运行。
本仓库承接从数据到呈现的一切：渲染出来的结构、排版、样式与交互，以及 CLI 读面的进程级行为——选择收窄、用法错误矩阵与装载失败反馈都在真实进程的退出码与 stderr 上验收。

每个仓库验收链尾的 [CLI 读回](README.md#43-cli-读回)会在真实数据上驱动 show 的读取与渲染路径，但断言停在自有事实的出现与口径一致；逐字段的格式、出口与渲染契约只在本仓库验收一次。
