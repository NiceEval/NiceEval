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

## 覆盖规范

- **指标聚合口径**：两级折叠与题目权重、默认通过率的 errored=0 口径、skipped 与 null/0 的语义分离、固定题集分母（notRun 与 unscorable 不合并）、跨快照按身份键去重、自定义指标的 where 与两级 aggregate、分组维度规则。每条口径都要有能与错误算法区分的 fixture。
- **`totalScore`（计分制总分）**：`assertions[].points` 之和加 `scoreEntries[].points` 之和的纯累加；`errored`/`skipped` 记 `null`（基础设施得 null，不折成 0）；`failed`（gate 挂了）仍照实求和已挣到的分，不额外归零；`scoring !== "points"`（省略或显式 `"pass"`）恒 `null`，证明通过制 eval 不参与这个指标的聚合、不拉低分母；`runs > 1` 时同一 eval 的多个 attempt 取均值（perEval mean）、跨 eval 求和（acrossEvals sum）——这条聚合方向与其它默认 mean/mean 的指标相反，必须有能区分"跨题求和"与"跨题求均值"的 fixture（多题分值不同才有区分力）。`ScopeSummaryData.totalScore` 的存在性开关（至少一个 attempt 是 `scoring: "points"` 才出现，纯通过制 Scope 省略该字段）与 `scoringComposition` 三态（`"pass"` 纯通过制、`"points"` 纯计分制、`"mixed"` 一个 Scope 里并排通过制与计分制两个 experiment）各一条场景；`ScopeSummary` 与其 text 面按 `scoringComposition` 切换主 KPI（`"points"` 隐藏通过率、`"mixed"` 两者都显示）归 E2E 报告域的渲染验收，这里只证明 data 层的三态计算。`totalScore` 与其它内置指标一样从 `niceeval/report` 顶层导出（与 `model/metrics.ts` 定义的实例同引用），自定义报告不需要下钻到内部模块路径就能拿它构建 `MetricTable` / `MetricMatrix` 等组件——这条只需一处区分力场景，不用为每个内置指标各测一遍导出。
- **MetricCell 与缺数据**：字段构成与序列化不丢值；`validate*Data` 递归到嵌套字段、报错带完整路径、结构错误恒转完整用户反馈不抛裸 TypeError；缺 artifact 时返回 null 不猜值。
- **数据计算函数（`*Data`）**：各组件 data 函数的选择、配对、排序、缺失与报错语义（selectedEvalIds 口径、pairsByFlag 配对边界、FailureList 等价、稀疏矩阵、单行摘要的字段瘦身、可比性冲突的完整反馈）；共享算法（最短唯一后缀）在消费方之间一致；`experimentListData` 的时效字段（`historical` / `historicalAttempts` 与新执行的判定边界）与占位行数据（`missingEvalIds` 来自 `scope.coverage`、不参与任何指标聚合）。
- **站点组件与内建报告**：`standard` 的构成与具名导出同引用、`defineReport({ extends })` 的外壳叠加与页列表同引用、组合组件与手写组合严格等价、数据派生（heroData、warning 分组聚合与组排序）与渐进增强不改数据的不变量。
- **resolve 与组合组件**：spec/data 严格等价、`input` 缺省与覆盖、记忆化的等价判据、`ReportNode` 全集与非法节点的完整反馈、`ctx` 的构成、sibling 并行但输出保序、`defineComponent` 两种形态。
- **纯函数布局算法**：MetricScatter 点标签布局是 `chart-math` 纯几何函数，直接对函数断言标签框与点框的几何关系，不经 HTML；labels 维度与 series 归类的解析规则；series 配色的稳定散列与撞色线性探测（`colorIndexForKey` / `colorIndicesForKeys`）同属这一类——确定性索引计算，不断言渲染出的颜色值。
- **宿主装载等价**：裸 `show`/`view` 与 `--report` 在装载边界消费同一份 definition（同引用）与同规则选出的 Scope（深等）；`--fresh` 在两宿主注入同一个 `fresh` 口径——不比较终端输出与 HTML，渲染面与进程级读面行为归 E2E。
- **view 数据装载（ViewScan）**：`resolveViewInput` 的位置参数 / `--results` / `--snapshot` 互斥与存在性校验，位置参数按 eval id 前缀透传、含义不随文件系统状态改变；`loadViewScan` 的有效根收窄使证据室（`attemptsByBase` / `artifactDirs` / `attemptPages.locators`）与报告槽 Selection 同步收窄；`viewData` 只含证据室元信息（`composedRuns`、`skippedRuns`、`report` 元信息）不携带统计产物；外壳标题取值链与 `ReportLink.icon` 原样透传进 `viewData.report`；报告文件缺失、非法默认导出、前缀 / 实验匹配不到、零可读结果的完整错误反馈；报告文件变更后下一次装载读取新内容（不复用陈旧模块缓存）。全部以返回结构、Map/Set 内容与错误对象为断言面，不断言渲染出的 HTML 或终端文本。
- **Attempt 证据组件族**：`attempt*Data(evidence)` 纯派生零 IO、装配恰好一次；组合组件的展开树构成与二选一规则；spec 缺省取注入 evidence、错位使用的完整反馈；对话数据的分轮与容错。渲染出的 DOM、默认展开标记、染色与交互归 E2E；改动这些组件后需要 `pnpm run build:report`，改动 view 壳 / dialog 摆放后需要 `pnpm run view:build`。
- **外壳与页面装载**：三种声明形态归一到同一规范化产物、`content`/`pages`/`extends` 恰好其一、标题取值链、资产路径纪律与 head 白名单/转义/scheme 分流、page id 与 attempt-input page 的校验规则。全部以装载结果或错误对象为断言面。
- **show 终端宿主的选择、时间轴与文案**：`show` 专属的纯函数与错误路径以返回值或文案为断言面，不依赖终端排版——`attemptHistory` 按 experimentId + evalId 分节、跨快照按 attempt 身份键去重（resume 携带的复印件不占行）、startedAt 升序、单行摘要与成本派生；`showCommand` / `otherPagesText` 按 `HostCommandContext` 拼出可复现的页/组索引命令，只列未渲染的页且携带完整上下文；eval id 前缀无匹配、`--history`/`--report`/`--page` 的互斥与用法冲突、`@<locator>` 语法错误与索引未命中、证据切面撞多个 eval 时的紧凑索引——全部以 CLI 抛出的错误对象/文案为断言面。跨快照合成 Selection 与去重的结构化语义（`selectCurrentResults`/现刻水位）不在这里重复，归[单元测试 Results](results.md)的「现刻水位（`current()`）」类别。
- **o11y 数据派生**：`estimateCost` 的查价与缺失口径（未知 model 为 null 不猜、缺 usage 不记零成本）；`buildExecutionTree` 把标准事件流与 OTel span 合成执行树——骨架完整性、callId 精确合并、关联失败降级不猜、乱序/截断的占位、失败状态透传、新增的 `context.injected` 节点按事件原样直通（不参与 callId 关联）；`deriveRunFacts` 把标准事件流折叠成 `DerivedFacts`——只有 called、尚未等到 result 的调用折叠成 `pending`（工具调用与子 agent 委派都适用），配上 result 才取 result 的状态，只有 result 没配上 called 时才是占位兜底；`contextInjections` 精确计数事件流里的 `context.injected` 事件次数，不与其它折叠字段重复计入。

## 不这样测

- 不把 Reports 整体当作"展示层"薄测；选择、去重、指标和聚合会静默给错答案。
- 不在本层断言渲染产物——终端排版、DOM 结构与快照锁定的是呈现，归 [E2E 功能域 · 报告与读面](../e2e/report.md)对真实产物验收；本层观察数据。
- 不用相同 attempt 数的题目验证两级聚合，因为它与平铺算法可能恰好相等。
- 数值、排序、覆盖率和 refs 直接精确断言，不从渲染字符串反推。
