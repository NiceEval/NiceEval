# Reports 怎么测

契约来源：[Reports](../../../feature/reports/README.md)、[Architecture](../../../feature/reports/architecture.md)、[Library](../../../feature/reports/library.md)、[Show](../../../feature/reports/show.md)、[View](../../../feature/reports/view.md)、[Observability](../../../observability.md)。

单元层证明 Reports 的**数据语义**：`DataSource.compute()`、读数聚合口径、resolve 管线、
报告定义的装载规范化与校验反馈。观察面全部是 Content、规范化结构、错误对象与文案。本篇的缝：构造 Sample
/ evidence fixture 作输入，测其上的计算与装载逻辑；缝的真实侧（真实产物上的出口与渲染）由
[E2E 功能域 · 报告与读面](../e2e/report.md)验收（[Fake 边界](README.md#fake-边界mock-什么测哪一层)）。渲染出来的终端排版、DOM 结构、双面比对、样式与交互不在本层，归
[E2E 功能域 · 报告与读面](../e2e/report.md)对真实运行的产物验收。渲染缺陷在单元层的 DOM 断言下仍可能逃逸，只有真实产物能拦住。先例：

- [逐行代码滚动条裁切](../../../../memory/codeview-perline-hidden-scrollbar-clips-text.md)
- [Attempt 详情组件缺少样式](../../../../memory/attempt-detail-components-shipped-without-styles.md)

## Fixture 规范

**计算 fixture 要有区分力**：通过率 fixture 应让几种常见错误算法得到不同答案。

```ts
const scope = reportScopeFixture({
  experiments: [
    {
      id: "compare/codex",
      evals: [
        { id: "a", attempts: ["passed", "failed", "passed"] }, // 题内 2/3
        { id: "b", attempts: ["passed"] }, // 题内 1
        { id: "c", attempts: ["errored"] }, // 端到端记 0
        { id: "d", attempts: ["skipped"] }, // 不进有效样本
      ],
    },
  ],
});
```

这个 fixture 中端到端两级聚合 = 5/9、排除 errored 的条件口径 = 5/6、attempt 平铺 =
3/5、先折叠 verdict 再计票 =
2/3——四个值彼此不同，测试才能发现口径被换掉。各题 attempt 数必须不同，否则两级聚合与平铺可能恰好相等。

**MeasureCell fixture** 共享三种不能混淆的值：measuredZero（value
0、有样本）、partial（有值、覆盖率不满）、missing（value null、零样本）。每个组件至少验证 `null`
不被显示成 `0`、partial 保留覆盖率、refs 没有被渲染前计算丢掉。

## 观察面：数据级断言

1. **数据源计算的事实**：数值、覆盖率、排序、缺失行为，全部 Content 级断言。
2. **装载与 resolve**：`defineReport`
   规范化、source/data 等价、记忆化、非法输入的完整用户反馈——断言规范化结构与错误对象，不断言渲染结果。
3. **计算与格式化分别可断言**（`value` 与 `display` 独立），不从渲染字符串反推计算正确。

校验器测试按**规则类别**预算，不按字段清单枚举：一个共享的必填字符串、optional
number、nullable 字段或嵌套路径规则各保留一条有区分力的代表场景；判别联合的每个分支可以各有一条，因为分支实现彼此独立。新增字段若只是复用已有规则，由数据语义测试与类型检查承接，不再为“这个字段也调用了同一个 validator
helper”复制一条 case；只有引入新的 literal 约束、递归容器或联合分支时才新增校验器 case。

## 覆盖规范

- **读数聚合口径**：两级折叠与题目权重、默认通过率的 errored=0 口径、skipped 与 null/0 的语义分离、固定题集分母（notRun 与 unscorable 不合并）、跨 Run 按身份键去重、自定义读数的 where 与两级 aggregate、分组维度规则。每条口径都要有能与错误算法区分的 fixture。
- **`totalScore`（计分制总分）**：
  - 计算值是 `assertions[].points` 与 `scoreEntries[].points` 的总和。
  - `failed` 仍保留已经挣到的分；`errored` 与 `skipped` 返回 `null`。
  - 通过制 Eval 不参与该读数，也不拉低分母。
  - 同一 Eval 的多个 Attempt 取均值；跨 Eval 求和。Fixture 必须用不同题目分值区分“求和”和“求均值”。
  - `scoringComposition` 分别覆盖纯通过制、纯计分制和混合 Sample。公开函数与 `SampleSummaryContent`
    必须同值。
  - `totalScore` 从 `niceeval/report`
    顶层导出，并与内部定义保持同一引用。只需一个代表场景，不为每个内建读数重复测试。

  用户怎样读取计分报告，见[固定题集做考试成绩单](../../../feature/reports/use-case/分析/固定题集成绩单.md)。主读数规则见[题型构成与主读数](../../../feature/reports/library/measures.md#题型构成与主读数)。

- **MeasureCell 与缺数据**：字段构成与序列化不丢值；`validateContent`
  递归到嵌套字段、报错带完整路径、结构错误恒转完整用户反馈不抛裸 TypeError；缺 artifact 时返回 null 不猜值。
- **数据源**：各数据源的选择、配对、排序、缺失与报错语义（selectedEvalIds 口径、
  `deltaRows({ conditions: { flag } })` 的条件派生边界、FailureList 等价、稀疏矩阵、单行摘要的字段瘦身、
  可比性冲突的完整反馈、`durationMs`
  对 timeout attempt 返回 `null`
  的删失口径——fixture 要证明线值不进均值且格子 samples<total 如实呈现）；errored 的单行摘要对多行
  `error.message` 只取首行再收口——diagnose 从第二行起的 output
  tail（含被测 CLI 的 traceback 框线）不得折进 Result 单元格，与单行 message 原样保留两面都要有区分力场景；`failureSummary`
  的计分制口径——failed 取中止前置的摘要，passed 有丢分得分点取首条丢分摘要（含 `+0 pts`
  挣分尾缀）、`moreFailures`
  计其余丢分得分点，挣满为 null（[丢分摘要规则](../../../feature/assertions/library/display.md#主失败断言怎样选)）；共享算法（最短唯一后缀）在消费方之间一致；`experimentRows`
  的时效字段（`historical` / `historicalAttempts` 与新执行的判定边界）与占位行数据（`missingEvalIds`
  来自 `sample.coverage`、不参与任何读数聚合）；`currentSample()`
  下一个 experiment 展示用的水位基准 Run 选择——fixture 让同一 experiment 有多个真实贡献 Run、`startedAt`
  各不相同时，配置/agent/model 相关字段（config 列、Hero、`sampleSummary` 标题等）只读取贡献来源中
  `startedAt`
  最新的那一个，不是任取或合并多个来源；实体行的计分制字段——`ExperimentRow.scoring`
  是定义期事实投影（不从 attempt 结果推断），experiment / eval / attempt 三级的 `totalScore`
  cell 在计分制下按读数口径求值（experiment 级 acrossEvals sum、eval 级 perEval
  mean）、通过制下为 null cell 且与 `endToEndPassRate` 并存不互斥。
- **站点组件与内建报告**：`standard` 的构成与具名导出同引用、三张 scope-input page 均相邻放置
  `sampleWarnings` 与 `runDiagnostics`、`defineReport({ extends })`
  的外壳叠加与页列表同引用、组合组件与手写组合严格等价；数据派生覆盖 hero、warning 分组聚合与组排序，以及
  `runDiagnostics` 对 Sample / 裸 Run[] 的同值投影、空诊断过滤、experiment →
  startedAt 排序、来源不合并、开放 code 原样保留、React
  Content 不携带 Run/AttemptHandle。渐进增强不改数据；`SampleOverview`
  的主读数解析——纯计分制 Sample 的展开树中 `chart()` 的 y 与列表预排序引用 `totalScore`
  同一实例（纯通过制引用 `endToEndPassRate`），`"mixed"`
  按题型拆成两组的展开树构成（每组一份 Chart + Table、`sampleSummary`
  整 Sample 一份）——以展开树与 Content 为断言面。
- **resolve 与组合组件**：source/data 严格等价、`input` 缺省与覆盖、同 source + input 只计算一次、
  `ReportNode` 全集与非法节点的完整反馈、`ctx` 的构成、sibling 并行但输出保序。
- **数据源选项归一**：`measureRows` / `measureMatrix` / `scoreboard` / `deltaRows` / `chart`
  的对象参数校验；固定题集权重、条件基准、series key 与轴绑定都以 options 和 Content 为断言面。
  `Table` 的 `<Column>` 只选择已算好的列，不参与领域计算。
- **维度绑定的三件通用能力**（[图表](../../../feature/reports/components/charts/README.md)、[复合维度](../../../feature/reports/library/measures.md#维度与数值轴)）：轴、行、列、格、series 的 `by`
  用同一份解析——**复合维度**在每个位置都合法且解析出同一个维度（name 以 ` × ` 连接、值以 ` · ` 连接、成员缺失走
  `(missing)`），区分力场景是「同一个数组分别作为 `measureRows.rows`、`chart.x.dimension` 与
  `chart.series[].by` 时 keyset 深相等」；**`limit` / `rest`** 的截断在 `compute()` 内发生——`rest`
  是在合并后的 keyset 上重新聚合而不是把截掉的几行平均（fixture 要让「合并重算」与「行均值」得出不同的数），`rest`
  恒排末位且带自己的 `samples` / `total` / `refs`、维度值不超过 `limit`
  时不产生 `rest` 条目、只给 `limit` 不给 `sort` 按完整用户反馈报错。
- **主题钉色**（[钉色](../../../feature/reports/library/theme.md#钉色)）：`seriesPins`
  的键原样占位、自动分配只在剩余槽里探测、多个值钉同一下标不触发探测、钉了但页内未出现的键不占槽；非法维度 name / 值键 /
  下标按完整用户反馈拒绝并指到 `theme.seriesPins.<维度>.<值>`。区分力场景是「同一份数据加钉与不加钉，未钉键的落槽不同」。
- **Chart 呈现覆盖**：`Chart.series` 只能覆盖已有 series key 的线型、点形、标签与可见性，
  不能改变 mark、绑定或聚合；未知 key 给出完整用户反馈。
- **`Markdown` 的解析与两面投影**（[排版原语 · Markdown](../../../feature/reports/library/layout.md#markdown)）：断言面是解析出的 AST 与两面输出字符串，不经浏览器。覆盖：每类块与行内节点在 text 面的投影（标题空行、列表前缀与缩进、代码块不折行、块引用 `>` 前缀、链接 `文字 (url)`、图片 `alt (url)`、无 ANSI 时脱去强调标记）；裸 HTML 块与行内 HTML 一律转义成可见文本，不进 web 输出；表格语法按完整用户反馈报错并指引 `Table`；折行与宽度量测走 `stringWidth` / `wrapText` 同一张表（中文正文不撕歪）；`LocalizedText` 正文按回退链选语言，缺语言不报错也不留空。
- **页级色分配**（[系列色](../../../feature/reports/components/README.md#系列色分配单位是页)）：给定一页已解析数据里的
  `(维度, 值)` 集合产出映射——同一键在同页多个组件（图表 series 与实体列表的维度键）得到同一个色槽、撞色按显示键字典序线性探测、keyset
  超过色板才复用、缩短后的显示名不参与取键；断言面是映射本身，不断言渲染出的颜色值。
  `shortestUniqueLabels` 与 `seriesColors` 从 `niceeval/report`
  顶层导出并与内部定义同一引用——官方组件与自定义组件复现同一份显示名和同一个色槽。
- **纯函数布局算法**：散点点标签布局是 `chart-math`
  纯几何函数，直接对函数断言标签框与点框的几何关系，不经 HTML；轴值域推定（[值域](../../../feature/reports/components/charts/README.md#值域)）同属这一类——直接对推定函数断言扩后的
  `[min, max]`：两端各扩数据跨度 20%、零跨度 fallback（值绝对值的 20%、值为 0 取 1）、有自然
  `bounds`
  时保证最小跨度为量程参考的 1/3 并钳到边界（贴边数据点落在框线上）、无量程参考的轴不强造最小跨度，反向轴先扩边距再反向；两面共用同一份值域，不在渲染层重算；labels 维度与 series 归类的解析规则；[页级色分配](../../../feature/reports/components/README.md#系列色分配单位是页)同属这一类——给定一页的 `(维度, 值)` 集合，稳定散列起点与撞色线性探测产出确定性索引，不断言渲染出的颜色值。
- **面板几何（`panel.ts`）**：区域框契约（[排版原语 · 区域框](../../../feature/reports/library/layout.md#区域框text-面的框线体裁)）的纯函数实现，与
  `chart-math`/`grid-layout` 同一类——直接对 `renderPanel`
  的返回行数组断言，不经真实终端或 HTML。覆盖：顶层 `Section` 画完整四边框、`rows` 里的 `divider`
  降为横隔 `├─ ─┤`（含 `encodeDividerLine`/`decodeDividerLine`/`rowsFromBodyText`
  的编解码往返）；宽度上限 100 显示列、调用方声明豁免上限时框宽跟随传入宽度（>100 也成立,动态面板形态）、以及边框嵌字的「先保标题后保 meta」截断优先级（横线缩到最短一段 → 标题中段截断补
  `…` → 最后放弃 meta）；`width < 60` 或 `mode: "plain"`
  时整体降级为无框文本（title 单独成行、meta 同行右侧、正文两格缩进，内容与分节顺序一字不变）；CJK /
  East-Asian-Ambiguous（`·` `●` `…` 等恒记 1 列）的宽度量测与 `text-layout.ts`
  共用同一张表，不各自实现第二份。`Section` 的 text 面按 `ctx.panelMode`
  接线到这个渲染件而非自行拼框字符：`panelMode: "boxed"` 时顶层调用 `renderPanel`、嵌套 Section 改走
  `encodeDividerLine` 桥接给外层；`panelMode` 缺省或 `"plain"`
  时递归自然处理嵌套（不展开横隔）——这一条只需证明「确实调用了 panel.ts 的产物」（如返回文本里出现
  `renderPanel`
  独有的框线字符与几何），不重复 panel.ts 自己的几何断言，也不断言页面级终端排版（那部分归 E2E）。
- **宿主装载等价**：裸 `show`/`view` 与 `--report`
  在装载边界消费同一份 definition（同引用）与同规则选出的 Sample（深等）；`--fresh`
  在两宿主注入同一个 `fresh` 口径——不比较终端输出与 HTML，渲染面与进程级读面行为归 E2E。
- **报告取值链与 `--report` 值判别**：两宿主共用的解析函数，断言面是解析出的 definition
  引用与错误对象，不经渲染。覆盖：三档取值链按 `--report` → `config.report` → 内建 `standard`
  逐档回落，且每档产出的 definition 与直接 import 该定义同引用（`config.report`
  在场时裸跑不得再取内建）；`--report` 的形态判别——含 `/`、以 `.` 开头、带
  `.ts`/`.tsx`/`.js`/`.mjs` 后缀的按文件装载，其余裸词查内建视图名表，`standard`
  命中且与 `niceeval/report/built-in` 默认导出同引用；裸词未命中时报错列出可用名字并给出路径写法，不做文件系统探测（fixture 里存在同名
  `./site.tsx` 时 `--report site` 仍报错，证明判别只看字符串）；`config.report`
  不是 `defineReport` 产物时的完整用户反馈，出处点名配置文件的 `report` 字段（与文件默认导出非法的反馈只差出处）；mtime cache-busting 只作用于装载入口本体——`--report
  <文件>` 改报告文件后下一次装载读到新内容，`config.report` 的入口是配置文件，断言面是传给装载器的入口路径，不测进程重启行为。
- **view 数据装载（ViewScan）**：`resolveViewInput` 的位置参数 / `--record` / `--run`
  互斥与存在性校验，位置参数按 eval id 前缀透传、含义不随文件系统状态改变；`loadViewScan`
  的有效根收窄使证据室（`attemptsByBase` / `artifactDirs` /
  `attemptPages.locators`）与报告槽 Selection 同步收窄；`viewData`
  只含证据室元信息（`composedRuns`、`skippedRuns`、`report` 元信息）不携带统计产物；外壳标题取值链与
  `ReportLink.icon` 原样透传进
  `viewData.report`；`viewData.report.pages` 是外壳认识的全部 scope-input page（同时是内容块与 `#/page/<id>` 路由的键），声明 `navigation: false` 的页带标记在列而不是被删掉——导航列不列由外壳按这个标记决定；报告文件缺失、非法默认导出、前缀 / 实验匹配不到、零可读结果的完整错误反馈；报告文件变更后下一次装载读取新内容（不复用陈旧模块缓存）。全部以返回结构、Map/Set 内容与错误对象为断言面，不断言渲染出的 HTML 或终端文本。
- **持续重建（view 本地模式）**：watch 输入闭集的判定——有效根内的记录变更、报告文件与它的项目内
  import 图（含自定义组件文件）、主题文件、`niceeval.config.ts` 触发重建；有效根之外的记录与依赖目录
  里的包不触发。重建是整条管线重跑，同一输入下与 `--out` 产物逐字节一致（这一格是「增量拼接」错误
  算法唯一会红的地方，fixture 要让新落盘的 attempt 改变覆盖分母）。连续事件去抖后合成一次，重建期间
  到达的事件在本次结束后再建一次、不堆积。装载失败时保留上一份可用产物并推出结构化错误，`--out`
  下同样的错误按非零退出。断言面是重建调度器的调用序列与产出结构，不是浏览器行为。
- **站点根归一（`index.html` 的 `<base>` 引导脚本）**：脚本对 `location.pathname` 的站点根判定——无尾斜杠的索引路径（cleanUrls 托管）补出目录形态、已是目录形态（`/`、`/sub/`）不插入 `<base>`、末段带扩展名（`/out/index.html`）按其目录取根。断言面是把导出产物里那段脚本原样喂给 fake `location` /
  `document` 后落下的 `base.href`，不是整页 HTML；无尾斜杠那一格是唯一能把「按文档目录解析」与「按站点根解析」区分开的输入，缺了它相对引用少一层的错误算法照样全绿。
- **Attempt 证据数据源**：`attemptSummary.compute(evidence)` 等纯派生零 IO、evidence 装配恰好一次；
  组合组件的展开树构成与二选一规则；source 缺省取 page 注入 evidence、错位使用的完整反馈；
  对话数据的分轮与容错。渲染出的 DOM、默认展开标记、染色与交互归 E2E；改动这些组件后需要
  `pnpm run build:report`，改动 view 壳 / dialog 摆放后需要 `pnpm run view:build`。
- **源码调用树的数据语义**：源码证据按 entry 角色确定主干，不按断言命中数猜测。跨文件 `loc`
  在没有 callers 时进入 detached，有 callers 时挂回最内层主干帧。package 与 unavailable 中间段
  不吞掉更深节点；只有没有 `loc` 的记录进入 unmapped。完整树不受展示预算影响。default、full、
  file 与 web 的行选择只在投影函数发生。
- **`attemptAssertions` 的计分制字段**：`.points` 挣分随所在 `AssertionResult`
  一起出现（不需要单独投影，字段本就在断言记录上，包括「挂了的检查点挣 0 分」这种如实不隐藏的场景）；**得分点不参与 passed 收纳**——passed 的得分点逐条进平铺列表、不折进
  `passedGroups` 计数，收纳只作用于不带 `.points`
  的观测断言（[收纳豁免](../../../feature/assertions/library/display.md#计分制points-与给分记录)）；得分点挣满计数（`2/5 得分点挣满`，连续打分不足
  `n × 1.0` 不算挣满）是 data 层字段；`t.score(label, n)` 的给分记录与断言分属两个数组，按
  `groupPath.join(" > ")` 分组（与 `passedGroups`
  同一套算法，无分组归到空键）；没有 assertion 但存在给分记录时 `attemptAssertions` 不是
  `null`（存在性判断是"两个数组都空"，不是只看 assertions）；通过制 attempt 的 `scoreEntries`
  字段恒省略，不摆空数组；`validateAssertionsData` 对 `scoreEntries`
  存在时的结构校验（`label`/`points` 类型）。
- **计分制的 attempt 详情数据**：`attemptSummary`
  的本轮挣分字段（计分制 attempt 才出现，通过制省略——它是详情页总分的唯一出现处）；`attemptSource`
  的给分投影——得分点行的挣分标注、`t.score` 调用行的给分标注、前置中止行的 `⤓`
  与其后源码行的未到达标记；`attemptFixPrompt`
  把丢分得分点与前置中止都算可操作失败（计分制 `passed` 有丢分不是 `null`，挣满且未中止才是
  `null`，通过制 passed 恒 `null`）。染色、降灰、pill 与右缘 sticky 的呈现归 E2E 报告域。
- **计分制的跨文件源码投影**：跨文件给分进入调用片段或 detached block。没有 `loc` 的得分点与
  给分记录进入 unmapped，并按 `groupPath` 分组；分组算法与 `attemptAssertions` 相同。
- **外壳与页面装载**：三种声明形态归一到同一规范化产物、`content`/`pages`/`extends`
  恰好其一、标题取值链、资产路径纪律与 head 白名单/转义/scheme 分流、page id 与 attempt-input
  page 的校验规则。全部以装载结果或错误对象为断言面。
- **show 终端宿主的选择、时间轴与文案**：`show`
  专属的纯函数与错误路径以返回值或文案为断言面，不依赖终端排版——`attemptHistory` 按 experimentId +
  evalId 分节、跨 Run 按 attempt 身份键去重（resume 携带的复印件不占行）、startedAt 升序、单行摘要与成本派生；紧凑索引行的判定原因（`verdictReasonLine`）对多行
  `error.message` 折首行并剥控制字节收口，完整多行 message 归 attempt 详情块展开；`showCommand` /
  `otherPagesText` 按 `HostCommandContext`
  拼出可复现的页/组索引命令，只列未渲染的页且携带完整上下文；eval
  id 前缀无匹配、`--history`/`--report`/`--page` 的互斥与用法冲突、`@<locator>`
  语法错误与索引未命中、证据切面撞多个 eval 时的紧凑索引——全部以 CLI 抛出的错误对象/文案为断言面。
  跨 Run 的当前 Sample 选择与去重语义不在这里重复，归[单元测试 Record / Sample](record.md)的
  `currentSample()` 类别。
- **o11y 数据派生**：
  - `estimateCost` 对未知 Model 返回 `null`。缺少 Usage 时不猜零成本。
  - `buildExecutionTree` 合成标准事件流与 OTel
    span。按 callId 精确关联；关联失败时保留占位，不按名字猜。`context.injected` 原样进入执行树。
  - `deriveRunFacts` 把只有 called 的调用记为
    `pending`。配到 result 后使用 result 状态。只有 result 时保留占位。
  - 同一 callId 在 result 之后再次 called，表示新的调用。Fixture 要跨 Turn 复用 callId，防止实现覆盖前一次调用。
  - `contextInjections` 只计数 `context.injected`，不与其它事实重复。
- **show 的范围 × 切片正交**：
  - source、execution、timing、usage 与 diff 接受同一种范围。单 locator 只是单元素范围，不走专用选择路径。
  - 每个 `--exp` 必须只匹配一个 Experiment。多条件按 Eval id 配对，缺席条件显示 `—`，且不计入分母。
  - `flipped` 只表示判定不一致。逐行差值使用原始值；任一侧缺失时，差值也缺失。
  - 每个条件的 totals 描述自身覆盖面。paired
    delta 只聚合基线与候选共同拥有的 Eval。Fixture 必须让两侧覆盖不同，防止实现直接相减两个 totals。
  - 混合题型按通过制与计分制分段，各自使用独立分母。断言面是 `deltaRows`。
  - `--stats` 中 `failed` 与 `errored` 分列，`skipped` 不计。无执行组合是缺失，不是三个零。断言面是
    `stabilityRows`。
  - 每一种参数冲突都返回完整用法错误。

  用户侧全流程见[从终端做跨条件归因](../../../feature/reports/use-case/分析/终端跨条件归因.md)。口径单源见
  [Measure Views](../../../feature/reports/components/charts/README.md)。

- **usage 组装与 facts 投影**:usage 行/表的组装口径单源见
  [Library · Attempt 详情 · `attemptUsage` 组装口径（单源）](../../../feature/reports/components/attempt-detail/usage-table.md#组装口径单源)——行为计数(turns/toolCalls)来自事件流、token 来自
  `Usage`(桶恒互斥,`inputTokens` 即未缓存输入)、token 片段只在 `cacheReadTokens` 在场时标 "uncached
  in"(fixture 要有「cache 桶缺席」的场景证明不给无拆分的数字贴标注)、`requests`
  缺失时片段整段省略(区分「省略」与「显示 0/1」)、合计对含 `—` 的列标不完整;这些判据的断言面是
  `attemptUsage`，facts 在单元层只证明读取后的数据投影。attempt 首页 `usage:` / `facts:`
  行、`--usage` 表、缺失占位与分节怎样被用户看到，统一由 Report
  E2E 从公开 CLI 验收，不在 show 单元测试复述文本。
- **execution 的预算、句柄与 grep**：
  - 预览按段截断。普通卡正文、TOOL 的 input/result、失败命令的命令行/stdout/stderr 分别计段。
  - 每段最多三行，并有 1 KiB 的 UTF-8 字节兜底。骨架标签不占正文预算。
  - 卡尾只出现一条截断提示，汇总被折叠的行数和字符数。
  - Agent 卡与失败命令卡的句柄从事件序确定性派生。相同 Fixture 两次派生必须同值。
  - `--expand` 恢复完整落盘值；句柄越界时报告实际范围。
  - `--grep` 搜索角色文本、工具名、input、result，以及失败命令的 display/stdout/stderr。
  - 命中卡片仍受预览预算约束。完整可见输出由 Report E2E 验收。

  用户怎样从 locator 下钻，见[`@locator` 用例](../../../feature/reports/use-case/调试/按定位符下钻.md)。

- **`--json` 投影**：
  - envelope 包含 format、schemaVersion、view 与 scope 回显。
  - text 与 JSON 消费同一次组件 resolve 计算出的 Content。它们必须选择同一批实体，共有字段必须同值。
  - JSON 是 text 的数据超集，不要求字段集合相等。
  - timing 的 JSON 始终保留完整树，不受 text 的节点预算影响。
  - stdout 只写一个 JSON 文档，警告写 stderr。`--json` 与 `--report` 互斥。
  - 本类别只证明 envelope 与跨视图不变量。逐视图字段由对应数据源类别证明。

  设计理由见[show 的切片是组件选择](../../../feature/reports/architecture.md#show-的切片是组件选择)。

- **主题装载与规范化**：
  - `defineTheme` 的校验按规则类别取代表场景，不逐字段枚举：颜色 hex 语法、`ThemeColorPair` 缺分支、`series` 长度不是六、`font` / `fontSize` / `radius` 里出现 `;` 或 `}`、资产路径违规（`..` / 绝对路径 / `~`）各一条，报错必须指到具体字段路径（`theme.series[3].dark`）。
  - **四档取值链的区分力**：`--theme` / 报告外壳 `theme` / `config.theme` / 内建 `basalt` 四档要用**互不相同**的令牌值构造，断言生效的是预期那一档；至少一条 fixture 同时配两档以上，证明高档整份取代低档而不是合并。
  - **不跨档合并**：生效主题未声明的令牌取 Basalt 的值，不取下一档同名令牌。这一格是唯一能区分「取代」与「合并」两种实现的场景。
  - 规范化产物是数据级断言：完整令牌表（单值展开成相同的 light / dark，pair 保留两支）与有序资产清单，路径相对**主题文件**解析。不断言生成的 CSS 文本。
  - `--theme` 裸词只查内建主题名表、不回落文件探测；未命中的报错列出可用名字。与 `--report` 的判别规则同源，只保留一条代表场景。
  - `show --theme` 拒绝：断言错误对象与下一步指引，不断言终端输出。
- **`seriesPins` 在页级色分配中的作用**：钉住的键原样占位、其余键在剩余槽里探测、多个键钉同一下标不触发探测、钉了但本页未出现的键不保留槽位。分配结果是**下标**，fixture 必须证明换一份 `series` 色板不改变任何键的下标——这是「主题只管颜色、报告只管含义」在数据层的判据。校验错误指到 `seriesPins.<维度>.<值>`。

  用户怎样换主题与写主题包，见[给报告换主题](../../../feature/reports/use-case/交付报告/主题/)；官方主题取值见 [Basalt](../../../feature/reports/themes/basalt.md)。

## 不这样测

- 不把 Reports 整体当作"展示层"薄测；选择、去重、读数和聚合会静默给错答案。
- 不在本层断言渲染产物——终端排版、DOM 结构与 Run 锁定的是呈现，归
  [E2E 功能域 · 报告与读面](../e2e/report.md)对真实产物验收；本层观察数据。
- 不用相同 attempt 数的题目验证两级聚合，因为它与平铺算法可能恰好相等。
- 不在本层断言主题的最终视觉：令牌块文本、级联结果、对比度与色觉可分辨性归 E2E 与主题验收，本层只证明装载选了哪一档、规范化出了什么数据。
- 数值、排序、覆盖率和 refs 直接精确断言，不从渲染字符串反推。
