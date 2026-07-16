# Reports 的测试用例

本页是 Reports 契约的场景登记表。fixture 形状见 [测试架构](README.md)。

## 指标聚合口径

契约来源：[Architecture](../../../feature/reports/architecture.md)、[Library · 指标与维度](../../../feature/reports/library/metrics.md)。

| 契约 | 场景 |
|---|---|
| 一般指标先在同一 eval 的多个 attempt 内折叠、再跨 eval 折叠（两级默认均 mean），重试次数不改变题目权重 | 正例：区分力 fixture 的 `endToEndPassRate` 得 5/9；反例：区分条件任务通过率 5/6、attempt 平铺 3/5 与"任一轮通过"2/3 三种错误口径 |
| 无限定词的成功率与默认组件使用 `endToEndPassRate`：errored = 0；`taskPassRate` 排除 errored，只能作为带限定名称的诊断指标 | 正例：2 passed + 5 errored 的默认成功率是 2/7，不是 100%；正例：并排展示三个指标可区分任务质量与执行可靠性 |
| `skipped` attempt 对全部内置指标返回 `null`，不进有效样本但保留在 total | 正例：samples < total 且 value 不受影响；反例：skipped 未被算成 0 分 |
| `null` 表示测不了不参与聚合；`0` 正常参与，二者聚合结果必须不同 | 边界：`[null, 0, 1]` 的 mean 是 0.5 而非 1/3 |
| `Scoreboard` 使用固定题集分母：未跑到的题按 0 分计入分母并计入 `notRun`；跑了但指标为 null 的题同样按 0 分但计入 `unscorable`，两个计数不合并 | 正例：题集 4 只跑 2 分母仍 4 且 notRun=2；正例：跑了但 null 的题 unscorable+1 而 notRun 不变；反例：与"只统计有样本"口径区分 |
| `Scoreboard` 权重按 eval id 前缀匹配，多前缀命中取最长 | 正例：`security/` 与 `security/auth/` 同时命中取后者；边界：无命中 |
| 跨快照计算先按 attempt 身份键去重，同一 attempt 出现在多快照不重复计数 | 正例：局部补跑重叠快照下 samples 不虚增 |
| 宿主 Scope 为每个 experiment × eval 选择跨历史最新判定 | 正例：先 failed 后 passed 的两快照只用最新判定 |
| 自定义指标 `where` 是进入计算前的过滤；`aggregate: { perEval, acrossEvals }` 两级分别生效 | 正例：failed attempt 不进聚合；边界：全被 where 排除 → missing；正例：perEval min + acrossEvals mean 与双 mean 可区分 |
| `evalGroup` 维度按 eval id 完整父路径分组（无 `/` 取完整 id），与可比组同一条派生规则；Scoreboard `subject` 缺省同规则 | 正例：`a/b/c` 归 `a/b`；边界：无斜杠 id 形成单例组 |
| 报告消费落盘 verdict，不重新判卷 | 反例：断言明细与 verdict 故意矛盾时以 verdict 为准 |

示例——先测 `*Data` 计算的事实：

```tsx
import { expect, it } from "vitest"
import { scopeSummaryData } from "../../report/index.ts"

it("scopeSummaryData 使用端到端两级聚合并保留覆盖率", async () => {
  const data = await scopeSummaryData(scope)

  expect(data.endToEndPassRate.value).toBeCloseTo(5 / 9)
  expect(data.endToEndPassRate.display).toBe("55.6%")
  expect(data.endToEndPassRate.samples).toBe(5)
  expect(data.endToEndPassRate.total).toBe(6)
})
```

## MetricCell 与缺数据行为

契约来源：[Architecture](../../../feature/reports/architecture.md)、[Library 总览](../../../feature/reports/library.md)、[Library · 指标与维度](../../../feature/reports/library/metrics.md)。

| 契约 | 场景 |
|---|---|
| MetricCell 携带 value/display/samples/total/refs；缺数据格子 value 为 null 且不渲染成 0 | 三格 fixture：measuredZero、partial、missing 互不混淆 |
| 覆盖率与 refs 不因渲染或 JSON 序列化丢失 | 正例：serialize round-trip 后 refs 完整 |
| 组件消费 `data` 时校验结构：不符合当前版本形状按完整用户反馈报错并提示可能的版本漂移，不静默错渲染 | 反例：字段改名前的旧 JSON 传入 data 形态报错且文案含版本漂移提示；正例：round-trip 的同版本 JSON 照常渲染 |
| 缺 artifact 时指标返回 null，渲染层不猜值；`assistantTurns` / `repeatedFailedCommands` 缺 `o11y.json` 显示缺失不冒充 0 | 正例：删 o11y.json 后两指标为 missing；反例：来自 result.json 的指标不受影响 |
| `repeatedFailedCommands` 口径：同一 attempt 内每条命令失败 n 次（n>1）记 n−1 求和；成功执行与只失败一次的命令不计 | 正例：同命令失败 3 次记 2；反例：两条不同命令各失败 1 次记 0 |
| value 与 display 分别可断言；display 由 unit 或自定义 display(value) 驱动 | 正例：value≈5/6 与 display="83.3%" 独立断言 |

## 数据计算函数（`*Data`）行为

契约来源：[Library · 概览组件](../../../feature/reports/library/summaries.md)、[Library · 实体列表](../../../feature/reports/library/entity-lists.md)、[Library · 指标组件](../../../feature/reports/library/metric-views.md)、[Show](../../../feature/reports/show.md)。

| 契约 | 场景 |
|---|---|
| `experimentComparisonData()` 在计算前按 experiment id 的完整父路径分区，根目录 experiment 各自形成单例组；每组子块与对该组独立调用 `scopeSummaryData` / `metricScatterData` / `experimentListData` 完全相同 | 正例：两个多配置目录组 + 一个根目录单例组；逐组 deepEqual 对账并断言 scatter / list refs 不跨组 |
| `ExperimentComparison` 的 web 面接收全部组并输出组选择器与相互隔离的完整 panel，第一组默认展开且无 JS 仍可读；text 面多组时只给索引和单组查看命令，单组时才输出散点与实验列表 | 正例：双组 web 静态 HTML 含两个 panel 且仅首组 open；text 多组无 experiment 明细、单组有明细 |
| `MetricScatter` 对缺 x 或 y 的点不绘制并报告缺失数；零点显示明确空态；单点照常绘制 | 边界：0 点 / 1 点 / 部分缺 x；反例：单点不被拒绝 |
| 散点轴方向跟随指标 `better`：lower 反向（左贵右便宜）、higher 正向，「更好」恒指向右上，提示恒为「越靠右上越好」；刻度显示真实值；未声明 better 的轴正向且整图不出方向提示；两面同规则 | 正例：成本 × 成功率图上低成本点落在右侧且刻度值仍从大到小；边界：x 无 better 时无方向提示；正例：text 面同方向 |
| `MetricLine` 对未声明数值 flag 的 experiment 不伪造 x 值并报告未绘制数 | 正例：flag 缺失与 flag="high" 两种；反例：不落到 x=0 |
| `DeltaTable` 任一侧缺数据时 delta 保持缺失；方向按指标 `better` 判断改善/退化 | 正例：better:"lower" 的 costUSD 下降判改善；边界：一侧缺时 delta 为 null |
| `pairsByFlag` 按「同可比组 + 删除该 flag 后可比性配置深相等」配对：a 取 baseline（缺省=未声明），b 侧每个其它取值各成一对，label 为 `<a 末段> · <flag>=<显示键>`，按 (a 末段, 显示键) 字典序 | 正例：三 agent × baseline/agents-md/mempal 矩阵导出 5 对（bub 无 mempal 如实少一对）；反例：model 不同的两实验不配对；边界：收窄到单实验时 0 对显示空态不报错；反例：`by: "agent"` 配派生形态报完整用户反馈 |
| `pairs` 与 `questions` 类型放宽为普通数组，空数组在计算时按完整用户反馈报错；`metrics` / `columns` 保留非空元组 | 反例：`.filter()` 后为空的 pairs 报错且文案完整；正例：运行期构造的非空 pairs 直接可用，无需元组断言 |
| `FailureList` 与手写组合等价：verdict ∈ failed/errored、开始时间降序（同刻按 locator 字典序）、`limit` 截断（默认 20）且 total 报告截断前总数 | 正例：与 `attemptListData` 手工过滤排序的渲染结果深等；边界：失败数少于 limit 时 total 等于 data 长度 |
| `MetricMatrix` 是稀疏矩阵：无 attempt 的行列组合不生成格子；`MetricBars` 消费同一份矩阵数据 | 正例：缺组合无格子（而非 value:0）；正例：Bars 与 Matrix data 同源 |
| `AttemptListItem` 只携带算好的单行摘要：`failureSummary`（failed 取主失败断言摘要、errored 取 error 一层摘要、passed/skipped 为 null）与 `moreFailures` 计数；序列化 JSON 不含 assertions、stack、evidence 或 diagnostics | 正例：failed/errored/passed 三态的 failureSummary 各自正确；反例：多失败 attempt 的 JSON.stringify 结果不含第二条断言文本与 stack |
| `ScopeSummaryData` 恒携带 eval 级与 attempt 级两份计票，`evals` 按 `experimentId + evalId` 计数、与 `evalVerdicts` 同分母；呈现 prop `votes` 只选择显示哪一级（默认 eval），不改变 data | 正例：2 实验 × 6 题的 fixture 下 evals=12 且计票总和一致、两级计票在含重试时不同；边界：`votes="attempt"` 切换显示但 data 深等 |
| `experimentListData` 对同一 experiment 的输入含不一致可比性配置时按完整用户反馈失败，指引 snapshot 维度 / MetricLine；宿主注入的 `current()` Scope 天然满足单义 | 反例：手工拼两份 model 不同的快照数组报错且文案含下一步；正例：current() Scope 照常计算 |
| `DeltaData.rows` 携带作者声明的 pair `label` 原样透传，renderer 据此显示行名 | 正例：LocalizedText label 经 data round-trip 后两面显示一致 |
| `MetricLine` 点身份为 `(series, x)`：同桶多 experiment 按 (series, x, experiment, eval) 顺序聚合成一个点；自定义 `NumericAxis.of` 在同一 experiment × eval 内返回不同值时计算以完整用户反馈失败 | 正例：两 experiment 同 x 合成一点且 y 为跨题聚合；反例：逐 attempt 变化的 of 报错不静默取首值 |
| 分组维度上未声明的 flag 归 `(missing)` 组（metrics.md 的内置文案），不丢行 | 正例：部分 experiment 无该 flag 时 (missing) 计数正确 |
| `MetricTable` 的 `sort` 决定初始行序，方向由指标 `better` 决定（好在前） | 正例：sort=endToEndPassRate 高在前、sort=costUSD 低在前 |

## 组件解析（resolve）与组合组件

契约来源：[Architecture](../../../feature/reports/architecture.md)「组件模型」「报告树与两个宿主」、[Library · 排版原语与自定义组件](../../../feature/reports/library/layout.md)、[Library · 指标组件](../../../feature/reports/library/metric-views.md)、[Library · 外壳与多页](../../../feature/reports/library/shell.md)。

| 契约 | 场景 |
|---|---|
| spec 形态与「先手工调 `*Data` 再传 `data`」严格等价：同一 spec 经管线 resolve 与手工计算渲染出相同终值、覆盖率与 refs | 正例：`MetricScatter` spec 形态与 data 形态两棵树渲染深等；反例：同一组件同时给 `data` 与 spec 字段报完整用户反馈 |
| spec 形态 `input` 省略时取宿主注入的 Scope，显式 `input` 覆盖数据来源 | 正例：`ScopeSummary input={scope.filter(...)}` 只统计收窄后快照；正例：`MetricTable input={exp.snapshots}` 按快照出行 |
| resolve 记忆化：一次页渲染内同引用 `input` + 深相等 spec 只计算一次；深相等中函数与 Metric / Dimension / NumericAxis 实例按引用比较 | 正例：Matrix 与 Bars 同 spec 时计算函数只被调一次；反例：不同 spec 或不同 `input` 各自计算；边界：两个字段相同但实例不同的 Metric 各自计算、不报错 |
| `ReportNode` 全集：元素、数组 / Fragment（展平保序）、null / undefined / boolean（渲染为空）；裸字符串与数字在树校验时按完整用户反馈拒绝并指引包 `Text` | 正例：`groups.map(...)` 数组与 `cond && <X />` 两面渲染正确；反例：树中放裸字符串报错文案含 Text 指引 |
| 组合组件在 resolve 阶段以 `(props, ctx)` 调用并递归展开返回树；`ctx` 携带 `scope`、`results` 与规范化声明 `report`；async 组合可用 | 正例：组合组件树与手写等价树渲染相同；正例：`ctx.results` 取历史快照喂 `input`；正例：`ctx.report.title` 是走完回退链的标题、`ctx.report.pageId` 是当前页 id |
| 同层 sibling 并行取数与展开，输出保持声明顺序 | 正例：慢 resolve 在前、快 resolve 在后时输出顺序不变 |
| 非法节点在展开遇到时以完整用户反馈拒绝且不为其取数：React 组件、未经 `defineComponent` 的普通函数、任意 HTML intrinsic | 反例：树中放裸函数组件报错文案可 snapshot；反例：`<div>` 同样拒绝 |
| `defineComponent` 两种形态：函数形态产出组合组件；对象形态缺 `text` 或 `web` 在定义时报错（TS 编译期 + 无类型 JS 运行期） | 正例：函数形态产物可入树；反例：只给 `web` 的对象形态定义时报完整用户反馈 |

## MetricScatter 点标签布局（web 面）

契约来源：[Library · 指标组件](../../../feature/reports/library/metric-views.md)「MetricScatter」。布局是 `chart-math` 的纯几何函数，场景直接对函数断言标签框与点框的几何关系，不经 HTML。

| 契约 | 场景 |
|---|---|
| 标签从点四周候选位择优：存在无冲突候选时，标签不与其它标签重叠、不遮盖任何数据点、不越出画布；全候选冲突时取重叠最小者，不丢标签 | 正例：三点近重合 + 正下方另一点的簇，标签框两两不叠且不压任何点框；反例：只向下推的级联布局会把第三个标签推到下方点上，可区分 |
| 无冲突时标签取点右侧紧邻位且不带 leader 标记；离开左右紧邻位的标签带 leader 标记；靠画布右缘的点标签整体落在画布内 | 正例：稀疏两点右侧紧邻、无 leader；边界：右缘点锚到左侧紧邻位、标签框不越出画布、无 leader 标记 |

## text/web 双面同源

契约来源：[Architecture](../../../feature/reports/architecture.md)、[View](../../../feature/reports/view.md)、[Show](../../../feature/reports/show.md)、[Library · 实体列表](../../../feature/reports/library/entity-lists.md)。

| 契约 | 场景 |
|---|---|
| 双面组件的 text 与 web 显示同一份解析终值、覆盖率、判定构成和 warning，渲染不重算不丢值 | 正例：partial cell + warning 两面都含 "50%"、"1/2" 和 warning 文本；不要求逐字相同 |
| `validateReportTree` 拒绝缺任一渲染面的组件与任意 HTML intrinsic，报错为完整用户反馈 | 反例：树中放 `<div>` 或单面组件时校验失败，错误文案可 snapshot |
| web 面排序/过滤只改变浏览状态，不改变数据、口径或初始 HTML 中的数值 | 正例：有无 filter prop 时数值与行集合相同 |
| `ExperimentList` web 面是固定八列比较表，默认按 End-to-end pass rate 降序；Model 缺失显示明确空值 | 正例：断言 thead 列名与顺序；边界：model 缺失；反例：taskPassRate 高但 executionReliability 低的实验不能排到端到端成功率更高者之前 |
| `ExperimentList` text 面保持实体层级：Eval 父行、Attempt `├─`/`└─` 子行，不压平 | 正例：一题两 attempt 只出现一次 Eval 标题 |
| `ExperimentList` / `EvalList` 的 Eval 父行只承载折叠判定与题级聚合，失败摘要只在 Attempt 子行出现；父行不因 verdict 改变同一位置的字段含义（[bug 台账](../../../../memory/eval-parent-repeats-attempt-failure.md)） | 反例：单个 failed / errored Attempt 的摘要在展开树中出现两次；正例：failed Eval 父行仍显示平均耗时与平均成本 |
| `ExperimentList` 传 `relativeTo` 时 web 与 text 两面行标签去掉该父路径前缀只显示 id 末段（与散点点标签同源），完整 id 仍用于排序键 / 着色 / 折叠；默认 `ExperimentComparison` 给每组传组键 | 正例：组键 `compare` 下 `compare/bub-gpt-5.4--agents-md` 显示 `bub-gpt-5.4--agents-md` 且 `data-sort-value` 仍是完整 id；边界：根目录单例组 id 无前缀时显示完整 id；反例：不传 `relativeTo` 时显示完整 id |

```tsx
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { ScopeSummary } from "../../report/index.ts"
import { createTextContext, renderNodeToText } from "../../report/tree.ts"

it("text 与 web 显示同一个 MetricCell 终值和 warning", () => {
  const data = summaryDataFixture({
    passRate: cells.partial,
    warnings: ["snapshot is incomplete"],
  })

  const html = renderToStaticMarkup(<ScopeSummary data={data} />)
  const text = renderNodeToText(
    <ScopeSummary data={data} />,
    createTextContext({ width: 80 }),
  )

  for (const face of [html, text]) {
    expect(face).toContain("50%")
    expect(face).toContain("1/2")
    expect(face).toContain("snapshot is incomplete")
  }
})
```

## Table 与文本排版原语

契约来源：[Library · 排版原语与自定义组件](../../../feature/reports/library/layout.md)。

| 契约 | 场景 |
|---|---|
| `Table` 的 null 单元格与 cells 缺键都渲染成 `—`，不补 0 | 正例：两种行；反例：不渲染 "0" 或空串 |
| 列宽按显示宽度计算（CJK 记 2 列）；stringWidth/padEnd/padStart/wrapText 按显示宽度工作 | 正例：含中文 eval id 的表对齐；边界：`stringWidth("中a") === 3` |
| 超宽时先折行最宽的左对齐列，右对齐列永不折行；仍放不下从右侧丢列并如实标注丢列数 | 边界：窄 width 下数字列完整、标注 "hidden N columns"；反例：不静默删列 |
| 任一行带 locator 时表格多出 attempt 列：web 为证据室链接，text 列出 `@<locator>` | 正例：混合有/无 locator 行；边界：全部无 locator 时不出该列 |
| 官方表组件的 text 面建在同一 Table 渲染器上，折行/丢列/对齐行为一致 | 正例：同一窄宽度下标注格式一致 |
| `Row` text 面在宽度装得下时按显示宽度并排（与 `columns` 同尺），装不下时整块纵向堆叠，不截断不隐藏 | 正例：宽 width 下两块并排；边界：窄 width 下纵向堆叠且内容完整 |
| 列可设 `maxLines`（text 面）：数据格折行超出的行丢弃、末行按显示宽度以 `…` 收口；表头不受约束 | 正例：Result 列两行收口带 `…`；反例：未设 maxLines 的列不收口 |
| 实体列表的 Result 单元格是两行收口的预览：主失败摘要先经宽度预算的优先级收口，再由列 `maxLines: 2` 兜底；值自带换行 / 空行不进表 | 正例：数千字符多行 received 的 attempt 行 ≤2 物理行、无空行、`…` 收口且 expected 前缀仍在 |

## show/view 宿主等价与选择

契约来源：[README](../../../feature/reports/README.md)、[Architecture](../../../feature/reports/architecture.md)、[Show](../../../feature/reports/show.md)（分篇：[`--timing`](../../../feature/reports/show/timing.md)、[`--report`](../../../feature/reports/show/reports.md)、[默认报告](../../../feature/reports/show/default-report.md)）、[View](../../../feature/reports/view.md)。

| 契约 | 场景 |
|---|---|
| 裸 `show` 与裸 `view` 把同一 Scope 交给同一份内建报告定义（`niceeval/report/built-in` 默认导出）；`--report` 替换同一报告槽 | 正例：装载边界捕获两宿主的 definition 同引用、scope 深等 |
| 两宿主对 `--results` / `--experiment` / 位置参数用同一套选择规则；局部补跑/过旧/未完成快照形成结构化 warning 随 Scope 携带 | 正例：未完成快照在两宿主产出相同 warning 集 |
| `--history` 对匹配的每个 experimentId + evalId 分节，按 attempt 身份键跨快照去重、startedAt 升序逐 attempt 列出时间 / verdict / 单行摘要 / 耗时 / 成本 / locator；与 `--report` 互斥 | 正例：跨快照重跑去重后逐轮列出且升序；反例：与 `--report` 同用按用法错误非零退出 |
| 宿主显示警告时下一步随行：text 面原样打印 `message`（已以下一步收尾，不截断掉尾段）；web 面把警告的 `command` 渲染为可复制命令，无 `command` 的警告只显示 message 不硬造动作 | 正例：stale-snapshot 在 web 面出现复制动作且值为 `niceeval exp <真实 id>`；正例：text 面输出以忽略条件/命令收尾；反例：missing-startedAt 在 web 面无复制动作 |
| `view` 位置参数收窄只作用于报告槽，证据室保留完整 attempt 集，深链不因首页过滤失效 | 正例：收窄后被滤掉的 attempt 仍可从证据室取到 |
| `show` 中漏写 `@` 的 locator 按 eval id 前缀处理并明确报无匹配、列出候选 | 反例：输入 "1qrdcfq8" 报 "No results matched" 附候选 |
| `--timing` 自身就是 Attempt 证据切面，单独使用必须进入有界诊断时间树；首页 timing 只列大头，短的 baseline / telemetry bookkeeping 留给时间树 | 正例：locator + 单独 `--timing` 不回落首页；边界：短 telemetry 省略、慢 telemetry 保留 |
| detail node 不超过 80 时，裸 `--timing` 与 `--timing=full` 展开相同节点；phase 行和 omission 行不占预算 | 正例：79/80 节点无 omission；边界：81 节点出现 omission；反例：不能省略 lifecycle phase |
| 超预算时间树按失败路径 40、最慢路径 20、最早/最晚各 10 的节点池稳定取样，选中深层节点时保留祖先并占池额度，未用额度按契约再分配；平局用 `startOffsetMs` / `id` | 正例：慢 command、深层失败 span 与首尾样本均保留；边界：失败路径自身超过预算时省略行报告未展示 failed 数；边界：无失败时空余额流给其它池 |
| omission 在被截断子树原位报告省略节点数与失败数，并给出同 locator 的 `--timing=full`；不计算 children combined duration | 正例：3,302 个旧 command 默认输出有界且提示 full；反例：并发 sibling 不相加、不能写虚假的 combined time |
| `--timing=full` 展开全部 runner timing node 与全部唯一关联 OTel span；`--timing=summary` 与裸 flag 等价，其它 mode 非零退出 | 正例：旧 artifact 的 3,302 个 command 在 full 中全部可见；反例：`--timing=verbose` 报用法错误 |
| `operation` 的语义 label 来自 producer，renderer 不解析 command display、不执行 artifact callback、不按 shell family 猜分组 | 正例：workspace.diff 的批量 operation + 单个 command；反例：路径各异的 `git show` 不被 renderer 猜成 `git show ×N` |
| TTY、pipe、CI 对同一 timing mode 选择相同节点且不自动启动 pager | 正例：stdout capture 与 TTY fixture 的节点集合相同；反例：非交互命令不读 stdin、不挂起 |
| 扫描结果根时单个不可读快照不阻塞其余：忽略/incompatible/malformed/incomplete 各带原因 | 四种坏快照各一 fixture，好快照照常计入 |
| 零可读结果时命令失败：show 非零退出（旧格式建议 `npx niceeval@<version>`）；view 不启动 server、`--out` 不生成空站 | 边界：空结果根与仅含旧格式两种 |
| `--out` 无档位：根里存在且前端会读取的证据文件（sources 引用及其快照级 `sources/<sha256>.json` 正文 / events / trace / diff）全部复制，缺的在证据位置显示缺失；`o11y.json` 永不复制 | 正例：带 diff.json 的根导出后 diff 可下钻；正例：导出站离线打开源码视图可取到正文；边界：携带条目（artifactBase 指向原快照）的源码正文被归拢进本快照 `sources/`，删除原快照后导出站源码仍可读；边界：无 diff.json 的根导出后 diff 位置显示缺失原因；反例：o11y.json 不进 `artifact/` |
| 前端 artifact fetch 以「页面所在目录」为基底：pathname 末段带 `.` 视为文件名去掉，否则整个 pathname 是目录（含无尾斜杠形态），`artifact/<rel>` 拼在该目录下 | 正例：页面服务在 `/showcase/memory`（无尾斜杠 rewrite）时 fetch `/showcase/memory/artifact/<rel>`；边界：直接打开 `/foo/index.html` 时 fetch `/foo/artifact/<rel>`；反例：根路径 `/` 不产生双斜杠 |
| `--out` 与位置参数 / `--experiment` 互斥：按实验收窄发布走「换根」，报错文案含 `copySnapshots` + `filter` 下一步 | 反例：`--experiment compare --out site` 按用法错误非零退出且文案含 copySnapshots；正例：同参数不带 `--out` 时照常收窄报告槽 |
| `--snapshot` 指定单个快照文件时该文件不可读令 view 失败（与扫描模式的跳过相反）；view 位置参数只表示 eval id 前缀，不接受文件或目录 | 反例：损坏文件经 `--snapshot` 报错退出；正例：同文件在扫描模式仅被跳过；反例：文件路径作位置参数按 eval 前缀报无匹配 |
| 落盘无 phases 时 summary/full timing 都如实输出 unavailable 不猜；有 phases 时主链之和 ≤ total，收尾段 `+N` 不计入 total | 正例：含 teardown 的 fixture；反例：无 phases 的第三方结果；边界：errored 中途时最后主链阶段带 `✗` |
| 本地 server 与 `--out` 消费同一份站点产物：同一路径在两宿主逐字节一致（index.html 与全部 artifact 文件），两宿主不各自携带取数或布局知识 | 正例：对同一结果根，导出目录的每个文件与 server 对同路径的响应字节相等（含解引用后的 sources）；反例：server 不提供产物清单之外的路径 |
| server 打开首页触发站点产物整份重建，数据永远是盘上最新；artifact 请求未命中最近产物清单时管线重建一次再查，新落盘证据无需重启 | 正例：server 启动后新写一份快照，下一次 `GET /` 即含新数据；正例：新快照的 events.json 不重启 server 可 fetch；反例：重建后仍未知的路径 404 |

宿主等价在装载边界记录 definition 与 Scope，不比较完整终端输出与完整 HTML——各宿主的导航壳和证据室本就不同：

```ts
import builtInReport from "../../report/built-in/index.tsx"

it("show 与 view 的默认报告槽消费同一 Scope", async () => {
  const results = resultsFixtureWithPartialRerun()
  const show = await captureShowReportInput(results)
  const view = await captureViewReportInput(results)

  expect(show.definition).toBe(builtInReport)
  expect(view.definition).toBe(builtInReport)
  expect(show.scope).toEqual(view.scope)
})
```

## Attempt 详情（view 证据室）

契约来源：[View](../../../feature/reports/view.md)「Attempt 详情」。台账：[view-attempt-detail-buries-failure](../../../../memory/view-attempt-detail-buries-failure.md)（断言区缺失、timing 树压顶如何逃逸到真实使用）。

| 契约 | 场景 |
|---|---|
| 断言区是独立区块，先于时间树与代码视图渲染；数据来自 `result.json` 的 assertions，不依赖 sources / events / trace artifact 的加载 | 正例：无任何 artifact 的失败 attempt 仍渲染完整断言区；正例：DOM 中断言区节点先于 timing 区节点 |
| 断言区先展开 failed / unavailable 与影响判定的 soft；passed 按 group 收进默认折叠区并显示数量 | 正例：1 gate-failed + 1 unavailable + 两 group 共 3 passed 的 fixture，前两者默认可见、passed 折叠且计数为 3；反例：全 passed 时无默认展开条目，只有折叠区；边界：soft 未达标默认展开，soft 达标进折叠区 |
| 每条失败直接显示 matcher、expected / received 或 reason，并提供源码锚——不能要求用户从 matcher 名猜实际值 | 正例：失败条目静态渲染即含 expected 与 received 的值，且锚指向该断言的源码行；反例：无 expected / received 的失败（如 unavailable）显示 reason，不渲染空字段 |
| 时间区默认只显示 phase 主链与收尾段；children（hook / 命令 / turn）收合在可展开结构里，失败最深节点带失败标记 | 正例：默认标记下 children 不可见，展开单个 phase 后逐层可见；边界：errored attempt 只有最深失败节点带 ✗，祖先不重复标记 |
| 事件流按条目校验、按条目容错：未识别或形状不合的事件条目包成原始条目（`view.raw`）原样呈现并进入回复聚合，不静默丢弃；已识别事件正常呈现 | 正例：含 `skill.loaded` 的 events 数组不被判空，带 `loc` 的 send 仍聚出全部回复；正例：混入完全未知的事件类型（如 `future.event`）时该条目以原始 JSON 保留、其余事件照常；边界：非对象条目丢弃；反例：非数组的 events 载荷整体拒绝 |
| `skill.loaded` 是一等回复条目：send 展开面与对话流都显示 Skill 名，不伪装成工具调用 | 正例：`indexTurns` 把 `skill.loaded` 聚成 `kind: "skill"` 回复并保留 Skill 名 |
| 轮的归属按 `loc` 判定：无 `loc` 的 user 消息不开新轮——同文本回显吃掉、轮内注入作为 `kind: "user"` 回复留在当前轮，后续回复仍聚到带 `loc` 的 send | 正例：send（带 loc）后紧跟同文本无 loc 回显，回复仍全部聚到 send 行；正例：轮中段的 stop-hook 反馈成为 `kind: "user"` 回复且其后的 assistant 回复不脱轮；边界：流首无 loc 的 user 消息（旧工件）仍开 noloc 轮 |
| 源码视图 send 行真实可交互：带 `loc` 的 send 行点开显示该轮回复（assistant 文本 / thinking），再点收起；轮内没有任何回复事件时展开面如实显示「无回复」空态，不留空白 | 正例：jsdom 点击 send 行后回复面板含 assistant 文本与 thinking；正例：只有 send 事件时展开面是「(无回复)」文案；反例：未点开时回复不可见 |
| 源码视图断言行真实可交互：第一条失败断言默认展开（matcher 与 expected / received 的值直接可见），点行可收起；passed 行不默认展开、点开后有明细 | 正例：jsdom 下 gate-failed 行免点击即见 received 值；正例：passed 行初始无明细节点、点击后出现；反例：收起后 received 值不可见 |

## 外壳、页面与 Tabs

契约来源：[Library · 外壳与多页](../../../feature/reports/library/shell.md)、[Library · 内建报告](../../../feature/reports/library/built-in.md)、[Library · Tabs](../../../feature/reports/library/layout.md)、[Architecture](../../../feature/reports/architecture.md)「外壳与页：装载规范化」、[Show](../../../feature/reports/show.md)、[View](../../../feature/reports/view.md)。

| 契约 | 场景 |
|---|---|
| `--report` 文件默认导出恒为 `defineReport` 产物；装载规范化唯一产物是「外壳 + 非空页列表」：`defineReport(树)` ≡ `{ content: 树 }` ≡ `pages: [{ id: "report", title: 内置页名, content: 树 }]`，任何形态走同一条装载管线；非 `defineReport` 产物的默认导出报完整用户反馈 | 正例：三种写法装载出等价的规范化结果（唯一页 id 为 `report`）；反例：默认导出普通对象或 React 组件时报完整用户反馈 |
| `content` 与 `pages` 恰好声明一个：同时声明或都省略装载报错，报错文案给出 `content: <ExperimentComparison />` 下一步 | 反例：同时声明报完整用户反馈；反例：都省略报错且文案含 `<ExperimentComparison />`；正例：`defineReport({ title, links, content: <ExperimentComparison /> })` 渲染内建内容并带自定义外壳 |
| 页不嵌套外壳：`content` / `page.content` 只接受报告树节点，`defineReport` 产物放进任何 content 或树中装载报错（TS 编译期拒绝，无类型 JS 输入装载期同样校验） | 正例：具名导出的树与组合组件节点都可直接作 `page.content`；反例：页里放 `defineReport` 产物装载报错 |
| 裸 `show` / 裸 `view` 装载 `niceeval/report/built-in` 的默认导出，与 `--report` 同一条 `装载 → resolve → validate → render` 管线 | 正例：裸宿主装载的 definition 与该默认导出同引用 |
| show 对多页定义只输出标题、页索引与可复制的 `--page` 命令，不倾倒页内容；单页定义或 `--page` 命中时直接渲染该页 text 面 | 正例：双页定义索引含两条命令且无 experiment 明细；边界：单页定义直接渲染 |
| `--page` 未命中页 id 时按用法错误非零退出并列出可用页 id；单页定义的唯一页 id 是缩写展开出的 `report` | 反例：`--page typo` 报错附 overview / exam；边界：对树形态文件 `--page report` 命中唯一页，`--page typo` 报错列出 `report` |
| `show` 输出的页索引与组索引命令保留当前 `--results` / `--report` / `--page` 与位置参数上下文，复制即可复现下一层视图 | 正例：`--report` 下多组时组索引命令含 `--report` 与 `--page`；正例：`--results` 下页索引命令含 `--results` |
| 全部页共享宿主注入的同一 Scope，位置参数与 `--experiment` 收窄对全部页生效；页不承担数据过滤 | 正例：两页的解析 refs 来自同一收窄后 Scope |
| 本地宿主只 resolve 被打开的页；静态导出 resolve 并校验全部页，任一页失败则导出整体失败 | 正例：打开 A 页时 B 页的取数未执行；反例：B 页含 `<div>` 时 `--out` 非零退出、不产出半套站点 |
| 标题取值链 def.title → Scope 中唯一且相同（LocalizedText 深相等）的快照 name → 内置文案「Eval 运行结果 / Eval Results」，落点是 hero、浏览器标题与 show 页索引标题行；页头品牌位恒为 NiceEval 字标，不由 title 覆盖，点击新标签页打开官网（href 带 `utm_source=report&utm_medium=brand`）；`links` / `footer` 渲染进导航壳，text 面不含这些字段 | 正例：三级 fallback 各一 fixture 且 hero 与品牌位各自正确；正例：品牌位 href 为官网并含 `utm_medium=brand`；边界：两快照 name 的 en 相同、zh-CN 不同时任何 locale 下都落内置文案；反例：声明 title 后品牌位仍是 NiceEval；反例：show 输出不含 links href |
| `ReportLink.icon` 是内联 SVG 字符串（`{ svg }`）：web 面渲染在 label 前、静态导出原样内联；不收组件，show 不消费 | 正例：带 svg 的 GitHub 链接导航项含该 SVG；反例：无类型 JS 传 ReactNode 作 icon 装载报错；反例：show 页索引不含 svg |
| web 面外壳 hero 下方恒含指向 niceeval 官网的 `Powered by NiceEval` 品牌行（href 带 `utm_source=report&utm_medium=powered-by`），不随 `footer` 配置增减，无关闭配置；省略 `footer` 时不渲染页脚；text 面与 `niceeval/report/react` 嵌入组件不含 | 正例：有 / 无 `footer` 两种 fixture hero 下都含该行且 href 含 `utm_medium=powered-by`，无 `footer` 时无页脚元素；反例：show 输出与 react 嵌入渲染不含该行 |
| view 导航组成固定：报告页按声明序在前，内置 Attempts、Traces 证据页恒排其后；报告定义不能移除或重排证据页 | 正例：双页定义导航序为 页A · 页B · Attempts · Traces；边界：树形态定义导航仍含证据页 |
| `scripts` / `styles` 按声明序注入：styles 在官方样式后，scripts 在官方增强脚本后 `</body>` 前；初始静态 HTML 的数值不因注入改变 | 正例：注入前后初始 HTML 数据节点相同、注入顺序可断言 |
| `{src}` 资产相对报告文件解析，拒绝 `..` 路径段、绝对路径与 `~`；静态导出复制进 `assets/` 保持相对路径，缺失文件报错并给出解析后路径 | 正例：`./assets/a.js` 被复制；反例：`../x.js` 装载报错；边界：缺失文件在导出时报错 |
| `head` 标签白名单是 `meta` / `link` / `script` / `style`，白名单外与宿主自有单例（`title` 不在白名单、`meta charset`、`meta name="viewport"`）装载报错并指回对应契约 | 反例：`{ tag: "base" }` 装载报错；反例：`meta charset` / `meta viewport` 装载报错且文案指回 title 契约或宿主职责 |
| `head` 的 `attrs` 值为 `true` 渲染裸布尔属性，字符串渲染 `key="value"` 且值 HTML 转义；`script` / `style` 的 `children` 原样落进标签，内容含 `</script>` / `</style>` 时装载报错 | 正例：`{ async: true, src: 外链, "data-project": "a\"b" }` 渲染 `async` 裸属性且引号转义；反例：children 含 `</script>` 装载报错 |
| `head` 标签按声明序注入每页 `<head>`，落在官方与外壳样式之后；初始静态 HTML 的数值不因注入改变 | 正例：两个 head 标签注入顺序可断言且在外壳 styles 之后；正例：注入前后初始 HTML 数据节点相同 |
| `head` 的 `src` / `href` 按 scheme 分流：`http(s)://` 外链原样落标签、不进 `assets/`；本地相对路径走 `{src}` 同一路径纪律并物化为 `assets/<sha256><ext>`；protocol-relative `//` 与其它 scheme 装载报错 | 正例：GA4 外链 src 原样出现在 HTML 且 `assets/` 不含它；正例：`./favicon.svg` 改写为 `assets/<sha256>.svg` 且站点清单含该文件；反例：`//cdn.example/x.js` 装载报错 |
| `head` 不进 `ctx.report`（与 `scripts` / `styles` 同为注入资产）；show 不消费 `head` | 正例：声明 head 后组合组件 `ctx.report` 无该字段；反例：show 输出不含 head 标签内容 |
| `scripts` / `styles` 的 `{src}` 只收本地路径，外链装载报错并指引改写成 `head` 条目 | 反例：`{ src: "https://cdn.example/x.js" }` 装载报错且文案含 `head` 写法 |
| 重复或非法 page id 在装载时校验失败，报错列出冲突 id | 反例：两页同 id `exam`；反例：id 含大写或斜杠 |
| `Tabs` 两面都输出全部 tab 完整内容：web 静态 HTML 每 tab 一个 `<details>` 且仅首个 open，text 面按声明序输出带标题分节、不折成索引也不省略；切换不改变数据 | 正例：双 tab 两面各含两块完整内容且仅首个 open；反例：text 面不丢第二个 tab |

## Snapshot 的使用边界

Snapshot 适合锁定：

- 一段短小、稳定、可由评审者读懂的终端布局。
- 报告树校验错误的完整用户反馈。
- 一个组件关键的空态或 warning 结构。

Snapshot 不适合锁定：

- 整页 HTML、全部 class、随机 locator 和时间戳。
- 本可直接断言的数值、排序和 refs。
- 计算 fixture 与渲染 fixture 混在一起的巨大输出。

## 不这样测

- 不把 Reports 整体当作"展示层"薄测；选择、去重、指标和聚合会静默给错答案。
- 不只测 React component 能 render；要验证它没有重算或丢失 `*Data` 计算的终值。
- 不用相同 attempt 数的题目验证两级聚合，因为它与平铺算法可能恰好相等。
- 不用 snapshot 代替 `null`、`0`、samples/total 和 refs 的精确断言。
