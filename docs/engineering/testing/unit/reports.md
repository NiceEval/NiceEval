# Reports 怎么测

契约来源：[Reports](../../../feature/reports/README.md)、[Architecture](../../../feature/reports/architecture.md)、[Library](../../../feature/reports/library.md)、[Show](../../../feature/reports/show.md)、[View](../../../feature/reports/view.md)、[Observability](../../../observability.md)。

单元层证明 Reports 的**数据语义**：`*Data` 计算函数、指标聚合口径、resolve 管线、报告定义的装载规范化与校验反馈。观察面全部是数据——计算结果、规范化结构、错误对象与文案。本篇的缝：构造 Scope / evidence fixture 作输入，测其上的计算与装载逻辑；缝的真实侧（真实产物上的出口与渲染）由 [E2E 功能域 · 报告与读面](../e2e/report.md)验收（[Fake 边界](README.md#fake-边界mock-什么测哪一层)）。渲染出来的终端排版、DOM 结构、双面比对、样式与交互不在本层，归 [E2E 功能域 · 报告与读面](../e2e/report.md)对真实运行的产物验收（先例台账：[codeview-perline-hidden-scrollbar-clips-text](../../../../memory/codeview-perline-hidden-scrollbar-clips-text.md)、[attempt-detail-components-shipped-without-styles](../../../../memory/attempt-detail-components-shipped-without-styles.md)——渲染缺陷在单元层的 DOM 断言下照样逃逸，只有真实产物上的验收拦得住）。

## Fixture 规范

**计算 fixture 要有区分力**：通过率 fixture 应让几种常见错误算法得到不同答案。

```ts
const scope = reportScopeFixture({
  experiments: [{
    id: "compare/codex",
    evals: [
      { id: "a", attempts: ["passed", "failed", "passed"] }, // 题内 2/3
      { id: "b", attempts: ["passed"] },                     // 题内 1
      { id: "c", attempts: ["errored"] },                    // 端到端记 0
      { id: "d", attempts: ["skipped"] },                    // 不进有效样本
    ],
  }],
})
```

这个 fixture 中端到端两级聚合 = 5/9、排除 errored 的条件口径 = 5/6、attempt 平铺 = 3/5、先折叠 verdict 再计票 = 2/3——四个值彼此不同，测试才能发现口径被换掉。各题 attempt 数必须不同，否则两级聚合与平铺可能恰好相等。

**MetricCell fixture** 共享三种不能混淆的值：measuredZero（value 0、有样本）、partial（有值、覆盖率不满）、missing（value null、零样本）。每个组件至少验证 `null` 不被显示成 `0`、partial 保留覆盖率、refs 没有被渲染前计算丢掉。

## 观察面：数据级断言

1. **`*Data` 计算的事实**：数值、覆盖率、排序、缺失行为，全部数据级断言。
2. **装载与 resolve**：`defineReport` 规范化、spec/data 等价、记忆化、非法输入的完整用户反馈——断言规范化结构与错误对象，不断言渲染结果。
3. **计算与格式化分别可断言**（`value` 与 `display` 独立），不从渲染字符串反推计算正确。

校验器测试按**规则类别**预算，不按字段清单枚举：一个共享的必填字符串、optional number、
nullable 字段或嵌套路径规则各保留一条有区分力的代表场景；判别联合的每个分支可以各有一条，
因为分支实现彼此独立。新增字段若只是复用已有规则，由数据语义测试与类型检查承接，不再为
“这个字段也调用了同一个 validator helper”复制一条 case；只有引入新的 literal 约束、
递归容器或联合分支时才新增校验器 case。

## 覆盖规范

- **指标聚合口径**：两级折叠与题目权重、默认通过率的 errored=0 口径、skipped 与 null/0 的语义分离、固定题集分母（notRun 与 unscorable 不合并）、跨快照按身份键去重、自定义指标的 where 与两级 aggregate、分组维度规则。每条口径都要有能与错误算法区分的 fixture。
- **`totalScore`（计分制总分）**：`assertions[].points` 之和加 `scoreEntries[].points` 之和的纯累加；`errored`/`skipped` 记 `null`（基础设施得 null，不折成 0）；`failed`（gate 挂了）仍照实求和已挣到的分，不额外归零；`scoring !== "points"`（省略或显式 `"pass"`）恒 `null`，证明通过制 eval 不参与这个指标的聚合、不拉低分母；`runs > 1` 时同一 eval 的多个 attempt 取均值（perEval mean）、跨 eval 求和（acrossEvals sum）——这条聚合方向与其它默认 mean/mean 的指标相反，必须有能区分"跨题求和"与"跨题求均值"的 fixture（多题分值不同才有区分力）。`ScopeSummaryData.totalScore` 的存在性开关（至少一个 attempt 是 `scoring: "points"` 才出现，纯通过制 Scope 省略该字段）与 `scoringComposition` 三态（`"pass"` 纯通过制、`"points"` 纯计分制、`"mixed"` 一个 Scope 里并排通过制与计分制两个 experiment）各一条场景；`ScopeSummary` 与其 text 面按 `scoringComposition` 切换主 KPI（`"points"` 隐藏通过率、`"mixed"` 两者都显示）归 E2E 报告域的渲染验收，这里只证明 data 层的三态计算。公开函数 `scoringComposition(input)`（[主读数映射](../../../feature/reports/library/metrics.md#题型构成与主读数)）与 `ScopeSummaryData.scoringComposition` 同规则同值——两处对同一 fixture 得到相同三态，判据不复制第二份。`totalScore` 与其它内置指标一样从 `niceeval/report` 顶层导出（与 `model/metrics.ts` 定义的实例同引用），自定义报告不需要下钻到内部模块路径就能拿它构建 `MetricTable` / `MetricMatrix` 等组件——这条只需一处区分力场景，不用为每个内置指标各测一遍导出。
- **MetricCell 与缺数据**：字段构成与序列化不丢值；`validate*Data` 递归到嵌套字段、报错带完整路径、结构错误恒转完整用户反馈不抛裸 TypeError；缺 artifact 时返回 null 不猜值。
- **数据计算函数（`*Data`）**：各组件 data 函数的选择、配对、排序、缺失与报错语义（selectedEvalIds 口径、conditionsByFlag 条件派生边界、FailureList 等价、稀疏矩阵、单行摘要的字段瘦身、可比性冲突的完整反馈、`durationMs` 对 timeout attempt 返回 `null` 的删失口径——fixture 要证明线值不进均值且格子 samples<total 如实呈现）；errored 的单行摘要对多行 `error.message` 只取首行再收口——diagnose 从第二行起的 output tail（含被测 CLI 的 traceback 框线）不得折进 Result 单元格，与单行 message 原样保留两面都要有区分力场景；`failureSummary` 的计分制口径——failed 取中止前置的摘要，passed 有丢分得分点取首条丢分摘要（含 `+0 pts` 挣分尾缀）、`moreFailures` 计其余丢分得分点，挣满为 null（[丢分摘要规则](../../../feature/scoring/library/display.md#主失败断言怎样选)）；共享算法（最短唯一后缀）在消费方之间一致；`experimentListData` 的时效字段（`historical` / `historicalAttempts` 与新执行的判定边界）与占位行数据（`missingEvalIds` 来自 `scope.coverage`、不参与任何指标聚合）；`current()` 下一个 experiment 展示用的水位基准 Snapshot 选择——fixture 让同一 experiment 有多个真实贡献快照、`startedAt` 各不相同时，配置/agent/model 相关字段（config 列、Hero、`ScopeSummary` 标题等）只读取贡献来源中 `startedAt` 最新的那一个，不是任取或合并多个来源；实体列表的计分制字段——`ExperimentListItem.scoring` 是定义期事实投影（不从 attempt 结果推断），experiment / eval / attempt 三级的 `totalScore` cell 在计分制下按指标口径求值（experiment 级 acrossEvals sum、eval 级 perEval mean）、通过制下为 null cell 且与 `endToEndPassRate` 并存不互斥。
- **站点组件与内建报告**：`standard` 的构成与具名导出同引用、三张 scope-input page 均相邻放置 `ScopeWarnings` 与 `SnapshotDiagnostics`、`defineReport({ extends })` 的外壳叠加与页列表同引用、组合组件与手写组合严格等价；数据派生覆盖 heroData、warning 分组聚合与组排序，以及 `snapshotDiagnosticsData` 对 Scope / 裸 Snapshot[] 的同值投影、空诊断过滤、experiment → startedAt 排序、来源不合并、开放 code 原样保留、React data 不携带 Snapshot/AttemptHandle。渐进增强不改数据；`ExperimentComparison` 的主读数解析——纯计分制 Scope 的展开树中散点 spec 的 y 与列表预排序引用 `totalScore` 同一实例（纯通过制引用 `endToEndPassRate`），`"mixed"` 按题型拆成两组的展开树构成（每组一份散点 + 列表、`ScopeSummary` 整 Scope 一份）——以展开树与 data 为断言面，默认折叠、汇总严重度、text 不折叠与空集零输出归 E2E。
- **resolve 与组合组件**：spec/data 严格等价、`input` 缺省与覆盖、记忆化的等价判据、`ReportNode` 全集与非法节点的完整反馈、`ctx` 的构成、sibling 并行但输出保序、`defineComponent` 两种形态。
- **纯函数布局算法**：MetricScatter 点标签布局是 `chart-math` 纯几何函数，直接对函数断言标签框与点框的几何关系，不经 HTML；图轴值域推定（[图轴值域](../../../feature/reports/library/metric-views.md#图轴值域)）同属这一类——直接对推定函数断言扩后的 `[min, max]`：两端各扩数据跨度 20%、零跨度 fallback（值绝对值的 20%、值为 0 取 1）、有自然 `bounds` 时保证最小跨度为量程参考的 1/3 并钳到边界（贴边数据点落在框线上）、无量程参考的轴不强造最小跨度，反向轴先扩边距再反向；两面共用同一份值域，不在渲染层重算；labels 维度与 series 归类的解析规则；series 配色的稳定散列与撞色线性探测（`colorIndexForKey` / `colorIndicesForKeys`）同属这一类——确定性索引计算，不断言渲染出的颜色值。
- **面板几何（`panel.ts`）**：区域框契约（[排版原语 · 区域框](../../../feature/reports/library/layout.md#区域框text-面的框线体裁)）的纯函数实现，与 `chart-math`/`grid-layout` 同一类——直接对 `renderPanel` 的返回行数组断言，不经真实终端或 HTML。覆盖：顶层 `Section` 画完整四边框、`rows` 里的 `divider` 降为横隔 `├─ ─┤`（含 `encodeDividerLine`/`decodeDividerLine`/`rowsFromBodyText` 的编解码往返）；宽度上限 100 显示列、调用方声明豁免上限时框宽跟随传入宽度（>100 也成立,动态面板形态）、以及边框嵌字的「先保标题后保 meta」截断优先级（横线缩到最短一段 → 标题中段截断补 `…` → 最后放弃 meta）；`width < 60` 或 `mode: "plain"` 时整体降级为无框文本（title 单独成行、meta 同行右侧、正文两格缩进，内容与分节顺序一字不变）；CJK / East-Asian-Ambiguous（`·` `●` `…` 等恒记 1 列）的宽度量测与 `text-layout.ts` 共用同一张表，不各自实现第二份。`Section` 的 text 面按 `ctx.panelMode` 接线到这个渲染件而非自行拼框字符：`panelMode: "boxed"` 时顶层调用 `renderPanel`、嵌套 Section 改走 `encodeDividerLine` 桥接给外层；`panelMode` 缺省或 `"plain"` 时递归自然处理嵌套（不展开横隔）——这一条只需证明「确实调用了 panel.ts 的产物」（如返回文本里出现 `renderPanel` 独有的框线字符与几何），不重复 panel.ts 自己的几何断言，也不断言页面级终端排版（那部分归 E2E）。
- **宿主装载等价**：裸 `show`/`view` 与 `--report` 在装载边界消费同一份 definition（同引用）与同规则选出的 Scope（深等）；`--fresh` 在两宿主注入同一个 `fresh` 口径——不比较终端输出与 HTML，渲染面与进程级读面行为归 E2E。
- **view 数据装载（ViewScan）**：`resolveViewInput` 的位置参数 / `--results` / `--snapshot` 互斥与存在性校验，位置参数按 eval id 前缀透传、含义不随文件系统状态改变；`loadViewScan` 的有效根收窄使证据室（`attemptsByBase` / `artifactDirs` / `attemptPages.locators`）与报告槽 Selection 同步收窄；`viewData` 只含证据室元信息（`composedRuns`、`skippedRuns`、`report` 元信息）不携带统计产物；外壳标题取值链与 `ReportLink.icon` 原样透传进 `viewData.report`；报告文件缺失、非法默认导出、前缀 / 实验匹配不到、零可读结果的完整错误反馈；报告文件变更后下一次装载读取新内容（不复用陈旧模块缓存）。全部以返回结构、Map/Set 内容与错误对象为断言面，不断言渲染出的 HTML 或终端文本。
- **Attempt 证据组件族**：`attempt*Data(evidence)` 纯派生零 IO、装配恰好一次；组合组件的展开树构成与二选一规则；spec 缺省取注入 evidence、错位使用的完整反馈；对话数据的分轮与容错。渲染出的 DOM、默认展开标记、染色与交互归 E2E；改动这些组件后需要 `pnpm run build:report`，改动 view 壳 / dialog 摆放后需要 `pnpm run view:build`。
- **`AttemptAssertions` 的计分制字段**：`.points` 挣分随所在 `AssertionResult` 一起出现（不需要单独投影，字段本就在断言记录上，包括「挂了的检查点挣 0 分」这种如实不隐藏的场景）；**得分点不参与 passed 收纳**——passed 的得分点逐条进平铺列表、不折进 `passedGroups` 计数，收纳只作用于不带 `.points` 的观测断言（[收纳豁免](../../../feature/scoring/library/display.md#计分制points-与给分记录)）；得分点挣满计数（`2/5 得分点挣满`，连续打分不足 `n × 1.0` 不算挣满）是 data 层字段；`t.score(label, n)` 的给分记录与断言分属两个数组，按 `groupPath.join(" > ")` 分组（与 `passedGroups` 同一套算法，无分组归到空键）；没有 assertion 但存在给分记录时 `attemptAssertionsData` 不是 `null`（存在性判断是"两个数组都空"，不是只看 assertions）；通过制 attempt 的 `scoreEntries` 字段恒省略，不摆空数组；`validateAssertionsData` 对 `scoreEntries` 存在时的结构校验（`label`/`points` 类型）。
- **计分制的 attempt 详情数据**：`attemptSummaryData` 的本轮挣分字段（计分制 attempt 才出现，通过制省略——它是详情页总分的唯一出现处）；`attemptSourceData` 的给分投影——得分点行的挣分标注、`t.score` 调用行的给分标注、前置中止行的 `⤓` 与其后源码行的未到达标记、`loc` 不在展示源码内的得分点与给分记录落 unmapped 区（给分记录按 `groupPath` 分组，与 `AttemptAssertions` 同一套算法）；`attemptFixPromptData` 把丢分得分点与前置中止都算可操作失败（计分制 `passed` 有丢分不是 `null`，挣满且未中止才是 `null`，通过制 passed 恒 `null`）。染色、降灰、pill 与右缘 sticky 的呈现归 E2E 报告域。
- **外壳与页面装载**：三种声明形态归一到同一规范化产物、`content`/`pages`/`extends` 恰好其一、标题取值链、资产路径纪律与 head 白名单/转义/scheme 分流、page id 与 attempt-input page 的校验规则。全部以装载结果或错误对象为断言面。
- **show 终端宿主的选择、时间轴与文案**：`show` 专属的纯函数与错误路径以返回值或文案为断言面，不依赖终端排版——`attemptHistory` 按 experimentId + evalId 分节、跨快照按 attempt 身份键去重（resume 携带的复印件不占行）、startedAt 升序、单行摘要与成本派生；紧凑索引行的判定原因（`verdictReasonLine`）对多行 `error.message` 折首行并剥控制字节收口，完整多行 message 归 attempt 详情块展开；`showCommand` / `otherPagesText` 按 `HostCommandContext` 拼出可复现的页/组索引命令，只列未渲染的页且携带完整上下文；eval id 前缀无匹配、`--history`/`--report`/`--page` 的互斥与用法冲突、`@<locator>` 语法错误与索引未命中、证据切面撞多个 eval 时的紧凑索引——全部以 CLI 抛出的错误对象/文案为断言面。跨快照合成 Selection 与去重的结构化语义（`selectCurrentResults`/现刻水位）不在这里重复，归[单元测试 Results](results.md)的「现刻水位（`current()`）」类别。
- **o11y 数据派生**：`estimateCost` 的查价与缺失口径（未知 model 为 null 不猜、缺 usage 不记零成本）；`buildExecutionTree` 把标准事件流与 OTel span 合成执行树——骨架完整性、callId 精确合并、关联失败降级不猜、乱序/截断的占位、失败状态透传、新增的 `context.injected` 节点按事件原样直通（不参与 callId 关联）；`deriveRunFacts` 把标准事件流折叠成 `DerivedFacts`——只有 called、尚未等到 result 的调用折叠成 `pending`（工具调用与子 agent 委派都适用），配上 result 才取 result 的状态，只有 result 没配上 called 时才是占位兜底；`contextInjections` 精确计数事件流里的 `context.injected` 事件次数，不与其它折叠字段重复计入。
- **show 的范围 × 切片正交**:切片(source/execution/timing/usage/diff)接受任意范围的选择与分节规则——单 locator 是单元素范围的特例,不走第二条代码路径(fixture 要能区分「locator 专属实现」与「范围通用实现」);多 `--exp` 对照的条件解析(每个 `--exp` 恰好一个 experiment、匹配多个时报错并列出候选)、eval id 配对、缺席条件占位 `—` 不计该组分母、翻转标记的数据面(`flipped` 只在判定不一致时真)、逐行 Δ 为原始差值且任一侧缺数据为缺失不为 0、`runs>1` 的格内折叠(verdict 榜单口径、数值合计);汇总同时证明两种互不替代的口径——各条件 totals 按自身覆盖面描述、归因用 paired delta 且只聚合 baseline 与该条件的共同 eval 交集(fixture 必须让两侧覆盖不同,从而抓出直接相减各自 totals 的错误算法),混型再按通过制 / 计分制子集分段且不共用分母——以上对照判据的断言面是 `deltaTableData`,口径单源见 [Library · Metric Views](../../../feature/reports/library/metric-views.md#deltatable);`@locator` 与重复 `--exp`、`--grep` 与非 execution 切片、`--expand` 与 `--json`、`--stats` 与 `@locator` 的用法冲突各自的完整报错;`--stats` 稳定性矩阵的口径——证据面与 history 相同(跨快照身份键去重、不设可比性门槛)、`failed` 与 `errored` 分列不合并(fixture 要让「混列」与「分列」算法给出不同答案)、`skipped` 不计、`neverPassed` 判定(零通过且执行数>0)、无执行组合是缺失不是三个 0、行按历史最高通过率升序——以上稳定性判据的断言面是 `stabilityMatrixData`,口径单源见 [Library · Metric Views](../../../feature/reports/library/metric-views.md#stabilitymatrix)。
- **usage 组装与 facts 投影**:usage 行/表的组装口径单源见 [Library · Attempt 详情 · `UsageTable` 组装口径（单源）](../../../feature/reports/library/attempt-detail.md#usagetable-组装口径单源)——行为计数(turns/toolCalls)来自事件流、token 来自 `Usage`、`uncachedInputTokens` 只在 `inputTokens` 与 `cacheReadTokens` 都存在时派生(fixture 要有「只缺其一」的场景证明不猜 0)、`requests` 缺失时片段整段省略(区分「省略」与「显示 0/1」)、合计对含 `—` 的列标不完整;这些判据的断言面是 `usageTableData`，facts 在单元层只证明读取后的数据投影。attempt 首页 `usage:` / `facts:` 行、`--usage` 表、缺失占位与分节怎样被用户看到，统一由 Report E2E 从公开 CLI 验收，不在 show 单元测试复述文本。
- **execution 的预算、句柄与 grep**:卡片预览预算按段独立截断(单段卡的正文、TOOL 卡的 input/result、失败命令卡的命令行/stdout/stderr 各算一段)——主尺度是行,每段最多显示前 3 行(保留原始换行,骨架行 `input`/`result · <status>` 不计入)，每段另有 1 KiB(UTF-8 字节、按字符边界回退)兜底防单行超长 JSON blob 击穿行预算；卡尾截断提示每卡一条,聚合全卡各段被折的行数(N,含被字节兜底截到一半的行)与字符数(M)，全卡没有整行被折、只是字节兜底切了字符时 N 退化省略、尾巴退化为 `(+M chars · …)`；Agent 卡的 `t<N>.c<M>` 从事件序确定性派生，失败 Sandbox 命令卡的 `cmd<N>` 按 timing node 时序派生（同 fixture 两次派生同值）；`--expand` 命中还原完整落盘值(含落盘 `truncated` 标注透传、不截断)、句柄超界的完整报错(带实际 turn / 卡片数或 command 数);`--grep` 的匹配面覆盖角色文本、工具名、input、result 与失败命令 display/stdout/stderr、命中卡片同样受预览预算约束；命令卡按 timingNodeId 关联 phase / duration，Eval error.message 已截掉根因时 attempt 首页仍给 `--execution` 指引。算法与错误反馈留在单元层；成功命中卡片、命中汇总与 0 命中的可见输出由 Report E2E 验收。
- **`--json` 投影**:envelope 形状(format / schemaVersion / view / scope 回显);同 fixture 下 text 面与 JSON 面选出同一批实体，共有派生字段同值——由同一次组件 resolve 产物构造保证([「show 的切片是组件选择」](../../../feature/reports/architecture.md#show-的切片是组件选择)),测试断言 text 面与 `--json` 的 `data` 字段消费同一份 `*Data`,不各自实现一遍选择/聚合再比对两个结果；JSON 是 text 的数据超集，允许保留 text 注意力预算省略的字段与完整树，测试不能反向要求字段集合相等；字段名复用落盘类型不重命名;timing 的 JSON 面恒为完整树(不受 80-node 预算影响,fixture 超预算才有区分力);与 `--report` 互斥的用法错误;stdout 只有单个 JSON 文档(警告走 stderr)。逐视图 `data` 的完整字段形状不在本类别重复断言——单源在各组件的 `*Data` 声明,判据归所在类别(对照见「show 的范围 × 切片正交」引用的 `deltaTableData`、usage 见「usage 组装与 facts 投影」引用的 `usageTableData`、attempt 证据切片见「Attempt 证据组件族」);本类别只证明 envelope 字段与跨视图不变量。

## 不这样测

- 不把 Reports 整体当作"展示层"薄测；选择、去重、指标和聚合会静默给错答案。
- 不在本层断言渲染产物——终端排版、DOM 结构与快照锁定的是呈现，归 [E2E 功能域 · 报告与读面](../e2e/report.md)对真实产物验收；本层观察数据。
- 不用相同 attempt 数的题目验证两级聚合，因为它与平铺算法可能恰好相等。
- 数值、排序、覆盖率和 refs 直接精确断言，不从渲染字符串反推。
