# Insight

Insight 是本机开发者审阅持续可读 Run 的第一方 debugger。`niceeval view` 启动 React SPA；浏览器在一次读取开始时
固定 `PublicationCutoff`，通过 Inspection 的固定 operation 呈现当时已经发布的 Run 与 Attempt 事实。
默认本机 Results 同时绑定当前 target identity，使用 `project.get` 显示当前结果可用性、缺口和历史入口；
固定 Run 与 Attempt 详情始终只读取历史事实。

```text
published Run facts at PublicationCutoff
  → generation-bound Inspection Host
  → typed HTTP transport for a fixed Inspection operation
  → React routes and components
```

View 不要求 Run 先进入终态。`active` Run 已发布的 Attempt 立即可读，尚未发布的 expected Planned attempt 显示 `pending`；
终态 Run 的空 Planned attempt 显示 `absenceReason`。Run detail 只消费 `run.get`，列表只消费 `run.list`。Results、指标、比较和
层级 table 同样只呈现 Inspection 已关闭的成员、分母与 Evidence，组件不自行聚合。

Insight 不是可定制 Report、component 或 service 作者面。它不提供持久 DTO、业务 REST、任意 SQL、任意 route，
或用户自带 renderer。

## 固定审阅体验

Header 右上角先显示 `Experiments` selector，再显示 `Language`。Results 显示 Summary cards、指标、Experiment 比较、成本 ×
通过率或分数散点图，以及 Experiment → 可选 Eval 路径组 → Eval → Attempt 层级 table。散点图以成本为横轴，以已关闭的
通过率或分数为纵轴。Run identity 是 Attempt member 的 provenance；读者可以
按 exact Run identity 打开 Run debugger，或从 Attempt 行打开 Attempt debugger。

Experiment、Eval 与 Attempt 行的 token 和单一 cost 列读取同一个 Inspection selector。父行按 origin Attempt 与 call identity
并集聚合，不因引用或展示分页重复计量；partial 与 unknown 在每一层保持可见。

Run debugger 显示 state、`expected`／`published`／`missing`、pending/absence、coverage、指标分母、Planned attempt bindings 与
Attempt locators。Attempt debugger 连续呈现身份、判定、source、assertions、trace、tool input/output、timeline、
usage、commands、diagnostics 与 diff。partial、unavailable 与 truncated 始终是可见事实。

## 预设调试能力：Match 判定、Trace 瀑布图与 Diff

Insight 坚持第一方预设与零配置体验，不要求开发者编写前端展示代码，也不提供拖拽式低代码分析面板。系统开箱提供三项高价值预设排查能力：

### 1. Match 结果与证据卡片（Match Inspector）

Attempt debugger 以卡片形式集中呈现该 Attempt 的全部 Match 求值结果：

- **判定与测量值**：清晰展示每个 Match 的测量值、布尔通过状态与错误码；
- **门禁与计分**：显式区分质量门（Gate）要求与评分点数（Score Points）贡献；
- **证据快照（Evidence）**：点击任意 Match 可下钻已落盘的证据快照。例如 Judge 裁判模型的理由分析与打分快照，或值比对的结构化差异；
- 无论是值匹配、正则、语义相似度还是 LLM Judge，统一遵循同一套高信噪比卡片呈现，无需手动提取变量。

### 2. 执行轨迹与调用耗时瀑布图（Trace & Waterfall Timeline）

Insight 预设集成基于树形拓扑的耗时瀑布图，为单次 Attempt 的性能与链路排障提供第一方视觉呈现：

- **阶段瀑布流**：将 Sandbox 准备、Turn 交互、LLM 请求、Tool 执行与断言按真实时序展开，直观暴露耗时瓶颈；
- **节点下钻抽屉**：点击任意 Trace 节点，即时滑出该调用的上下文详情（包括输入参数、标准输出与标准错误、Token 消耗及底层退出状态）；
- **错误定位**：发生非零退出、执行超时或协议异常的节点高亮标红，直接关联至原始诊断信息。

### 3. 工作区变动对比（Workspace Diff Viewer）

页面原生提供标准代码 Diff 视窗：

- 完整呈现 Agent 在工作目录内引发的文件修改、新增与删除；
- 采用标准 Unified Diff 格式与行级高亮，方便开发者在浏览器中直接复核代码补丁，无需手动运行终端比对。

## 用户工作流：如何使用 Insight

开发者通过以下三种日常路径使用 Insight 完成调试：

1. **终端精准直达**：评测失败后，终端收尾面板输出失败 Attempt 定位符（如 `@1VE05BR7061YN`）。开发者执行 `niceeval view @1VE05BR7061YN`，浏览器直接拉起该 Attempt 的全屏 Attempt debugger 详情页面；
2. **质量大盘下钻**：执行 `niceeval view` 打开完整 Results 概览，通过成本 × 分数散点图与结果矩阵快速定位异常单元格，点击任意 Attempt 即可滑出抽屉审阅 Match 与 Trace；
3. **活动运行实时审阅**：评测进行中，已封口的 Attempt 事实立即可读。页面提示有新发布事实时，点击刷新即可在评测尚未跑完前提前排查已失败的题目。

自定义 Adapter 的领域事件使用统一通用轨迹展示：默认只载入有界摘要页，保留主体、独立时钟、完整性和测量范围。
读者可以点击事件或输入稳定 ID，按需读取同一 Inspection detail；原始证据以已登记的精确 JSON 定位分块展开。
没有会话事件不代表没有执行轨迹。事件带展示块时按 `kind` 呈现文本、对话、键值、等宽文本与图片；文本以文本节点插入，
不进入 HTML、属性拼接或 URL 执行位置。图片只从 `attempt.artifact` 读取的已验证 bytes 创建，16 MiB 以上不内联，
无法解码时显示 `alt`。没有展示块时，领域类型和 JSON 内容作为数据展示。不加载作者提供的组件或执行展示代码。

软导航以 drawer 或 modal 显示详情；关闭或 Back 回到原选择。复制的 Run 或 Attempt URL 在硬加载时显示完整详情。
语言只改变界面文案，不改变 cutoff、identity、URL 或读取结果。

页面可提示较新的 publication。只有用户确认 refresh 后，repository 才固定新的 `PublicationCutoff`、准备完整结果并
原子切换；失败时旧 cutoff 的 last-good 页面继续可读。同一次读取不会混合两个 cutoff。
手动 refresh 即使没有新 publication 也重新求值当前目标。失败时 last-good 必须明确标为过期，
不能把旧目标下的可用结果描述成新的当前结果。仅有 Record 的 Preview 显式显示历史 Results。

- [CLI](cli.md)：`niceeval view` 的唯一命令面。
- [Architecture](architecture.md)：cutoff、薄 Host、repository、刷新与信任边界。
- [Use cases](use-case/README.md)：打开 Results 与连续审阅 Run、Attempt。
