# 报告组件通用化:原语 / 数据源 / 食谱三层

裁决(2026-07-25,用户选定「全面通用化」):报告组件不再按能力各出一个具名组件,改成三层——
少数几个形状封闭的**原语**、一个能力一个的**数据源**、每个宿主入口一份的**食谱**。
原语与数据源之间的全部接口是一个判别联合 `Cell`。

契约单源,一律以 docs 为准,不在本文复述:

- 三层模型、`Cell` 判别联合、`RowSource`:`docs/feature/reports/components/README.md`
- **四个角色与三问判据**(每个节点判断「这段逻辑该写在哪」的公共依据):
  同上文件「谁认识 niceeval」——第 1 问命中进数据源、第 2 问命中进管线、都不命中才是原语。
  跨组件对齐(页级色分配、标签缩写互斥、text 面宽度自适应)一律属管线,不许写进数据源或原语。
- 单元格渲染契约(全部原语照抄同一份):`docs/feature/reports/components/primitives/table.md#单元格渲染`
- 数据源目录与写法纪律:`docs/feature/reports/components/sources/README.md`
- 翻案记录:`memory/report-components-generic-primitives-ruling.md`

**范围**:只改 `docs/`;不动 `src/`、不动 `docs-site/`。公开站与实现各自另开 plan,
等本 plan 全部节点验收后启动——先文档后代码。

## 为什么是这一刀

专门组件扛的不是排版,是**证据**:`MetricCell` 带 `samples` / `total` / `refs`,
通用原语一旦只收 `string` 就断了下钻链,所以每个能力只能各自出一个组件保住它。
把原语的单元格升成能携带证据的判别联合之后,「实验对比表」与「成绩单」的差别就只剩
数据源,渲染面塌成同一个 `Table`。

同时放弃的是「组件没有旋钮」这条一致性保证:默认列序改由**大家都用默认食谱**保证,
而不是由封闭组件保证。这一条推翻 `memory/report-components-unified-component-tree.md`
里「实体列表不开放选列」的否决。

## 执行纪律(每个节点都遵守)

- 声明式重写受影响小节:不写差分句、不写实现状态、不写迁移叙事。
- **只编辑本节点「独占文件」清单内的文件**;发现要改别的文件,写进返回报告,不动手。
- 新建文件后旧文件当次删除,内容不在两处并存;删除引起的跨节点悬空链接由 planner 统一修。
- `docs-consistency` 在本节点内可能因其它节点尚未落地而红;只有链接目标属于本节点
  独占范围时才自己修,其余写进返回报告。
- 用词按 `docs/concepts.md`;行宽与禁词按 `pnpm docs:lint`,新写正文一处都不许命中。
- 不执行任何 git 命令;不改 `memory/INDEX.md`。

## TODO 树

```
R 组件通用化
├─ [x] N0 核心:三层模型 + Cell + 8 篇原语 + 数据源目录(planner,已完成)
├─ [x] N1 归属判据:四个角色(加「管线」)+ 三问定位(planner,已完成)
├─ [ ] W1 实体行数据源                      ── 并行
├─ [ ] W2 指标、成绩单与对照数据源          ── 并行
├─ [ ] W3 attempt 级数据源                  ── 并行
├─ [ ] W4 范围摘要、提示、瀑布与 prompt 数据源 ── 并行
├─ [ ] W5 食谱                              ── 等 W1/W3/W4(要引用新数据源名)
├─ [ ] W6 站点身份件收窄                    ── 并行
├─ [ ] W7 图表族对齐                        ── 并行
├─ [ ] W8 gallery 与排版/外壳/主题贯通      ── 等 N0
├─ [ ] W9 内建报告与库入口贯通              ── 等 W5
├─ [ ] W10 架构与 show / view 贯通          ── 等 W1–W5
├─ [ ] W11 reports use-case 贯通            ── 等 W10
├─ [ ] W12 仓内其它引用贯通                 ── 等 W1–W5
├─ [ ] W13 测试覆盖规范同步                 ── 等 W1–W5
└─ [ ] V1 对抗性校验(只读,报告不改文件)    ── 全部节点合并后
```

## 节点定义

### W1 实体行数据源

- **独占文件**:新建 `docs/feature/reports/components/sources/entity-rows.md`;
  删除 `components/entity-lists/{README,experiment-list,eval-list,attempt-list}.md`
- **要点**:`experimentList` / `evalList` / `attemptList` 三个 `RowSource` 的 `Row` 形状、
  默认列与列序、`columns()` 里的题型切换、三级 `subRows`、覆盖缺口 `placeholder` 行、
  时效标注折成 `locator` 格的 `staleSinceMs`。原实体列表文档里属于渲染的段落
  (列宽、排序交互、窄屏降级)不搬——它们已在 `primitives/table.md`。
- **验收**:每个 `Cell` 用到的 `kind` 都在 `README.md#单元格类型` 里存在;
  文中没有一句重复 `table.md#单元格渲染` 的渲染规则。

### W2 指标、成绩单与对照数据源

- **独占文件**:新建 `sources/{metric-rows,scoreboard,comparison-rows}.md`;
  删除 `components/tables/*`
- **要点**:`metricRows` / `metricMatrix` 的维度绑定节点(`Rows` / `Columns` / `Cells`)
  归属重定为数据源的绑定面;`scoreboard` 的固定题集、分科权重、`fullMarks`、
  `notRun` 与 `unscorable` 分开计数;`deltaRows` 的条件与基准、`stabilityRows` 的行恒为 eval。

### W3 attempt 级数据源

- **独占文件**:新建 `sources/attempt-sources.md`;
  删除 `components/attempt-detail/{README,attempt-source,usage-table}.md`
- **要点**:11 个 attempt 级数据源的投影范围与空证据规则、`AttemptEvidence` 输入契约、
  attempt-input page 的 `PageContext` 判别联合、用量组装口径(单源)、
  失败命令卡随 `attemptConversation` 走。`AttemptSource` 的视觉规范**不搬**——
  已在 `primitives/source-view.md`,此处只留数据投影。

### W4 范围摘要、提示、瀑布与 prompt 数据源

- **独占文件**:新建 `sources/{scope-summary,scope-notices,trace-rows,fix-prompt}.md`;
  删除 `components/summaries/scope-summary.md`、
  `components/site/{scope-warnings,snapshot-diagnostics,trace-waterfall,copy-fix-prompt}.md`
- **要点**:`scopeSummary` 的格集合按 `scoringComposition` 三态切换、两级计票与 `votes`;
  `scopeWarnings` / `snapshotDiagnostics` 的准入判据与按动作分组;
  `traceRows` 只画被测 agent 的原始 span;`fixPrompt` 的组装内容与零输出条件。

### W5 食谱

- **独占文件**:新建 `components/recipes/{README,experiment-comparison,attempt-detail,failure-list}.md`;
  删除 `components/summaries/{README,experiment-comparison}.md`、
  `components/attempt-detail/{attempt-detail,attempt-assessment}.md`、
  `components/entity-lists/failure-list.md`
- **要点**:每份食谱给等价全文;`ExperimentComparison` 的 compose 阶段解析
  (归类维度、主读数、混型拆两组)留在食谱层;`AttemptDetail` 的区块顺序与
  有 source 时不重复对话;弹窗形态属于宿主摆放。

### W6 站点身份件收窄

- **独占文件**:`components/site/{README,hero,hero-card,powered-by}.md`
- **要点**:这一族收窄成品牌与站点身份三件;数据投影件已迁往数据源,
  README 重写成「为什么这三件的形状本身是契约」。

### W7 图表族对齐

- **独占文件**:`components/charts/*`
- **要点**:只对齐用词(组件 → 原语)与跨族链接;图表本身的绑定契约与两面规则逐字不动。

### W8 gallery 与排版、外壳、主题贯通

- **独占文件**:`components/gallery.md`、`library/{layout,shell,theme}.md`
- **要点**:gallery 四张图改用原语 + 数据源写法;`layout.md` 的 `Table` / `Grid` / `Stat`
  小节改成指向 `primitives/`,排版原语只留容器与散文;`shell.md` / `theme.md` 的钉色与
  样式通道引用更新。

### W9 内建报告与库入口贯通

- **独占文件**:`library/{built-in,recipes,metrics}.md`、`docs/feature/reports/library.md`
- **要点**:`standard` 全文改用原语 + 数据源 + 食谱;`metrics.md` 的主读数映射消费面
  改指数据源的 `columns()`;库入口的导出面分三层列出。

### W10 架构与 show / view 贯通

- **独占文件**:`docs/feature/reports/{architecture,README,view}.md`、`reports/show*.md`
- **要点**:resolve / validate / render 管线按三层重述;切片与 `--json` 信封指向数据源;
  show 各分篇的组件名替换为原语 + 数据源。

### W11 reports use-case 贯通

- **独占文件**:`docs/feature/reports/use-case/*`
- **要点**:各用例改写成三层写法;`write-custom-component.md` 重点改成「写一个数据源」。

### W12 仓内其它引用贯通

- **独占文件**:`docs/concepts.md`、`docs/source-map.md`、`docs/observability.md`、
  `docs/feature/results/library.md`、`docs/feature/scoring/library/display.md`、
  `docs/feature/experiments/score-points.md`、`docs/roadmap/eval-source-view/*`
- **要点**:概念总表按三层重排组件行;其余文件只改被点名的组件名与链接,不改各自的领域契约。

### W13 测试覆盖规范同步

- **独占文件**:`docs/engineering/testing/unit/reports.md`、`docs/engineering/testing/e2e/report.md`
- **要点**:覆盖类别按三层重新声明——原语的单元格渲染、数据源的聚合口径、
  食谱的默认装配各成一组;`Cell` 每个 `kind` 的两面投影要有明确的覆盖声明。

### V1 对抗性校验(只读)

- **要点**:全仓 grep 旧组件名残留;逐篇核对「渲染规则只在 `table.md` 出现一次」;
  核对每个数据源在目录页与自己那篇里的名字、形状、配的原语三处一致;
  跑 `pnpm test` 与 `pnpm docs:lint`。发现的问题写进报告,不动手改。
