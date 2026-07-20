# Reports 的测试用例

本页是 Reports 契约的场景登记表。fixture 形状见 [测试架构](README.md)。

## 指标聚合口径

契约来源：[Architecture](../../../feature/reports/architecture.md)、[Library · 指标与维度](../../../feature/reports/library/metrics.md)。

| 契约 | 场景 |
|---|---|
| 一般指标先在同一 eval 的多个 attempt 内折叠、再跨 eval 折叠（两级默认均 mean），重试次数不改变题目权重 | 正例：区分力 fixture 的 `endToEndPassRate` 得 5/9；反例：区分条件任务通过率 5/6、attempt 平铺 3/5 与"任一轮通过"2/3 三种错误口径 |
| 无限定词的通过率与默认组件使用 `endToEndPassRate`：errored = 0；可见短标签为“Pass rate / 通过率”；`taskPassRate` 排除 errored，只能作为带限定名称的诊断指标 | 正例：2 passed + 5 errored 的默认通过率是 2/7，不是 100%；正例：并排展示三个指标可区分任务质量与执行可靠性 |
| `skipped` attempt 对全部内置指标返回 `null`，不进有效样本但保留在 total | 正例：samples < total 且 value 不受影响；反例：skipped 未被算成 0 分 |
| `null` 表示测不了不参与聚合；`0` 正常参与，二者聚合结果必须不同 | 边界：`[null, 0, 1]` 的 mean 是 0.5 而非 1/3 |
| `Scoreboard` 使用固定题集分母：未跑到的题按 0 分计入分母并计入 `notRun`；跑了但指标为 null 的题同样按 0 分但计入 `unscorable`，两个计数不合并 | 正例：题集 4 只跑 2 分母仍 4 且 notRun=2；正例：跑了但 null 的题 unscorable+1 而 notRun 不变；反例：与"只统计有样本"口径区分 |
| `Scoreboard` 权重按 eval id 前缀匹配，多前缀命中取最长 | 正例：`security/` 与 `security/auth/` 同时命中取后者；边界：无命中 |
| 跨快照计算先按 attempt 身份键去重，同一 attempt 出现在多快照不重复计数 | 正例：局部补跑重叠快照下 samples 不虚增 |
| 宿主 Scope 为每个 experiment × eval 选择跨历史最新判定 | 正例：先 failed 后 passed 的两快照只用最新判定 |
| 自定义指标 `where` 是进入计算前的过滤；`aggregate: { perEval, acrossEvals }` 两级分别生效 | 正例：failed attempt 不进聚合；边界：全被 where 排除 → missing；正例：perEval min + acrossEvals mean 与双 mean 可区分 |
| `evalGroup` 维度按 eval id 完整父路径分组（无 `/` 取完整 id）；只组织 eval；Scoreboard `subject` 缺省同规则 | 正例：`a/b/c` 归 `a/b`；边界：无斜杠 id 形成单例组 |
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
| `validate*Data` 递归覆盖到嵌套字段，不只检查顶层哨兵：数组每一项逐项校验（而非只看数组本身是否存在）、嵌套 `MetricCell` / 四态 tally 按字段级校验、判别联合按 `kind` 分支各自校验必填字段；报错文案带完整字段路径定位到具体坏字段，不是笼统的整份 data 报错；结构错误恒转成 `dataShapeError` 完整用户反馈，不让 renderer 抛未处理的 `TypeError` | 正例：`TableData.rows[0].cells.<metric>` 缺 `samples` 报错路径含 `rows[0].cells.<metric>.samples`；正例：`MatrixData.cells[i].cell`、`ScatterData.rows[i].y`、`DeltaData.rows[i].cells.<metric>.a` 结构错误各自定位到该嵌套格；正例：`ScoreboardData.rows[i].subjects[j]` 缺 `possible` 报错路径含该 subject 下标；正例：`ExperimentListItem[i].endToEndPassRate` / `EvalListItem[i].examScore` / `AttemptListItem[i].costUSD` 类型错误（如误传字符串）各自报错；正例：`ScopeWarning` 按 `kind` 分支校验：`partial-coverage` 缺 `covered` 与 `stale-snapshot` 缺 `latestStartedAt` 报出对应分支缺的字段，不是通用的「缺字段」；正例：`AttemptConversationData.rounds[i].replies[j]` 按 `kind` 分支校验，`tool` 分支缺 `callId`、`input` 分支缺 `request` 各自报错；边界：数组为空（`rows: []`）本身合法，不报错；边界：可选字段（如 `MetricColumn.unit`、`ScopeWarning` 的 `command`）缺省不报错 |
| 缺 artifact 时指标返回 null，渲染层不猜值；`assistantTurns` / `repeatedFailedCommands` 缺 `o11y.json` 显示缺失不冒充 0 | 正例：删 o11y.json 后两指标为 missing；反例：来自 result.json 的指标不受影响 |
| `repeatedFailedCommands` 口径：同一 attempt 内每条命令失败 n 次（n>1）记 n−1 求和；成功执行与只失败一次的命令不计 | 正例：同命令失败 3 次记 2；反例：两条不同命令各失败 1 次记 0 |
| value 与 display 分别可断言；display 由 unit 或自定义 display(value) 驱动 | 正例：value≈5/6 与 display="83.3%" 独立断言 |

## 数据计算函数（`*Data`）行为

契约来源：[Library · 概览组件](../../../feature/reports/library/summaries.md)、[Library · 实体列表](../../../feature/reports/library/entity-lists.md)、[Library · 指标组件](../../../feature/reports/library/metric-views.md)、[Show](../../../feature/reports/show.md)。

| 契约 | 场景 |
|---|---|
| `experimentListData()` 对完整 input 计算 experiment 列表，每个 experiment 的 eval 集以快照 `selectedEvalIds` 为准；不同深度目录（如 `compare/a`、`bench/long/x`、`standalone`）的 experiments 一律进同一份 data，不再按父路径分组比较；`ExperimentComparison` 把同一个 `input`（缺省 `ctx.scope`）原样透传给 `ScopeSummary` / `MetricScatter` / `ExperimentList`，组合本身不二次计算或过滤，也不导出自己的 `data` 形态 | 正例：两个 experiment 选择不同 eval 集，列表 eval 数与各自分母如实且未选择项不补失败；正例：三种深度不同的 experiment id 混在一份 input 里，直接调用 `experimentListData` 与经 `ExperimentComparison` resolve 展开后 `ExperimentList` 收到的 spec 深等；正例：来源快照缺 `selectedEvalIds`（第三方）时该 experiment 按其实际 evals 可见；正例：resolve 后 `ExperimentComparison` 展开树里 `ScopeSummary`/`MetricScatter`/`ExperimentList` 三个组件收到的 spec `input` 与 `ctx.scope` 同引用 |
| `ExperimentComparison` 的 web/text 面都直接显示完整 Scope，不输出实验组选择器或组索引 | 正例：多 experiment 的两面都有摘要、散点与实验明细；反例：web 面 DOM 中无 `role=tablist` 与任何 group `<details>`/data 属性；反例：text 面不含分组索引段与 `niceeval exp <group>` 命令提示 |
| `ExperimentComparison` 展开树里 `ExperimentList` 的行标签缩短是 `ExperimentList` 自己的契约（见「text/web 双面同源」一节），`ExperimentComparison` 不二次处理；与 `MetricScatter` 点标签共用同一份最短唯一后缀算法（`shortestUniqueLabels`），同一份 id 集合两个组件得到相同显示名 | 正例：`compare/a`、`dev/b` 经 `ExperimentComparison` 展开后 `ExperimentList` 显示 `a`、`b`，`MetricScatter` 点标签同样显示 `a`、`b` |
| `MetricScatter` 对缺 x 或 y 的点不绘制并报告缺失数；零点显示明确空态；单点照常绘制 | 边界：0 点 / 1 点 / 部分缺 x；反例：单点不被拒绝 |
| 散点轴方向跟随指标 `better`：lower 反向（左贵右便宜）、higher 正向，「更好」恒指向右上，提示恒为「越靠右上越好」；刻度显示真实值；未声明 better 的轴正向且整图不出方向提示；两面同规则 | 正例：成本 × 通过率图上低成本点落在右侧且刻度值仍从大到小；边界：x 无 better 时无方向提示；正例：text 面同方向 |
| `MetricLine` 对未声明数值 flag 的 experiment 不伪造 x 值并报告未绘制数 | 正例：flag 缺失与 flag="high" 两种；反例：不落到 x=0 |
| `DeltaTable` 任一侧缺数据时 delta 保持缺失；方向按指标 `better` 判断改善/退化 | 正例：better:"lower" 的 costUSD 下降判改善；边界：一侧缺时 delta 为 null |
| `pairsByFlag` 在 input Scope 内按「删除该 flag 后可比性配置深相等」配对：a 取 baseline，b 侧每个其它取值各成一对；配对边界只是 input Scope，不额外按 experiment id 的目录前缀分组 | 正例：三 agent × baseline/agents-md/mempal 矩阵导出 5 对；反例：model 不同的两实验不配对；边界：单实验时 0 对显示空态；正例：`compare/codex` 与 `bench/codex` 两个不同目录前缀的实验，只要删除该 flag 后可比性配置深相等就配对成一对（不因目录前缀不同而拆开） |
| `pairsByFlag` 派生的 `DeltaPair.label` 使用完整 a experiment id（不截断成末段）；派生 pair 的排序仍按 a 的末段、再按 flag 显示键 | 正例：`a: "compare/codex"` 派生的 label 以完整 `"compare/codex"` 开头，不是 `"codex"`；正例：a 末段相同但完整 id 不同的两组 pair（如 `groupX/codex` 与 `groupY/codex`）排序只看末段与 flag 显示键，不因完整 id 的字符串差异打乱顺序 |
| `pairs` 与 `questions` 类型放宽为普通数组，空数组在计算时按完整用户反馈报错；`metrics` / `columns` 保留非空元组 | 反例：`.filter()` 后为空的 pairs 报错且文案完整；正例：运行期构造的非空 pairs 直接可用，无需元组断言 |
| `FailureList` 与手写组合等价：verdict ∈ failed/errored、开始时间降序（同刻按 locator 字典序）、`limit` 截断（默认 20）且 total 报告截断前总数 | 正例：与 `attemptListData` 手工过滤排序的渲染结果深等；边界：失败数少于 limit 时 total 等于 data 长度 |
| `MetricMatrix` 是稀疏矩阵：无 attempt 的行列组合不生成格子；`MetricBars` 消费同一份矩阵数据 | 正例：缺组合无格子（而非 value:0）；正例：Bars 与 Matrix data 同源 |
| `AttemptListItem` 只携带算好的单行摘要：`failureSummary`（failed 取主失败断言摘要、errored 取 error 一层摘要、passed/skipped 为 null）与 `moreFailures` 计数；序列化 JSON 不含 assertions、stack、evidence 或 diagnostics | 正例：failed/errored/passed 三态的 failureSummary 各自正确；反例：多失败 attempt 的 JSON.stringify 结果不含第二条断言文本与 stack |
| `ScopeSummaryData` 恒携带 eval 级与 attempt 级两份计票，`evals` 按 `experimentId + evalId` 计数、与 `evalVerdicts` 同分母；呈现 prop `votes` 只选择显示哪一级（默认 eval），不改变 data；web 面 KPI 使用双语短标签、不暴露原始 ISO 时间，成本覆盖不全时给出带语义的覆盖说明 | 正例：2 实验 × 6 Eval 的 fixture 下 evals=12 且计票总和一致、两级计票在含重试时不同；边界：`votes="attempt"` 切换显示但 data 深等；正例：成本 8/9 有数据时显示 `Cost available for 8/9 attempts / 8/9 次有成本数据`，而不是裸 `8/9` |
| `experimentListData` 对同一 experiment 的输入含不一致可比性配置时按完整用户反馈失败，指引 snapshot 维度 / MetricLine；宿主注入的 `current()` Scope 天然满足单义 | 反例：手工拼两份 model 不同的快照数组报错且文案含下一步；正例：current() Scope 照常计算 |
| `DeltaData.rows` 携带作者声明的 pair `label` 原样透传，renderer 据此显示行名 | 正例：LocalizedText label 经 data round-trip 后两面显示一致 |
| `MetricLine` 点身份为 `(series, x)`：同桶多 experiment 按 (series, x, experiment, eval) 顺序聚合成一个点；自定义 `NumericAxis.of` 在同一 experiment × eval 内返回不同值时计算以完整用户反馈失败 | 正例：两 experiment 同 x 合成一点且 y 为跨题聚合；反例：逐 attempt 变化的 of 报错不静默取首值 |
| 分组维度上未声明的 flag 归 `(missing)` 组（metrics.md 的内置文案），不丢行 | 正例：部分 experiment 无该 flag 时 (missing) 计数正确 |
| `MetricTable` 的 `sort` 决定初始行序，方向由指标 `better` 决定（好在前） | 正例：sort=endToEndPassRate 高在前、sort=costUSD 低在前 |

## 站点组件与内建报告

契约来源：[Library · 站点组件](../../../feature/reports/library/site-components.md)、[Library · 内建报告](../../../feature/reports/library/built-in.md)、[Library · 实体列表](../../../feature/reports/library/entity-lists.md)、[Results Library · 警告 kind 全集](../../../feature/results/library.md#警告-kind-全集)。

| 契约 | 场景 |
|---|---|
| 内建报告 `standard` 是四张 page（`report` / `attempts` / `traces` / `attempt`），其中三张进导航、第四张是 `navigation: false` 的参数化 attempt-input page，页内容全部由公开组件组成，与 `--report` 同内容文件完全等价 | 正例：裸宿主装载的 definition 与内建入口默认导出同引用；正例：内建定义四张 page 的 id、标题、`input`/`navigation` 与逐页组件构成和 built-in.md 全文一致；正例：`standard.pages` 第四项与具名导出 `standardAttemptPage` 同引用 |
| 内建入口是视图集合：每个内建视图按名字具名导出（当前只有 `standard`），默认导出恒等于 `standard` | 正例：默认导出与 `standard` 同引用 |
| `defineReport({ extends: base, … })` 在整份报告上叠外壳：页列表取 base 的页列表（同引用）；外壳字段声明即整字段覆盖、未声明沿用 base；产物是普通 `ReportDefinition`，可再被 extends | 正例：无外壳字段的 `defineReport({ extends: standard })` 逐页两面渲染与内建逐字节相同；正例：`defineReport({ extends: standard, title, links })` 页列表与 `standard` 逐项同引用、`ctx.report.title` 取自定义 `title` 且 links 生效；正例：二级 extends 链的页列表仍与 `standard` 同引用且外壳按最近声明取值（声明整字段覆盖、未声明沿用） |
| `Hero` 组合组件缺省取 `ctx.report.title`（回退链后的站点标题），显式 `title` prop 覆盖；与手写 `<HeroCard title={…} data={await heroData(ctx.scope)} />` 严格等价 | 正例：声明 `title` 后 `<Hero />` 两面输出含该标题且与浏览器标题同源；正例：显式 `title` prop 覆盖声明；正例：与手写组合渲染深等 |
| `heroData`：`latestStartedAt` 取范围内最新快照开始时间（空范围为 null，不编造当前时间）、`snapshots` 计贡献快照数；`HeroCard` 在 snapshots > 1 时 web 面标注合成来源 | 正例：多快照 fixture 标注「由 N 次运行合成」；边界：空 Scope 显示「暂无运行」且 `latestStartedAt` 为 null |
| `CopyFixPrompt`：prompt 在 resolve 阶段算好并烘进静态 HTML，无 JS 时折叠块内完整可读，复制是增强层行为；`failures` 为 0 时两面零输出；text 面恒零输出 | 正例：两失败 fixture 的 prompt 含 eval id、主失败摘要与 attempt 下钻命令；边界：全 passed 时无任何节点；反例：show 输出不含 prompt 文本 |
| `TraceWaterfall`：web 面每 attempt 一行静态渲染顶层 span 分解条（失败 span 带失败标记），行链接 attempt 详情；text 面每 attempt 一行含 locator、总耗时、span 计数与可复制的 `--timing` 下钻命令；trace 缺失的 attempt 行照常出现并如实显示缺失 | 正例：两 attempt（一含失败 span）两面各自正确且 spans 按 startOffsetMs 升序；边界：缺 trace.json 的 attempt 的 `durationMs` 为 null 且行不消失；反例：runner 生命周期节点不进瀑布行 |
| `AttemptList` 的 `filter` 是 web 面渐进增强过滤框，不改变数据、行集合与 text 面输出 | 正例：有无 `filter` 时初始行集合与 text 输出相同 |
| `unreadable-snapshot`：扫描结果根遇到 schema 不兼容 / malformed / incomplete 快照时形成 Scope warning（`dir`、`reason`），schema 不兼容带 `npx niceeval@<producer.version>` 的 `command`；非实验作用域，`scope.filter` 修剪时保留；非 niceeval JSON 静默忽略不触发 | 正例：malformed 快照产生 warning 且其余快照照常计入；正例：incompatible 的 warning 带版本化 command；边界：`filter` 收窄后该 warning 仍在；反例：目录里的无关 JSON 不产生 warning |

## 组件解析（resolve）与组合组件

契约来源：[Architecture](../../../feature/reports/architecture.md)「组件模型」「报告树与两个宿主」、[Library · 排版原语与自定义组件](../../../feature/reports/library/layout.md)、[Library · 指标组件](../../../feature/reports/library/metric-views.md)、[Library · 外壳与多页](../../../feature/reports/library/shell.md)。

| 契约 | 场景 |
|---|---|
| spec 形态与「先手工调 `*Data` 再传 `data`」严格等价：同一 spec 经管线 resolve 与手工计算渲染出相同终值、覆盖率与 refs | 正例：`MetricScatter` spec 形态与 data 形态两棵树渲染深等；反例：同一组件同时给 `data` 与 spec 字段报完整用户反馈 |
| spec 形态 `input` 省略时取宿主注入的 Scope，显式 `input` 覆盖数据来源 | 正例：`ScopeSummary input={scope.filter(...)}` 只统计收窄后快照；正例：`MetricTable input={exp.snapshots}` 按快照出行 |
| resolve 记忆化：一次页渲染内同引用 `input` + 深相等 spec 只计算一次；深相等中函数与 Metric / Dimension / NumericAxis 实例按引用比较 | 正例：Matrix 与 Bars 同 spec 时计算函数只被调一次；反例：不同 spec 或不同 `input` 各自计算；边界：两个字段相同但实例不同的 Metric 各自计算、不报错 |
| `ReportNode` 全集：元素、数组 / Fragment（展平保序）、null / undefined / boolean（渲染为空）；裸字符串与数字在树校验时按完整用户反馈拒绝并指引包 `Text` | 正例：`groups.map(...)` 数组与 `cond && <X />` 两面渲染正确；反例：树中放裸字符串报错文案含 Text 指引 |
| 组合组件在 resolve 阶段以 `(props, ctx)` 调用并递归展开返回树；`ctx` 携带 `scope`、`results`、规范化声明 `report`（`pages` 逐项含 `id`/`title`/`input`/`navigation`）与当前页判别 `page`；async 组合可用 | 正例：组合组件树与手写等价树渲染相同；正例：`ctx.results` 取历史快照喂 `input`；正例：`ctx.report.title` 是走完回退链的标题、`ctx.report.pages` 逐项含 `input`/`navigation`；正例：scope-input page 内组合组件收到 `ctx.page` 为 `{ id, input: "scope" }`；正例：attempt-input page 内 `ctx.page` 为 `{ id, input: "attempt", locator, evidence }`，`evidence` 与宿主装配的 `AttemptEvidence` 同引用 |
| 同层 sibling 并行取数与展开，输出保持声明顺序 | 正例：慢 resolve 在前、快 resolve 在后时输出顺序不变 |
| 非法节点在展开遇到时以完整用户反馈拒绝且不为其取数：React 组件、未经 `defineComponent` 的普通函数、任意 HTML intrinsic | 反例：树中放裸函数组件报错文案可 snapshot；反例：`<div>` 同样拒绝 |
| `defineComponent` 两种形态：函数形态产出组合组件；对象形态缺 `text` 或 `web` 在定义时报错（TS 编译期 + 无类型 JS 运行期） | 正例：函数形态产物可入树；反例：只给 `web` 的对象形态定义时报完整用户反馈 |

## MetricScatter 点标签布局（web 面）

契约来源：[Library · 指标组件](../../../feature/reports/library/metric-views.md)「MetricScatter」。布局是 `chart-math` 的纯几何函数，场景直接对函数断言标签框与点框的几何关系，不经 HTML。

| 契约 | 场景 |
|---|---|
| 标签从点四周候选位择优：存在无冲突候选时，标签不与其它标签重叠、不遮盖任何数据点、不越出画布；全候选冲突时取重叠最小者，不丢标签 | 正例：三点近重合 + 正下方另一点的簇，标签框两两不叠且不压任何点框；反例：只向下推的级联布局会把第三个标签推到下方点上，可区分 |
| 无冲突时标签取点右侧紧邻位且不带 leader 标记；离开左右紧邻位的标签带 leader 标记；靠画布右缘的点标签整体落在画布内 | 正例：稀疏两点右侧紧邻、无 leader；边界：右缘点锚到左侧紧邻位、标签框不越出画布、无 leader 标记 |

## labels 维度、series 归类与 connect

契约来源：[Library · 指标与维度](../../../feature/reports/library/metrics.md)「维度与数值轴」、[Library · 指标组件](../../../feature/reports/library/metric-views.md)「MetricScatter」、[Library · 概览组件](../../../feature/reports/library/summaries.md)「ExperimentComparison」、[Show · 默认报告](../../../feature/reports/show/default-report.md)、[Experiments Library](../../../feature/experiments/library.md)「labels」。

| 契约 | 场景 |
|---|---|
| `label()` 读快照 `ExperimentRunInfo.labels` 的声明值作分组维度，报告不从 experiment id 字符串猜；`numericLabel()` 只接受 number 值 | 正例：`label("line")` 按声明值分组；边界：未声明该键的实验归 `(missing)`；反例：`numericLabel` 对字符串值返回 null，不猜序 |
| series 类选项接受非空数组解析为复合维度：name 依声明顺序以 ` × ` 连接，值以 ` · ` 连接，缺失成员沿用 `(missing)` 参与连接 | 正例：`["agent", label("memory")]` 的 seriesDimension 与行 series 值；边界：单成员数组等价于单维度 |
| `ExperimentComparison` series 缺省解析：Scope 内任一实验声明 label `line` → `label("line")` 并连线，否则 `"agent"` 不连线；显式 series 覆盖缺省 | 正例：声明 line 时为 "line"；无 line 时回落 "agent" |
| `MetricScatter` 默认不连线，`connect` 显式开启：web 面每 series 按 x 升序折线；text 面不在坐标图画折线，图例按 x 升序 `→` 串联并给逐段位移摘要（两轴带符号差），标题行尾标注归类维度 | 正例：connect 关时无 polyline 也无箭头；正例：connect 开时折线点序、图例箭头与位移摘要；边界：单点 series 无箭头无摘要 |
| text 散点标记按图例顺序分配：series 显示键字典序、series 内 x 原始值升序；无 series 时按点键字典序 | 正例：两 series 各两点的 A–D 分配顺序；边界：无 series 时按 key 字典序 |
| 同图 series 配色以稳定散列为起点，图内撞色按图例顺序线性探测下一个空色格，超过色板数才复用 | 正例：散列同格的两个 series 在同图不同色；正例：无冲突的键仍取散列格（跨图稳定）；边界：第 7 个 series 开始复用颜色 |

## text/web 双面同源

契约来源：[Architecture](../../../feature/reports/architecture.md)、[View](../../../feature/reports/view.md)、[Show](../../../feature/reports/show.md)、[Library · 实体列表](../../../feature/reports/library/entity-lists.md)。

| 契约 | 场景 |
|---|---|
| 双面组件的 text 与 web 显示同一份解析终值、覆盖率、判定构成和 warning，渲染不重算不丢值 | 正例：partial cell + warning 两面都含 "50%"、"1/2" 和 warning 文本；不要求逐字相同 |
| `validateReportTree` 拒绝缺任一渲染面的组件与任意 HTML intrinsic，报错为完整用户反馈 | 反例：树中放 `<div>` 或单面组件时校验失败，错误文案可 snapshot |
| web 面排序/过滤只改变浏览状态，不改变数据、口径或初始 HTML 中的数值 | 正例：有无 filter prop 时数值与行集合相同 |
| `ExperimentList` web 面是固定八列比较表，可见列名使用“Pass rate / 通过率”，默认按 `endToEndPassRate` 降序；标签与排序箭头同行；Model 缺失显示明确空值；Eval 数不翻成“题” | 正例：断言双语列名与顺序、默认降序标记、`8 evals` / `8 个 Eval`；边界：model 缺失；反例：taskPassRate 高但 executionReliability 低的实验不能排到端到端通过率更高者之前 |
| `ExperimentList` text 面保持实体层级：Eval 父行、Attempt `├─`/`└─` 子行，不压平 | 正例：一题两 attempt 只出现一次 Eval 标题 |
| `ExperimentList` / `EvalList` 的 Eval 父行只承载折叠判定与题级聚合，失败摘要只在 Attempt 子行出现；父行不因 verdict 改变同一位置的字段含义（[bug 台账](../../../../memory/eval-parent-repeats-attempt-failure.md)） | 反例：单个 failed / errored Attempt 的摘要在展开树中出现两次；正例：failed Eval 父行仍显示平均耗时与平均成本 |
| `ExperimentList` 行标签默认缩成最短唯一后缀，web 与 text 两面缩短结果一致；完整 id 仍用于排序键 / 过滤 / 折叠 | 正例：`compare/bub-gpt-5.4--agents-md` 单独出现时两面都显示 `bub-gpt-5.4--agents-md` 且 `data-sort-value` 仍是完整 id；正例：末段撞名的两个 id 两面都加长到相同的可区分后缀 |

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
| `Grid` 的直接子节点按 `ReportNode` 规则展平：数组 / Fragment 递归展开、空分支（null/undefined/boolean）不占格，任意 `ReportNode` 都可作为一格，`Col` 把多个子节点归成一格 | 正例：`groups.map(...)` 产生的数组与条件渲染的 `cond && <Stat .../>` 都正确展平且两面顺序一致；正例：`<Col><Stat/><Stat/></Col>` 在两面都是同一格；正例：非 `Stat` 的普通节点也能作为一格；边界：全部子节点为空分支时 0 格 |
| `columns` 必须是有限正整数：0、负数、小数、`NaN`、`Infinity` 在组件创建时报完整用户反馈；`1` 与大于实际 cell 数都正常；`variant` 缺省 `"plain"`、`density` 缺省 `"regular"` | 反例：`columns={0}`/`columns={-1}`/`columns={1.5}`/`columns={NaN}`/`columns={Infinity}` 各自报错且文案含收到的值、原因与 `columns={N}` 下一步；正例：`columns={1}` 与 `columns` 大于 cell 数都正常渲染；正例：省略 `variant`/`density` 时两面呈现默认档 |
| `Grid` web 初始 HTML 含全部 cell、稳定 `nre-grid`/`nre-grid-cell`/variant/density 类名与 `--nre-grid-max-columns` 事实，无 JS 完整可读 | 正例：静态 HTML 逐 cell 断言存在且顺序正确；正例：boxed/compact 的类名与自定义列数事实分别可见；反例：不出现本组件引入的 script/hydration 标记 |
| `Grid` text 面按声明 `columns` 向下规划显示列数：目标运行总览示例在恰好 100 显示列降为三列，继续变窄降为一列；任意宽度下声明序、label/value/detail 全部保留不丢格 | 正例：100 列时两个 Grid（columns=6/columns=9）分别降到三列且逐行 `stringWidth <= 100`；正例：极窄宽度降为一列且 21 个 Stat 全部存在、索引顺序递增；反例：不隐藏、不截断任何 cell |
| `variant="boxed"` 给每个 cell 独立完整四边框，同行以 density 对应 gutter 分隔，换行重新起框；`variant="plain"` 复用同一 plan 只去掉边框与内边距；`density="compact"` 收紧留白但不合并或丢弃字段 | 正例：boxed 每个 cell 有完整 `┌─┐`/`│ │`/`└─┘`；正例：plain 与 boxed 用同一列数与内容宽；正例：compact 三个字段仍全部可见，只留白更紧 |
| `Stat` 的 `label`/`value`/`detail` 按 `LocalizedText` 回退、number 按 locale 格式化、`null` 显示 `—`、数字 `0` 正常显示；`detail` 省略不留空行；四种 `tone` 只染 value 且不自动推导 | 正例：en/zh-CN 两 locale 下 label 与 detail 各自解析；正例：`value={0}` 显示 `0` 而非 `—`，`value={null}` 显示 `—`；正例：省略 detail 时 text 面不留空行；正例：四种 tone 的修饰符 class 落在 `nre-stat` 根节点、label 与 detail 不随 tone 换色，text 面不出现 `positive` 等内部词 |
| `Section.meta` 是标题行右侧短补充：web 面同行右对齐、空间不足换到下一行；text 面优先同行右对齐、放不下以一层缩进换行；省略 `meta` 时旧 Section 输出不变 | 正例：短 meta 与标题同行右对齐；边界：长 meta 换行仍完整可读；正例：无 `meta` 的 Section 渲染与改动前逐字节相同 |
| 同一份含 `Section.meta` + `Grid` + `Stat` 的公开报告文件经 `show` 与 `view` 渲染同一批终值（label/value/detail/meta），不要求两面布局逐字一致 | 正例：两面都含相同的 meta 文本、全部 label/value/detail；text 面按宽度减列、web 面是 Grid 结构，不逐字比较布局 |

## show/view 宿主等价与选择

契约来源：[README](../../../feature/reports/README.md)、[Architecture](../../../feature/reports/architecture.md)、[Show](../../../feature/reports/show.md)（分篇：[`--timing`](../../../feature/reports/show/timing.md)、[`--report`](../../../feature/reports/show/reports.md)、[默认报告](../../../feature/reports/show/default-report.md)）、[View](../../../feature/reports/view.md)。

| 契约 | 场景 |
|---|---|
| 裸 `show` 与裸 `view` 把同一 Scope 交给同一份内建报告定义（`niceeval/report/built-in` 默认导出）；`--report` 替换同一报告槽 | 正例：装载边界捕获两宿主的 definition 同引用、scope 深等 |
| 两宿主对 `--results` / `--exp` / 位置参数用同一套选择规则；局部补跑/过旧/未完成快照形成结构化 warning 随 Scope 携带 | 正例：未完成快照在两宿主产出相同 warning 集 |
| `--history` 对匹配的每个 experimentId + evalId 分节，按 attempt 身份键跨快照去重、startedAt 升序逐 attempt 列出时间 / verdict / 单行摘要 / 耗时 / 成本 / locator；与 `--report` 互斥 | 正例：跨快照重跑去重后逐轮列出且升序；反例：与 `--report` 同用按用法错误非零退出 |
| `ScopeWarnings` 按动作聚合：同 `experimentId` 的多 kind 警告聚合为一组，组头含实验 id、每条警告一枚 kind 徽标（模板取 kind 表）与去重后的一条可复制命令；命令去重后多于一条的组组头不放命令、命令随明细走 | 正例：partial-coverage + stale-snapshot 同实验成一组，组头命令恰一条 `niceeval exp <真实 id>` 且两枚徽标齐全；反例：不同实验不进同一组 |
| 组排序与回退：`integrity` 组排在 `freshness` 组之前，混合组按最重成员归位；kind 表未登记模板的 kind 单独成组、逐条渲染 `message` 原样并按 `integrity` 归位 | 正例：仅 stale 的实验组排在含 partial-coverage 的实验组之后；边界：未知 kind 条目单独成组且 message 完整可见 |
| web 面整个警告区是默认折叠的 `<details>`，`<summary>` 是分类计数汇总行、任何组数下都渲染；text 面汇总行只在组数 > 1 时输出，单组时组头即汇总 | 正例：两组与单组的 web 面都以汇总行为 `<summary>` 且外层无 `open`；边界：单组 text 面无汇总行 |
| 明细折叠：web 面每组逐条 `message` 收进第二层 `<details>`，警告总条数 ≤ 3 时该层默认展开；text 面不折叠，组头一行（标题、徽标、命令）下缩进逐条原样打印 `message`（已以下一步收尾，不截断掉尾段） | 正例：4 条警告时组级 `<details>` 无 `open`、3 条时有（外层恒无 `open`）；正例：text 面组头下缩进输出以忽略条件/命令收尾 |
| 显示时下一步随行：web 面带 `command` 的条目渲染为可复制命令，无 `command` 的只显示 message 不硬造动作；空警告集两面零输出；裸 `Snapshot[]` 输入渲染为空 | 正例：stale-snapshot 在 web 面出现复制动作且值为 `niceeval exp <真实 id>`；反例：missing-startedAt 形态的无 command 条目在 web 面无复制动作；边界：空 warnings 不渲染容器节点 |
| `view` 位置参数与 `--exp` 收窄对全部页生效（含内建 Attempts 页）；attempt 详情路由对完整结果根解析，被滤掉的 attempt 深链仍可打开 | 正例：收窄后 Attempts 页行集缩小，`#/attempt/@<locator>` 对被滤掉的 attempt 仍解析成功 |
| `show` 中漏写 `@` 的 locator 按 eval id 前缀处理并明确报无匹配、列出候选 | 反例：输入 "1qrdcfq8" 报 "No results matched" 附候选 |
| 报告定义存在 `input:"attempt"` page 时，locator 输出（Table、Experiment/Eval/Attempt/Failure list、`TraceWaterfall`、`CopyFixPrompt`）在两面生成寻址链接/命令：show 侧命令保留当前 `--results`/`--report`；view 侧生成到该 page 的链接 | 正例：自定义 `--report` 含 attempt page 时，`show` 输出的 locator 命令带 `--report <file>` 与 `--results`；正例：`view` 对应行是可点击链接 |
| 报告定义没有 `input:"attempt"` page 时，同一批 locator 输出在两面都只是纯文本，不生成空 href、假命令或回退到内建详情 | 反例：无 attempt page 的自定义 report，`view` 的 locator 单元格不含 `<a>`；反例：`show` 对应文本不含任何 `@<locator>` 之外的命令提示 |
| 裸 `show @<locator>`（无证据 flag）选择当前 report definition 中唯一的 attempt-input page，装配 `AttemptEvidence` 并按普通 page 管线 resolve/validate/渲染其 text 面，不再直接调用专用首页渲染函数 | 正例：自定义 `--report` 声明了非默认布局的 attempt page 时，`show @<locator> --report <file>` 输出该自定义布局的 text 面，而非内建固定首页文案 |
| `--source`/`--execution`/`--timing`/`--diff` 仍是直接读取 `AttemptEvidence` 的专用终端投影，不经过 page content，即使自定义报告删除了 attempt page 也不受影响 | 正例：无 attempt page 的自定义 report 下 `show @<locator> --diff` 仍正常输出；反例：同一情形下裸 `show @<locator>`（无 flag）报错 |
| 自定义报告没有 attempt page 时，裸 `show @<locator> --report <file>` 按完整用户反馈报错，指引 `extends: standard`、加入 `standardAttemptPage` 或声明自己的 page；不回退到内建详情 | 反例：报错文案含三种解决路径中至少一种的具体写法 |
| 报告声明 attempt page 时，站点为收窄后有效根内每个可达 locator 生成一份 `attempt/<encodeURIComponent(locator)>.html`；收窄之外的 locator 不生成文件，深链如实显示证据缺失 | 正例：`--exp` 收窄后 `attempt/` 文件数等于该收窄下去重 locator 数；反例：收窄外 locator 没有对应文件 |
| 直接打开 `attempt/<locator>.html`（无 JavaScript）即可读到完整 attempt page 内容：身份、verdict、断言/source、时间树、diagnostics、usage、对话、trace、diff 摘要都已在初始 HTML 中 | 正例：关闭 JS 场景下上述字段全部可从初始 DOM 读到，不依赖任何异步 fetch |
| 增强脚本拦截 locator 链接后，dialog 内容与直接打开该 HTML 文档的内容是同一份 server-rendered 字节/DOM 片段，不维护客户端镜像渲染 | 正例：dialog 打开后的内容片段与对应 `attempt/<locator>.html` 该区域的静态内容一致 |
| `--timing` 自身就是 Attempt 证据切面，单独使用必须进入有界诊断时间树；首页 timing 只列大头，短的 baseline / telemetry bookkeeping 留给时间树 | 正例：locator + 单独 `--timing` 不回落首页；边界：短 telemetry 省略、慢 telemetry 保留 |
| detail node 不超过 80 时，裸 `--timing` 与 `--timing=full` 展开相同节点；phase 行和 omission 行不占预算 | 正例：79/80 节点无 omission；边界：81 节点出现 omission；反例：不能省略 lifecycle phase |
| 超预算时间树按失败路径 40、最慢路径 20、最早/最晚各 10 的节点池稳定取样，选中深层节点时保留祖先并占池额度，未用额度按契约再分配；平局用 `startOffsetMs` / `id` | 正例：慢 command、深层失败 span 与首尾样本均保留；边界：失败路径自身超过预算时省略行报告未展示 failed 数；边界：无失败时空余额流给其它池 |
| omission 在被截断子树原位报告省略节点数与失败数，并给出同 locator 的 `--timing=full`；不计算 children combined duration | 正例：3,302 个旧 command 默认输出有界且提示 full；反例：并发 sibling 不相加、不能写虚假的 combined time |
| `--timing=full` 展开全部 runner timing node 与全部唯一关联 OTel span；`--timing=summary` 与裸 flag 等价，其它 mode 非零退出 | 正例：旧 artifact 的 3,302 个 command 在 full 中全部可见；反例：`--timing=verbose` 报用法错误 |
| `operation` 的语义 label 来自 producer，renderer 不解析 command display、不执行 artifact callback、不按 shell family 猜分组 | 正例：workspace.diff 的批量 operation + 单个 command；反例：路径各异的 `git show` 不被 renderer 猜成 `git show ×N` |
| TTY、pipe、CI 对同一 timing mode 选择相同节点且不自动启动 pager | 正例：stdout capture 与 TTY fixture 的节点集合相同；反例：非交互命令不读 stdin、不挂起 |
| 扫描结果根时单个不可读快照不阻塞其余：忽略/incompatible/malformed/incomplete 各带原因 | 四种坏快照各一 fixture，好快照照常计入 |
| 零可读结果时命令失败：show 非零退出（旧格式建议 `npx niceeval@<version>`）；view 不启动 server、`--out` 不生成空站 | 边界：空结果根与仅含旧格式两种 |
| `--out` 无档位：收窄范围内存在且前端会读取的证据文件（sources 引用及其快照级 `sources/<sha256>.json` 正文 / events / trace / diff）全部复制，缺的在证据位置显示缺失；`o11y.json` 永不复制 | 正例：带 diff.json 的根导出后 diff 可下钻；正例：导出站离线打开源码视图可取到正文；边界：携带条目（artifactBase 指向原快照）的源码正文被归拢进本快照 `sources/`，删除原快照后导出站源码仍可读；边界：无 diff.json 的根导出后 diff 位置显示缺失原因；反例：o11y.json 不进 `artifact/` |
| `--out` 接受位置参数 / `--exp` 收窄，页面 Scope 与 `artifact/` 证据树跟随同一收窄；不收窄导出完整根 | 正例：`--exp compare --out site` 只含该路径快照与报告数据；正例：eval id 前缀导出时不匹配 attempt 的证据不出站；反例：被滤掉实验的 artifact 不出站 |
| 本地宿主的 attempt 详情路由越过收窄对完整结果根解析；导出站对范围外 locator 的深链在证据位置如实显示缺失 | 正例：本地 `--exp compare` 下 dev-e2b attempt 的 `#/attempt/@<locator>` 仍解析成功、证据可 fetch；正例：收窄导出站里同一 locator 显示证据缺失而非报错白屏 |
| `--snapshot` 指定单个快照文件时该文件不可读令 view 失败（与扫描模式的跳过相反）；view 位置参数只表示 eval id 前缀，不接受文件或目录 | 反例：损坏文件经 `--snapshot` 报错退出；正例：同文件在扫描模式仅被跳过；反例：文件路径作位置参数按 eval 前缀报无匹配 |
| 落盘无 phases 时 summary/full timing 都如实输出 unavailable 不猜；有 phases 时主链之和 ≤ total，收尾段 `+N` 不计入 total | 正例：含 teardown 的 fixture；反例：无 phases 的第三方结果；边界：errored 中途时最后主链阶段带 `✗` |
| 本地 server 与 `--out` 消费同一份站点产物：同一结果根与同一收窄下，同一路径在两宿主逐字节一致（`index.html`、全部 `attempt/*.html` 与全部 artifact 文件），两宿主不各自携带取数或布局知识 | 正例：对同一结果根（含带收窄的输入），导出目录的每个文件——含每份 `attempt/<locator>.html`——与 server 对同路径的响应字节相等（含解引用后的 sources）；反例：server 除产物清单内路径外不提供其它路径 |
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

## Attempt 参数化 page 与详情组件族

契约来源：[Library · Attempt 详情组件](../../../feature/reports/library/attempt-detail.md)、[Architecture](../../../feature/reports/architecture.md)「Attempt 详情是一张参数化 page」。台账：[view-attempt-detail-buries-failure](../../../../memory/view-attempt-detail-buries-failure.md)（断言区缺失、timing 树压顶如何逃逸到真实使用）、[attempt-detail-is-a-parametrized-page](../../../../memory/attempt-detail-is-a-parametrized-page.md)（详情从宿主路由内容翻案为参数化 page 的裁决）。

| 契约 | 场景 |
|---|---|
| `AttemptEvidence` 由 `loadAttemptEvidence` 一次装配；11 个叶子的 `attempt*Data(evidence)` 只做同步/纯派生，不读文件、不 fetch、不重复调用 `attempt.events()` / `attempt.trace()` / `attempt.diff()` | 正例：spy 底层 IO 方法后 resolve 一张 attempt page 只触发一次装配；正例：对同一份 fixture evidence 依次调用全部 11 个 `attempt*Data`，互不触发额外 IO |
| 11 个叶子组件的非空/空证据矩阵：`AttemptSummary` 恒非空；其余 10 个在对应能力位为空时零输出（`AttemptError` 无 error、`AttemptAssertions` 无 assertion、`AttemptSource` 无 source、`AttemptFixPrompt` passed 或无可操作失败、`AttemptTimeline` 无 phase、`AttemptConversation` 无 events、`AttemptDiagnostics` 无 diagnostics、`AttemptUsage` 无 usage、`AttemptTrace` 无 trace、`AttemptDiff` 无变更） | 表驱动：11 行 ×{完整证据, 该项证据缺失} 两态，零输出态断言两面都不产生可见节点，非零输出态断言两面都含预期字段 |
| `AttemptSummary` 的 `startedAt`（未定义时不渲染该字段，不留空占位）与 `identity.attempt`（0 起序号，显示前 +1）两面都要可见，不止 verdict/locator | 正例：完整证据两面都含格式化后的开始时间与 attempt 序号(如 "attempt 2")；反例：`startedAt` 为 `undefined` 时两面都不产生对应字段 |
| `AttemptAssessment` 只表达 `AttemptError` + `AttemptSource`/`AttemptAssertions` 二选一：`evidence.capabilities.source` 为真时放 `AttemptSource`，否则放 `AttemptAssertions`；不在 attempt-input page 之外调用时报错 | 正例：有 source 的失败 attempt 展开树含 `AttemptSource` 不含 `AttemptAssertions`；正例：无 source 时相反；反例：`ctx.page.input !== "attempt"` 时 resolve 报完整用户反馈 |
| `AttemptDetail` 按内建顺序装配详情；有 source 时 `AttemptSource` 已承载按 loc 展开的回复，不再重复独立 `AttemptConversation`，无 source 时才在 usage 后放 `AttemptConversation` fallback | 正例：有 source 的一级子节点序列不含 `AttemptConversation`；反例：无 source 时序列含 `AttemptConversation` 且仍在 `AttemptUsage` 与 `AttemptTrace` 之间 |
| Attempt 详情 web 输出与官方 stylesheet 共同形成零依赖可读布局，不能只有 `nre-*` 标记而让详情标题、KPI、源码、usage 与对话整体退化成浏览器 UA 默认排版 | 正例：完整证据的独立 attempt 文档装入 DOM 后，summary head 为 flex、KPI 与 usage 为 grid、源码容器可横向滚动且源码文本保留空白、对话为分组纵向布局；反例：只注入通用 `.nre` / `.nre-col` 样式时这些 computed layout 断言失败。bug: [attempt-detail-components-shipped-without-styles](../../../../memory/attempt-detail-components-shipped-without-styles.md) |
| `AttemptSource` web 面保留旧 `CodeView` 的 GitHub diff 式证据交互与密度：TypeScript token 有语义 class，send / passed / gate-failed / soft-failed 行有不同状态 class，只有含 send/assertion 的行可点击展开，send 行内含按 `loc` 归并的完整回复；源码普通行之间不画横向分隔线，展开回复直接接在源码行下，不另套 turn 卡片或重复 sent prompt；首个失败或警告行默认展开 | 正例：含普通代码、send+assistant reply、passed gate、failed gate、failed soft 的源码 fixture，静态 HTML 含 token class、四种行状态与回复正文；反例：普通代码行不是 `<details>`；正例：failed / soft 行带 `open`；真实浏览器核对普通源码行无横线、展开区无二级卡片。bug: [attempt-detail-components-shipped-without-styles](../../../../memory/attempt-detail-components-shipped-without-styles.md) |
| 叶子组件的 spec 形态省略 `input` 时取当前 attempt-input page 注入的 evidence；显式 `data` 与手工 `attempt*Data(evidence)` 结果深等；放在 scope-input page 且未显式传 `input`/`data` 时 resolve 报完整用户反馈并指引移到 attempt-input page 或传入 evidence | 正例：`<AttemptSummary />` 在 attempt page 内的 spec 结果与手工 `attemptSummaryData(evidence)` 深等；反例：`<AttemptSummary />` 放进 scope-input page 报错文案含"移到 attempt-input page"或"传入 evidence" |
| text/web 两面共享同一次 resolve 产出的 data 事实（verdict、计数、能力位、引用），不逐字比较布局；text 面允许把大块内容折成摘要 + 专用证据命令（`--source`/`--execution`/`--timing`/`--diff`），但不得改变判定、计数或引用 | 正例：同一 fixture 的两面都显示相同 verdict、相同失败计数、相同 attempt 引用；不要求文本长度或视觉结构相同 |
| `AttemptConversation` 数据来自 `AttemptEvidence.events`（标准事件流），按 `loc` 分轮：无 `loc` 的 user 消息不开新轮（同文本回显吃掉、轮内注入按 `kind:"user"` 留在当前轮）；事件按条目容错，未识别类型包成 `view.raw` 原样呈现且不吞没其余事件；`skill.loaded` 是一等回复条目 | 正例：send（带 loc）后紧跟同文本无 loc 回显，回复仍全部聚到 send 行；正例：混入完全未知的事件类型时该条目原始 JSON 保留、其余事件照常聚合；正例：`skill.loaded` 显示 Skill 名不伪装成工具调用；边界：流首无 loc 的 user 消息（旧 artifact）仍开 noloc 轮 |
| 断言区（`AttemptAssertions`/`AttemptSource`）默认展开 failed / unavailable 与影响判定的 soft；passed 按 group 折叠计数；每条失败直接显示 matcher、expected / received 或 reason，并提供源码锚 | 正例：1 gate-failed + 1 unavailable + 两 group 共 3 passed 的 fixture，前两者默认可见、passed 折叠且计数为 3；反例：全 passed 时无默认展开条目，只有折叠区；正例：失败条目静态渲染即含 expected / received 的值，且锚指向该断言的源码行 |
| `AttemptTimeline` 默认只显示 phase 主链与收尾段；children（hook / 命令 / turn）收合在原生 `<details>` 里，失败最深节点带失败标记 | 正例：默认（无 `open`）时 children 不可见，标记 `open` 后逐层可见；边界：errored attempt 只有最深失败节点带 ✗，祖先不重复标记 |

## 外壳、页面与 Tabs

契约来源：[Library · 外壳与多页](../../../feature/reports/library/shell.md)、[Library · 内建报告](../../../feature/reports/library/built-in.md)、[Library · Tabs](../../../feature/reports/library/layout.md)、[Architecture](../../../feature/reports/architecture.md)「外壳与页：装载规范化」、[Show](../../../feature/reports/show.md)、[View](../../../feature/reports/view.md)。

| 契约 | 场景 |
|---|---|
| `--report` 文件默认导出恒为 `defineReport` 产物；装载规范化唯一产物是「外壳 + 非空页列表」：`defineReport(树)` ≡ `{ content: 树 }` ≡ `pages: [{ id: "report", title: 内置页名, content: 树 }]`，任何形态走同一条装载管线；非 `defineReport` 产物的默认导出报完整用户反馈 | 正例：三种写法装载出等价的规范化结果（唯一页 id 为 `report`）；反例：默认导出普通对象或 React 组件时报完整用户反馈 |
| `content` / `pages` / `extends` 恰好声明一个：多选或都省略装载报错，报错文案给出下一步——要内建报告写 `extends: standard`（`import { standard } from "niceeval/report/built-in"`） | 反例：`content` 与 `pages` 同时声明报完整用户反馈；反例：`extends` 与 `pages` 同时声明报完整用户反馈；反例：都省略报错且文案含 `niceeval/report/built-in`；正例：`defineReport({ title, links, content: <ExperimentComparison /> })` 渲染内建首页内容并带自定义外壳 |
| `extends` 只收 `defineReport` 产物：普通对象、React 组件或报告树装载报错（TS 编译期拒绝，无类型 JS 输入装载期同样校验） | 反例：`extends: {}` 与 `extends: <ExperimentComparison />` 各报完整用户反馈 |
| 页不嵌套外壳：`content` / `page.content` 只接受报告树节点，`defineReport` 产物放进任何 content 或树中装载报错（TS 编译期拒绝，无类型 JS 输入装载期同样校验） | 正例：具名导出的树与组合组件节点都可直接作 `page.content`；反例：页里放 `defineReport` 产物装载报错 |
| 裸 `show` / 裸 `view` 装载 `niceeval/report/built-in` 的默认导出，与 `--report` 同一条 `装载 → resolve → validate → render` 管线 | 正例：裸宿主装载的 definition 与该默认导出同引用 |
| show 渲染初始页（`--page` 或第一页）的 text 面，页数大于一时在页输出之后附其余页的索引与可复制 `--page` 命令，不倾倒其余页内容；单页定义无索引段 | 正例：双页定义输出含第一页内容与另一页的索引命令、不含另一页内容；边界：单页定义直接渲染且无「其余页」段 |
| `--page` 未命中页 id 时按用法错误非零退出并列出可用页 id；单页定义的唯一页 id 是缩写展开出的 `report` | 反例：`--page typo` 报错附 overview / exam；边界：对树形态文件 `--page report` 命中唯一页，`--page typo` 报错列出 `report` |
| `show` 输出的页索引命令保留当前 `--results` / `--report` 与位置参数上下文，复制即可复现下一页 | 正例：`--results` 下页索引命令含 `--results`；`--exp` 收窄被保留 |
| 全部页共享宿主注入的同一 Scope，位置参数与 `--exp` 收窄对全部页生效；页不承担数据过滤 | 正例：两页的解析 refs 来自同一收窄后 Scope |
| 本地宿主只 resolve 被打开的页；静态导出 resolve 并校验全部页，任一页失败则导出整体失败 | 正例：打开 A 页时 B 页的取数未执行；反例：B 页含 `<div>` 时 `--out` 非零退出、不产出半套站点 |
| 标题取值链 def.title → Scope 中唯一且相同（LocalizedText 深相等）的快照 name → 内置文案「Eval 运行结果 / Eval Results」，落点是浏览器标题、show 页索引标题行与 `ctx.report.title`；`links` / `footer` 渲染进导航壳，text 面不含这些字段 | 正例：三级 fallback 各一 fixture，浏览器标题与 `ctx.report.title` 同源；边界：两快照 name 的 en 相同、zh-CN 不同时任何 locale 下都落内置文案；反例：show 输出不含 links href |
| `ReportLink.icon` 是内联 SVG 字符串（`{ svg }`）：web 面渲染在 label 前、静态导出原样内联；不收组件，show 不消费 | 正例：带 svg 的 GitHub 链接导航项含该 SVG；反例：无类型 JS 传 ReactNode 作 icon 装载报错；反例：show 页索引不含 svg |
| 宿主页头恒渲染报告改不动的 NiceEval 字标（外链官网、`utm_medium=brand`）；报告作者能声明的品牌只有 `PoweredBy`：无 props，web 面渲染指向官网的品牌行（href 含 `utm_source=report&utm_medium=powered-by`、`rel` 仅 `noopener`），text 面零输出；`Hero` / `HeroCard` 恒含品牌行、无拆除 prop；省略 `footer` 时不渲染页脚 | 正例：宿主导航壳 DOM 含 `class="brand"` 的 NiceEval 字标且外链官网；正例：内建报告每页 web 面含 `PoweredBy` 品牌行且 href 正确；反例：宿主壳无 hero 区、show 输出不含品牌行；边界：无 `footer` 时无页脚元素但品牌行仍在 |
| view 导航只有 `navigation !== false` 的 pages、按声明序排列，宿主不追加或保留任何导航项 | 正例：双页自定义定义的导航恰为 页A · 页B；正例：裸 view 导航为 报告 · Attempts · 追踪三项，`standard` 第四张参数化 attempt page 不出现在导航里；边界：树形态定义导航只有一项 report |
| `scripts` / `styles` 按声明序注入：styles 在官方样式后，scripts 在官方增强脚本后 `</body>` 前；初始静态 HTML 的数值不因注入改变 | 正例：注入前后初始 HTML 数据节点相同、注入顺序可断言 |
| `{src}` 资产相对报告文件解析，拒绝 `..` 路径段、绝对路径与 `~`；静态导出复制进 `assets/` 保持相对路径，缺失文件报错并给出解析后路径 | 正例：`./assets/a.js` 被复制；反例：`../x.js` 装载报错；边界：缺失文件在导出时报错 |
| `head` 标签白名单是 `meta` / `link` / `script` / `style`，白名单外与宿主自有单例（`title` 不在白名单、`meta charset`、`meta name="viewport"`）装载报错并指回对应契约 | 反例：`{ tag: "base" }` 装载报错；反例：`meta charset` / `meta viewport` 装载报错且文案指回 title 契约或宿主职责 |
| `head` 的 `attrs` 值为 `true` 渲染裸布尔属性，字符串渲染 `key="value"` 且值 HTML 转义；`script` / `style` 的 `children` 原样落进标签，内容含 `</script>` / `</style>` 时装载报错 | 正例：`{ async: true, src: 外链, "data-project": "a\"b" }` 渲染 `async` 裸属性且引号转义；反例：children 含 `</script>` 装载报错 |
| `head` 标签按声明序注入每页 `<head>`，落在官方与外壳样式之后；初始静态 HTML 的数值不因注入改变 | 正例：两个 head 标签注入顺序可断言且在外壳 styles 之后；正例：注入前后初始 HTML 数据节点相同 |
| `head` 的 `src` / `href` 按 scheme 分流：`http(s)://` 外链原样落标签、不进 `assets/`；本地相对路径走 `{src}` 同一路径纪律并物化为 `assets/<sha256><ext>`；protocol-relative `//` 与其它 scheme 装载报错 | 正例：GA4 外链 src 原样出现在 HTML 且 `assets/` 不含它；正例：`./favicon.svg` 改写为 `assets/<sha256>.svg` 且站点清单含该文件；反例：`//cdn.example/x.js` 装载报错 |
| `head` 不进 `ctx.report`（与 `scripts` / `styles` 同为注入资产）；show 不消费 `head` | 正例：声明 head 后组合组件 `ctx.report` 无该字段；反例：show 输出不含 head 标签内容 |
| `scripts` / `styles` 的 `{src}` 只收本地路径，外链装载报错并指引改写成 `head` 条目 | 反例：`{ src: "https://cdn.example/x.js" }` 装载报错且文案含 `head` 写法 |
| 重复或非法 page id 在装载时校验失败，报错列出冲突 id | 反例：两页同 id `exam`；反例：id 含大写或斜杠 |
| page 省略 `input` 时规范化为 `input: "scope"`、`navigation: true`；声明 `input: "attempt"` 的 page 必须显式 `navigation: false`，省略或传 `true` 时装载报错 | 正例：省略 input 的 page 规范化后 `input === "scope"` 且 `navigation === true`；反例：`{ input: "attempt" }` 不带 `navigation: false` 装载报错；反例：`{ input: "attempt", navigation: true }` 装载报错 |
| 一份 definition 最多声明一张 `input: "attempt"` 的 page，第二张同类 page 装载报错并指出冲突 page id | 反例：两张 `input: "attempt"` 的 page 装载报错 |
| 没有 locator 时不能用 `--page` / `#/page/<id>` 打开 attempt-input page；有 locator 时才注入对应 `AttemptEvidence` 并 resolve | 反例：`--page attempt`（无 locator）报用户错误，不拿 Scope 强行 resolve；正例：带 locator 时该 page 正常 resolve |
| show 的初始页选择、页尾"其余页"索引与 view 的导航、`--page` 可用列表只看 `navigation !== false` 的 pages；attempt-input page 从不出现在这些列表里 | 正例：`--page typo` 报错列出的可用 id 不含 attempt page id；正例：多页定义下 show 页尾索引不含 attempt page |
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
