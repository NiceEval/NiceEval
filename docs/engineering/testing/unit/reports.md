# Reports 怎么测

契约出处：[Reports](../../../feature/reports/README.md)、[Architecture](../../../feature/reports/architecture.md)、[Library](../../../feature/reports/library.md)、[Show](../../../feature/reports/show.md)、[View](../../../feature/reports/view.md)、[Observability](../../../observability.md)。

单元层证明 Reports 的**数据语义**：`rollup` / `aggregate()`、公开 `to*` 转换、 page render 与装载规范化、报告定义的校验反馈。
观察面是规范化结构、普通值形状、错误对象与文案。
本篇的缝：构造 Sample / evidence fixture 作输入，测其上的计算与装载逻辑；缝的真实侧（真实输出上的出口与渲染）由 [E2E 功能域 · 报告与读面](../e2e/report.md)验收（[Fake 边界](README.md#fake-边界mock-什么测哪一层)）。
渲染出来的终端排版、DOM 结构、双面比对、样式与交互不在本层，归 [E2E 功能域 · 报告与读面](../e2e/report.md)对真实运行的输出验收。
渲染缺陷在单元层的 DOM 断言下仍可能逃逸，只有真实输出能拦住。
先例：

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
        { id: "a", verdictClaims: ["passed", "failed", "passed"] }, // 题内 2/3
        { id: "b", verdictClaims: ["passed"] }, // 题内 1
        { id: "c", verdictClaims: ["errored"] }, // 端到端记 0
        { id: "d", verdictClaims: ["skipped"] }, // 不进有效样本
      ],
    },
  ],
});
```

这个 fixture 中端到端两级聚合 = 5/9、排除 `errored` Verdict Claim 的条件口径 = 5/6、Attempt 平铺 = 3/5、先折叠 Verdict Claim 再计票 = 2/3——四个值彼此不同，测试才能发现口径被换掉。
各题 Attempt revision 数必须不同，否则两级聚合与平铺可能恰好相等。

**MetricValue fixture** 共享三种不能混淆的值：measuredZero（value 0、有样本）、partial（有值、证据完整度不满）、missing（value null、零样本）。
每个组件至少验证 `null` 不被显示成 `0`、partial 保留证据完整度、refs 没有被渲染前计算丢掉。

## 观察面：数据级断言

1. **计算结果的事实**：数值、证据完整度、排序、缺失行为，全部在 `MetricValue` / `EvidenceRow` / 表格行级断言。
2. **装载与 page render**：`defineReport` 规范化、`page.render` Promise 缓存、非法输入的完整用户反馈——断言规范化结构与错误对象，不断言渲染结果。
3. **计算与格式化分别可断言**（`value` 与 `display` 独立），不从渲染字符串反推计算正确。

校验器测试按**规则类别**预算，不按字段清单枚举：一个共享的必填字符串、optional number、nullable 字段或嵌套路径规则各保留一条有区分力的代表场景；判别联合的每个分支可以各有一条，因为分支实现彼此独立。
新增字段若只是复用已有规则，由数据语义测试与类型检查承接，不再为“这个字段也调用了同一个校验函数”复制一条 case；只有引入新的 literal 约束、递归容器或联合分支时才新增校验器 case。

## 证明范围规范

- **读数聚合口径**：两级折叠与题目权重、默认通过率的 errored=0 口径、skipped 与 null/0 的语义分离。
  固定题集分母（notRun 与 unscorable 不合并）、跨 Run 按身份键去重、自定义读数的 where 与两级 `aggregate()`、分组维度规则。
  每条口径都要有能与错误算法区分的 fixture。
  实现落点 `src/report/model/calculation.ts`；测试 `calculation.test.ts`。
- **Eval 级分组与 coverage 参照点**（[Library · 分组](../../../feature/reports/library.md)）： `aggregate().by` 在 Experiment × Eval 单元上执行。
  分组函数收 `AggregationSubject { experimentId, evalId, run }`，不收 AttemptHandle。
  官方 `agent` / `model` 读 Run 顶层，`experiment` 读 experimentId， flags / labels / 运行配置读 `run.experiment`。

  fixture 必须含：attempts 数量不等、题内部分 null、题内全 null、零 attempt coverage、多 Experiment 分组、全缺口 Experiment。
  删除 coverage 单元或把 basis 改回 attempt 时相关测试必须失败。
  「按 AttemptHandle 分组」与「全缺口 Experiment 丢弃」是两个方向的失败，都要有 case 抓。
- **`totalScore`（计分制总分）**：
  - 计算值是 `assertions[].points` 与 `scoreEntries[].points` 的总和。
  - `failed` 仍保留已经挣到的分；`errored` 与 `skipped` 返回 `null`。
  - 通过制 Eval 不参与该读数，也不拉低分母。
  - 同一 Eval 的多个 Attempt 取均值；跨 Eval 求和。
     Fixture 必须用不同题目分值区分“求和”和“求均值”。
  - `snapshot.evaluationKindComposition` 分别证明纯通过制、纯计分制和混合 Sample。
  - `totalScore` 从 `niceeval/report` 顶层导出，并与内部定义保持同一引用。
    只需一个代表场景，不为每个内建读数重复测试。

  用户怎样读取计分报告，见[固定题集做考试成绩单](../../../feature/reports/use-case/分析/固定题集成绩单.md)。
  主读数规则见[题型构成与主读数](../../../feature/reports/library/measures.md#题型构成与主读数)。

- **显示值单点**（[格式化只有一个入口](../../../feature/reports/library/presentation.md#格式化只有一个入口)）： `MetricValue` 只携带 `value` 与 `format` / `unit` 元数据；展示字符串由 renderer 调 `formatMetricValue()` 按当前 locale 生成，`value` 与格式化结果各自可断言。
  逐项核对：

  - 五支 unit（`"%"` / `"ms"` / `"$"` / 自定义 unit / 省略）各一条。
    区分力场景是 `tokens` 单位的 46500 折成 `46.5k tokens`——只有走 unit 分派才区别于 `String(value)` 的 `46500`。
  - 同一份 fixture 里 experiment 行、Eval 分组行与 attempt 行的同名读数格显示同一种格式；分组行与汇总行不另起一条格式化路径。
  - `MetricFormat` 的 `custom` 分支涵盖内建格式，且不改变 `value` 与聚合结果。
  - `formatAxisTick` 的精度跟随步长：步长 `0.25` 打 `0.25`，同一个值经 `formatMetricValue` 走缩写。
- **缺数据词表**（[缺数据、不适用与占位](../../../feature/reports/library/presentation.md#缺数据不适用与占位)）：三个内建 code 在 `en` / `zh-CN` 各有文案，`formatCellText` 与 web 面读同一份；未命中词表的 code 原样显示不被吞掉。
  区分力场景是 `zh-CN` 报告里的 `missing` 格不出现英文文案。
- **呈现工具箱的导出面**（[公开函数总表](../../../feature/reports/library/presentation.md#公开函数总表)）：总表里的函数从 `niceeval/report` 导出，前四组同时从 `niceeval/report/react` 导出且与内部定义同引用。
  色板数组、槽位号与取色函数不在任一公开面上。
  只需一个代表场景，不为每个函数复制一条。
- **MetricValue 与缺数据**：字段构成与序列化不丢值；`validateContent` 递归到嵌套字段、报错带完整路径、结构错误恒转完整用户反馈不抛TypeError；缺 artifact 时返回 null 不猜值。
- **动态行的解码入口**（[编译期作者契约 · 动态数据](../../../feature/compile-time-contracts/library.md#动态数据经过独立解码函数)）：`parseEvidenceRow` / `parseEvidenceRows` 对 `unknown` 完成 `evidenceRow()` 在类型层完成的同一条证明——至少一个 MetricValue 字段、其余字段是维度可用的标量，失败消息点名字段。
  区分力场景是「只有维度字段的行」与「MetricValue 结构不完整的行」各自报出自己的字段名,不折成同一句。
- **报告作者静态契约**（[编译期作者契约](../../../feature/compile-time-contracts/README.md)）：由 `pnpm run typecheck` 运行带 `@ts-expect-error` 的 fixture。
  普通页与参数化页 union 保住 Params / Input。
  参数化页缺 `load` 或保留导航、`aggregate()` 的重名 / `refs` 键、只有维度的 `evidenceRow()`、图表的错误字段 / `refs` / 不可排序字段都不能编译。
  `ReportDefinition` 与 `ThemeDefinition` 只能由各自 factory 构造。
  动态 config 值跨 source → dist host 边界时不靠类型断言：host 用 factory predicate 重新证明品牌，伪造对象必须得到完整用户反馈。
- **站点组件与内建报告**：
  - `standard` / `failures` / `stability` 的构成与具名导出同引用；各一张导航页，pages 里的详情页与 `standardAttemptPage` 同引用。
  - 三张 scope-input page 均相邻放置 `sampleWarnings` 与 `runDiagnostics`。
  - `defineReport` 复用别处页的数组展开（页等值、外壳不沿用）。
  - 组合组件与手写组合严格等价。
  - `ExperimentScatter` 按题型选择 passRate / totalScore，mixed 拆成两张图。
  - `ExperimentTable` 把 `toExperimentRows` 投影为 Experiment → Eval → Attempt 的层级 Table。
    Attempt locator 保留给 web 宿主下钻。
    路径段组的题数内联在身份格；它不能成为另一条 detail 续行。
    Tokens 列必须区分四层口径。Experiment / 路径段组先分别计算每个 Eval 的 Attempts 平均，
    再让范围内每个 Eval 等权参与总体平均。Eval 取该题 Attempts 的平均，Attempt 取该次精确值。
    完整流量计入 uncached input、cache read、cache creation 与 output，表头明确为平均 Tokens。
    成本列使用同样的四层聚合口径，表头明确为平均成本。
  - `SampleOverview` 严格等价于 `SampleSummary + ExperimentScatter + ExperimentTable`。
  - 数据派生证明 hero、warning 分组聚合与组排序。
  - Hero 的 `logo`、`description` 与 `links` 从组合组件原样进入 `HeroCard`； text 面保留介绍与链接，省略纯视觉 logo，web 面的布局与响应式样式归 E2E 验收。
  - `runDiagnostics` 对 Sample / 直接传入的 Run[] 同值投影、空诊断过滤、 experiment → startedAt 排序、出处不合并、开放 code 原样保留。
  - React Content 不携带 Run/AttemptHandle；渐进增强不改数据。
  - 内建首页三行装配（`SampleSummary` + frontier 散点 + 实验表）以页 render 与组件树为断言面。
- **参数化页与下钻目标**（[Library · 目标与下钻](../../../feature/reports/library.md#目标与下钻)、[参数化页](../../../feature/reports/library.md#参数化页attempt-与-experiment-详情)）：
  - 装载期规则：重复 id、声明 `params` 但缺 `load` 或 `navigation` 非 false，均按完整用户反馈拒绝；校验不执行任何 `load` / `render`。
  - `renderTarget` 单路径：attempt 目标与 experiment 目标走同一条分派，宿主分派代码里 grep 不到实体词（断言面是公开分派函数对两类目标的行为等价，不是源码文本）。
  - `params` 往返：`decode(encode(p))` 与 p 深相等；`enumerate` 对有效根给出全部实例（attempt 页 = 全部 locator，experiment 页 = 全部 experiment id），收窄之外不出现。
  - `ctx.href`：目标页存在给 URL；页不存在、encode 抛错给 `undefined`，组件输出纯文本节点，不产出空 href。
  - 下钻默认规则：恰好一个 ref 给 attempt 目标；零个与多个都给 `undefined`。区分力场景是双 refs 行——旧的「取 refs[0]」实现在这一格是唯一会绿的错误答案。
  - 图表 `pointTarget`：显式函数逐点生效；省略走下钻默认规则；`external` 图表没有该属性。
  - `ExperimentScatter` 点目标：默认指向 `experiment` 页且参数是该点实验 id；报告无 `experiment` 页时点无链接。
  - `ExperimentDetails`：收窄恰好一个实验时六区块投影同一份转换结果；零个或多个实验按完整用户反馈报错；experiment 作用域 facts 进 notices 区块。
  - 断言面是组件树与公开函数返回值；dialog 打开、hash 路由与导出站几何归 e2e 报告域。
- **`StabilityOverview` 的投影**：散点与堆叠柱从 page render 算好的 `EvidenceRow[]` 投影。
  点身份是 `eval · condition`；零执行格的 `passRatio` 为 `null` 不为 0；堆叠三段与 `totals` 同值；格 `refs` 原样进两个 MetricValue 的 `refs`（`refs.length` 等于该格执行数）。
  读数格的零通过与闪烁计数各一条区分力 fixture（全过与全挂都不算闪烁）。
  断言面是组件树 props，不经浏览器。
- **报告树校验与非法节点**：`resolveReportTree` 后 `validateReportTree` 对 `ReportNode` 全集与非法 props 给出完整用户反馈；sibling 并行但输出保序。
- **维度绑定的三件通用能力** （[图表](../../../feature/reports/components/charts/README.md)、 [复合维度](../../../feature/reports/library/measures.md#维度与数值轴)）：轴、行、列、格、series 的 `by` 用同一份解码。
  - **复合维度**：在每个位置都合法且解码出同一个维度（name 以 ` × ` 连接、值以 ` · ` 连接、成员缺失走 `(missing)`）。
    区分力：同一 `EvidenceRow[]` 分别作为 `Table rows`、`Scatter point` 与 `series` 维度时 keyset 深相等。
  - **`limit` / `rest`**：截断在 page render 内发生。
     `rest` 在合并后的 keyset 上重新聚合，不是把截掉的几行平均（fixture 要让「合并重算」与「行均值」得出不同的数）。
     `rest` 恒排末位且带自己的 `samples` / `total` / `refs`。
    维度值不超过 `limit` 时不产生 `rest` 条目；只给 `limit` 不给 `sort` 按完整用户反馈报错。
- **主题钉色**（[钉色](../../../feature/reports/library/shell.md#钉色)）：报告外壳 `dimensionPins` 的键原样占位、自动分配只在剩余槽里探测、多个值钉同一下标不触发探测、钉了但页内未出现的键不占槽；非法维度 name / 值键 / 下标按完整用户反馈拒绝并指到 `dimensionPins.<维度>.<值>`。
  区分力场景是「同一份数据加钉与不加钉，未钉键的落槽不同」。
- **Chart 呈现约束**：`Chart.series` 只能改写已有 series key 的线型、点形、标签与可见性，不能改变 mark、绑定或聚合；未知 key 给出完整用户反馈。
- **`Markdown` 的解码与两面投影** （[排版原语 · Markdown](../../../feature/reports/library/layout.md#markdown)）：断言面是解码出的 AST 与两面输出字符串，不经浏览器。
  证明每类块与行内节点在 text 面的投影（标题空行、列表前缀与缩进、代码块不折行、块引用 `>` 前缀、链接 `文字 (url)`、图片 `alt (url)`、无 ANSI 时脱去强调标记）。
  原始 HTML 块与行内 HTML 一律转义成可见文本，不进 web 输出。
  表格语法按完整用户反馈报错并指引 `Table`。
  折行与宽度量测走 `stringWidth` / `wrapText` 同一张表（中文正文不撕歪）。
   `LocalizedText` 正文按回退链选语言，缺语言不报错也不留空。
- **`Table` 的 subRows 与 placeholder**（[Table](../../../feature/reports/components/primitives/table.md)）： `subRows` 在 text / web 两面逐层渲染；`variant: "placeholder"` 行照常显示但不进入任何列的聚合读数。
  两面各一份区分力场景——断言面是 Content 与两面输出字符串，不经浏览器。
  行 key 判重按层级同层进行：不同父行下的同名子行在两面都合法，同层重复 key 才报错。
  区分力场景是「两个父行各带一个同名子行」——只有把展平行当同层判重的错误实现会在 text 面误报。
- **表格行形状与列集同源** （[契约](../../../feature/reports/components/primitives/table.md#content-协议)）：断言面是校验错误对象。
  逐项核对：

  - 行 cells key 集合与列集相等，两个方向各一条：多写一个列集外的 key、漏写一个声明列，错误都指到行 key 与列 key；各层 subRows 与 placeholder / group 行同规则。
  - 区分力场景是「同一个 attempt 行构造函数被层级表与平铺表两种列集消费」——两张表各自通过校验，证明行按消费它的列集填格，不是一份格子四处塞（[cell-key-must-match-column-set](../../../../memory/cell-key-must-match-column-set.md)）。
  - 不适用的列是显式 notApplicable 格：层级表里 Eval 行的 model / agent 格存在且渲染成 `—`，与「缺格」在校验层可区分；tokens 是四层都有值的比较读数，不属于不适用列。
- **表头长在列声明上** （[契约](../../../feature/reports/components/primitives/table.md#content-协议)）：断言面是两面输出字符串。
  逐项核对：

  - 声明了 `header` 的列在 text / web 两面按 locale 读取同一份表头；区分力场景是 zh-CN 下稳定性矩阵首列表头是「题目」、attempt 断言表四列有中文文案——只有表头走列声明读取才区别于原样打出英文 key。
  - 未声明 `header` 的维度值列（条件名、实验 id）在两面原样显示 key。
  - 同一个 key 在两份投影里声明不同 `header` 时各显各的，证明表头只来自列声明，原语不携带列名词表。
- **`Grid` 的换列规则与体裁**（[换列规则](../../../feature/reports/library/layout.md#换列规则)、 [体裁与体量](../../../feature/reports/library/layout.md#体裁与体量)）：断言面是列数纯函数的产出、text 面输出字符串与 web 面的 HTML，不经浏览器。
  逐项核对：

  - 摊匀这一步：给定格数与容量列数产出实际列数，区分力场景是「6 格、容量 5 列排成 3 + 3」——只有摊匀会让结果区别于容量列数本身；7 格、容量 5 列排成 4 + 3 涵盖不整除。
  - 摊匀后的列数从不超过容量列数，因此从不把格子挤到最小格宽以下。
  - 最后一行只剩一格时那一格铺满整行；短于一行但不止一格时按上面各行的格宽左对齐，不拉伸。
  - text 面从格数向一列尝试，每格达不到最小可读内容宽度就降列，一列是无条件 fallback。
  - web 面的 `data-cells` 与随身 `@container` 规则只由格数决定：同格数的两个 Grid 规则文本逐字相同，各断点等于该列数下的最小格宽与格线合计，每条断点同时声明列数与 `--grid-columns` ——体量插值靠后者，规则里不出现留白或字号的具体值。
  - text 面画的是一张格线：列间 `│`、行间 `─`、交点 `┼`，格线之外不画外框；末行短于一行时，它上面那条行间线在缺格的位置收成 `┴`。
- **Callouts / Waterfall / SourceView / Conversation / DiffView / CopyBlock 的两面投影与维度封闭性**：每个原语各一条类别。
  断言面是 Content 与 text / web 两面输出字符串，不经浏览器；证明两面投影正确，以及 renderer 查询未声明维度时抛 `UndeclaredDimensionValueError`（与「`dimensions` 必填与查询封闭性」同一判据，落在各原语 fixture 上）。
- **Attempt 行的判定长在 locator 上** （[契约](../../../feature/reports/components/summaries/experiment-table.md)）：断言面是 `experimentListContent` 产出的 Cell 树与 text / web 两面输出字符串。
  逐项核对：

  - Attempt 行的 locator 格携带该 revision 的 Verdict Claim，三态各产出自己的判定符与语义 class。
  - 区分力场景是「同一道题下 failed 与 errored 各一次 Attempt」——两行的 class 与判定符都不同，证明 Claim 没有被折成「非 passed」一档。
  - 判定符与色同场：两面输出里判定符都在，不靠 class 单独表意。
  - 没有判定的 locator 格（`--history` 等场景）不带判定 class，也不凭空补判定符。
- **判定构成列每层都有值** （[契约](../../../feature/reports/components/summaries/experiment-table.md)）：断言面是 `experimentListContent` 产出的 Cell 树与 text / web 两面输出字符串。
  逐项核对：

  - Eval 行的判定构成格是该题 attempts 的计票，与 experiment 行数题的计票同一 Cell 形态。
    区分力场景是「先 failed 后 passed 的重试」——计票是 `1 通过 · 1 失败`，只按题目级折叠判定填格的错误实现在这一格丢掉失败那一票。
  - Attempt 行的判定构成格是该次 Verdict Claim；同题下 failed 与 errored 两行的格不同，证明没有折成「非 passed」一档。
  - 格子落在层级表列集存在的 key 上：experiment 列集渲染后 Eval 与 Attempt 行的判定构成列不是 `—` （[cell-key-must-match-column-set](../../../../memory/cell-key-must-match-column-set.md)）。
  - 两面显示同源：计票与单判定的 text 面经 `formatCellText` 按 locale 取判定词，单判定带 `verdictMark` 判定符；web 面同一格带 `niceeval-verdict-*` 语义 class。
- **占位行的两类缺口** （[契约](../../../feature/reports/components/summaries/experiment-table.md#缺口原因与动作)）：断言面是 `experimentListContent` 产出的 Cell 树与 text / web 两面输出字符串；web 面只断言原因与可操作 locator 同场，不断言浏览器布局。
  逐项核对：

  - 两类占位行都来自 `SampleCoverage.missing`，结果格都是 `missing` 且带补跑命令；`previous-result` 可带 Sample 已提供的 previous locator，`never-run` 不带。
    区分力场景是「同一个 Sample 里一道题从未跑过、另一道题只有旧 configHash 的结果」——两行必须给出不同的格，把两档折成同一种占位的实现在这里失败。
  - Reports 不遍历 `historyAttempts` 自行寻找替代判定；删除 Sample 的 `previous` 后，报告不得从历史补回 reference。
  - previous 只解释缺口，不进任何计数：带 previous 的占位行前后，该 experiment 的判定计票、通过率与样本命中范围分母逐字不变。
- **报告只有一份固定输入**：`ExperimentTable`、默认首页任务和导出模型只消费传入的同一份、由明确 GraphRef materialize 的 `Sample.attempts`。
  fixture 在 Run 元数据放入与 attempts 冲突的旧 `selectedEvalIds`，断言行、聚合与导出仍完整；组件树中不存在 fresh toggle 或第二份 Content。
- **`formatTimeDistance` 的读法与导出面** （[契约](../../../feature/reports/library/presentation.md#显式历史中的相对时距)）：断言面是函数返回值。
  四个区间各一条，`en` 与 `zh-CN` 各取一条代表场景；不足一个单位的时长取一个单位，不打零。
  区分力场景是 90 分钟——只有按区间分派才区别于恒定按天取整的 `1d`。
- **对照矩阵的固定 Sample 同源** （[契约](../../../feature/reports/show/compare.md)）：断言面是 `deltaTableData` 产出的 `DeltaCell`/`DeltaData` 与 CLI text 输出字符串。
  逐项核对：

  - 每个条件只从同一 Sample 的 attempts 取值；携带条目照常参与，旧配置 history 不补入缺席格。
  - 缺席格保持 `—`，不得带旧 verdict/reference；结构化 missing 原因在样本命中/占位行解释，不改变对照聚合。
  - `--usage` 对照矩阵与 `renderCompareSlice` 不出现出处、时间或 `↩` 状态标记。
- **`formatInstant` 的读法与回落** （[契约](../../../feature/reports/library/presentation.md#时刻不走-unit)）：断言面是函数返回值。
  证明 ISO 折到分钟的人读时间（不含原样 ISO 片段）、不可解码输入原样返回，以及它从 `niceeval/report` 与 `niceeval/report/react` 同引用导出。
   Attempt 摘要格实际调用了哪个入口是渲染输出，归 [E2E 报告域](../e2e/report.md)。
- **`DiffView` 摘要行的增删着色** （[契约](../../../feature/reports/components/primitives/diff-view.md#web-面路径树)）： web 面 `+N` 与 `-M` 各自成元素并各带自己的类，才染得上与 patch 增删行同一套颜色； text 面不受影响，摘要行的增删数仍是 `+N -M` 一段纯文本。
- **`DiffView` 的路径树构成** （[契约](../../../feature/reports/components/primitives/diff-view.md#web-面路径树)）： web 面输出字符串为断言面。
  逐项核对：

  - 文件按路径分层进目录，`change` 只出现在文件行的状态字母上，不产生分组区块。
  - 区分力场景是「同一个目录下 `added` 与 `modified` 各一个文件」——两者进同一棵子树，证明结构轴是路径而不是状态。
  - 目录行给出子树文件数与 `+N` / `-M` 汇总，汇总等于子树内文件的逐项相加。
  - 只有一个子目录、自己没有文件的目录链压成一行；那条链上多出一个同级文件时不压。
  - 二进制文件行显示字节数变化，展开后声明二进制且不出现 patch 元素。
- **`DiffView` 的逐片段 patch 与内联预算** （[契约](../../../feature/reports/components/primitives/diff-view.md#内联预算)）： web 面输出字符串为断言面。
  逐项核对：

  - 一个文件的多个片段各成一段，段头是轮标签，段序即片段时序；不出现跨片段合成的单段 patch。
  - 单文件 patch 超过 64 KiB 时该文件不内联，行上出现 `--diff=<path>` 下钻命令与超预算原因，不出现空的展开区。
  - 实例内联合计超过 512 KiB 后，按路径序在后的文件退化为下钻命令；区分力场景是「把同一批文件的路径序调换」——退化的是路径序在后的那个，证明累加按路径序而不是按体积挑选。
  - text 面不受预算约束：同一份投影下 `--diff=<path>` 输出完整的逐片段 patch。
- **`DiffView` 与 `--diff` 的投影单源** （[契约](../../../feature/reports/components/attempt-detail/attempt-diff.md)）：断言面是 text 面输出字符串。
  逐项核对：

  - `--diff` 摘要与组件 text 面对同一份 `DiffFile[]` 产出逐字相同的输出。
  - 摘要行带触碰片段的轮标签，多片段按时序列出。
  - 净无变化的文件不进 `files`；`files` 为空时区块零输出。
  - `diff.json` 缺失时输出明确缺失与原因，不输出「零个文件改动」。
- **`Waterfall` 的清单收敛与区块头**（[契约](../../../feature/reports/components/primitives/waterfall.md)）： web 面输出字符串为断言面。
  逐项核对：

  - 时长占比低于 1% 的连续短节点折成摘要，带 `kind` 计数与合计时长，留在原时间位置。
  - 摘要只收得到一条节点时不折，那个节点直接列出。
  - `failed` 与 `durationMs` 为 `null` 的节点不折；行总时长为 `null` 时整行不折。
  - 被折节点的 `children` 展开后原样还原。
  - text 面不列节点，行上的节点计数仍计全部节点。
  - 区分力场景是「把一个短节点抬到行总时长 1% 以上」——只有这一格改变清单构成，证明判据是占比而不是绝对时长或节点序数。
  - `title` 在两面渲染为区块头；Content 为 `null` 或空时整块不出现，标题也不出现。
  - 行头 `label` 与 `locator` 同文时只渲染 locator 一次，不同文时两者都在。
  - 带 `open` 的节点默认展开（`<details open>`）且不参与折叠。
- **`Waterfall` 的重复折叠**（[契约](../../../feature/reports/components/primitives/waterfall.md#重复节点折成一条)）： web 面输出字符串为断言面。
  逐项核对：

  - 连续、同 `kind`、`label` 同文的三个及以上显著节点折成一条带计数与合计时长的摘要，展开后逐条还原；被同名节点夹住的异名节点切断连续段。
  - 区分力场景是「同一批节点从三个减到两个」——两个时逐条列出，三个时才出摘要，证明判据是连续计数而不是「出现过重复就折」。
  - 带 `failed` 或 `open` 的节点不参与重复折叠，即使与相邻节点同名。
  - 短节点摘要与重复摘要各自成行，不合并成一条。
- **`Waterfall` 的分解条取叶子** （[契约](../../../feature/reports/components/primitives/waterfall.md#分解条画哪些节点)）： web 面输出字符串为断言面。
  逐项核对：

  - 条上的段数等于树里的叶子数，递归取；带 `children` 的父节点不出段。
  - 区分力场景是「把一个叶子挂上一个子节点」——段数不变而位置换成子节点的，证明取的是叶子而不是顶层或全部节点。
  - `durationMs` 为 `null` 的叶子不出段；全部叶子都缺时长时整条不画，清单照常列。
  - 失败叶子的段带 negative 类，与它落的分类色槽无关。
- **`Waterfall` 的类别着色不认词表**（[契约](../../../feature/reports/components/primitives/waterfall.md#类别与着色)）： web 面输出字符串为断言面。
  逐项核对：

  - 同一个 `kind` 字面在同一份报告里恒落同一个分类色槽，槽号只由字面决定，与节点顺序、所在行、所在层级无关。
  - 区分力场景是「把 `model` 换成一个从没出现过的词」——它照样落到五槽之一，证明色槽是散列出来的而不是查表查出来的。
  - 清单里的类别列不带任何着色类，条上的段才带。
- **页级呈现分配**（[分配单位是页](../../../feature/reports/components/README.md#维度呈现分配单位是页)）：给定一页 `dimensions()` 声明的集合产出映射，断言面是映射本身，不断言渲染出的颜色值。
  逐项核对：

  - 两个 keyset 分开——label keyset 收全部编码的值，visual keyset 只收 `color` / `series` 的值。
  - 区分力场景是「同页一张 27 值的 label-only 表加一张 3 值的图」：三个值仍落 1–3 槽，而它们的标签按 27 值的 keyset 算最短唯一后缀。
  - 同一键在同页多个组件得到同一个槽；撞槽按显示键字典序线性探测；缩短后的显示名不参与取键。
  - 24 槽序列的 `(色, variant)` 两两不同。
  - 槽序表对齐 [视觉编码容量](../../../feature/reports/components/README.md#视觉编码容量24-个身份)：1–6 第一变体、7–12 第二变体。
  - `variant = floor((slot-1)/6) + 1`。
  - visual keyset 超过 24 按完整用户反馈拒绝该页，且 fix 行不提 `dimensionPins`。
  - `ctx.dimension().at()` 返回 [呈现家族](../../../feature/reports/library/presentation.md#实验颜色与维度呈现)的 `label` / `color` / `series` 值。
  - 呈现值可直接作 fill / stroke / marker；不暴露 `colorIndex` 与 `seriesSlot`。
  - 同色不同 variant 的 fill 字符串两两不同。
  - 区分力场景是 MemoryBench leaderboard 五个 `memory` 值：baseline 与 obelisk 同色不同 variant，五个 fill 两两可辨。

- **`dimensions` 必填与查询封闭性**：缺 `dimensions` 的组件定义按完整用户反馈拒绝， `dimensions: () => ({})` 合法。
   renderer 查询未声明的句柄、越界下标或与声明编码不符的用法，抛 `UndeclaredDimensionValueError`，不临时分配。
   **每个自定义组件 fixture 必须同时执行 text 与 web 两个 renderer**，并各自断言未声明查询会失败。
  只跑 text 面抓不到 web renderer 用了未声明的值——text 面不消费颜色，可能根本不发起查询。

- **text 面的呈现降级**：text renderer 的 `ctx.dimension()` 恒返回 label 面，拿不到颜色、 `strokeDasharray` 或 pattern。
  容量拒绝只发生在 web 编码规划，同一份超容量报告的 text 面照常输出。

- **公开呈现函数**：`shortestUniqueLabels` 与 `presentDimension` 从 `niceeval/report` 顶层导出，并与内部定义同一引用。
   `presentDimension(declaration)` 与报告树内 `ctx.dimension(handle)` 对同一份声明返回相同槽位。
  对照面是 stroke / fill 通道；呈现值本身不带槽号。

- **公开 `to*` 转换**（[Library · 实体转换](../../../feature/reports/library.md)）：顶层导出含 `toExperimentRows`、`toEvalRows`、`toAttemptRows`、`toSampleNotices`、`toTraceNodes` 与 `toAttemptSource` 等。
  断言面是返回的普通值形状，不是组件树。
  区分力：零样本、缺 artifact、计分制字段投影、`experimentRows` 的 evalId 分组与占位行、 `failureSummary` 计分制口径、`durationMs` 对 timeout 返回 `null` 各一条代表场景。
  测试落点 `src/report/model/conversions.ts` 与消费方 compute。
- **原语 plain props**：`Callouts items=`、`Waterfall nodes=`、`CopyBlock content=` 与 `Table rows=` 只接收 page render 算好的普通值。
  - `Scatter` / `Line` / `Bars` / `Area` 的 `points=` 遵守同一规则，不经 Source / `data=` 双形态。Sample 派生路径校验 `EvidenceRow.refs` 与 MetricValue；`external: true` 只退出证据校验。
  - `Bars` 的 `sort` / `limit` 只改变显示行序与截断，不聚合长尾、不制造「其他」桶；缺 sort 值沉底。内建三视图的 page render 与具名导出同引用。
  断言面是组件树 props、Dataset 桥接输出或两面输出字符串。
  测试落点：`src/report/definition/primitives/points-dataset.ts`、`marks.tsx`。
- **定义入口**：`defineReport` / `defineRenderer` 保留传入对象引用与泛型形状，不建立注册表或跨 page 缓存；缺 `render` / `text` / `web` 的输入给出完整用户反馈。
  运行期 Content 可序列化、row key 与 column key 的校验仍走 `validateReportTree`，不在定义期重复一份规则。

- **`defineRenderer` 双面协议** （[layout · 自定义 renderer](../../../feature/reports/library/layout.md#自定义-renderer)）：从 `niceeval/report/extension` 导出；text / web 必填；只收已算好的 `value`。
  缺 face、非法 asset、不可序列化 props 失败。
  资产按内容哈希去重；text 不加载 web assets。

- **外部业务数据经 import 冻结** （[Architecture](../../../feature/reports/architecture.md#外部业务数据经-import-冻结)）：无 `--data` / `config.reportData` / `ctx.data`。
  快照模块随报告 import 图进 watch 与缓存身份。
  区分力：改冻结快照文件触发 view 重建； page render 读时钟 / 网络按完整用户反馈拒绝。

- **`ResolvedPage` 单次求值多面投影**：`resolveDefinitionPage` 一次产出 `ResolvedPage`。
  之后 `renderResolvedPageText` / `renderResolvedPageWeb(en)` / `renderResolvedPageWeb(zh-CN)` 都从同一 `ResolvedPage` 同步投影。
  断言面是 `page.render` 调用计数仍为 1（含并发 text/web/locale 投影）。
   view 对每个 page / locator 只调用一次 `resolveDefinitionPage`。
- **双面组件协议**：内置原语与 `defineRenderer` 都只接受 `{ dimensions, text, web, enhance?, styles? }`；携带 `resolve` 或函数形态定义时按完整用户反馈拒绝。
   renderer 参数是已算好的 value、options 与呈现 context，无法触达 Sample 或 artifact IO。
  缺 `dimensions` / `text` / `web` 时失败。
- **纯函数布局算法**：
  - 散点点标签布局是 `chart-math` 纯几何函数，直接对函数断言标签框与点框的几何关系，不经 HTML。
  - 轴值域推定（[值域](../../../feature/reports/components/charts/README.md#值域)）同属这一类：直接对推定函数断言扩后的 `[min, max]`。
    两端各扩数据跨度 20%；零跨度 fallback（值绝对值的 20%、值为 0 取 1）。
    有自然 `bounds` 时保证最小跨度为量程参考的 1/3 并钳到边界（贴边数据点落在框线上）。
    无量程参考的轴不强造最小跨度；反向轴先扩边距再反向。
    两面共用同一份值域，不在渲染层重算。
  - labels 维度与 series 归类的解码规则。
  - [页级色分配](../../../feature/reports/components/README.md#系列色分配单位是页)同属这一类：给定一页的 `(维度, 值)` 集合，稳定散列起点与撞色线性探测产出确定性索引，不断言渲染出的颜色值。
- **面板几何（`panel.ts`）**：区域框契约（[排版原语 · 区域框](../../../feature/reports/library/layout.md#区域框text-面的框线体裁)）的纯函数实现，与 `chart-math`/`grid-layout` 同一类——直接对 `renderPanel` 的返回行数组断言，不经真实终端或 HTML。
  - 顶层 `Section` 画完整四边框；`rows` 里的 `divider` 降为横隔 `├─ ─┤` （含 `encodeDividerLine`/`decodeDividerLine`/`rowsFromBodyText` 的编解码往返）。
  - 宽度上限 100 显示列；调用方声明豁免上限时框宽跟随传入宽度（>100 也成立）。
  - 边框嵌字按「先保标题后保 meta」截断（横线缩到最短一段 → 标题中段截断补 `…` → 最后放弃 meta）。
  - `width < 60` 或 `mode: "plain"` 时整体降级为无框文本（title 单独成行、meta 同行右侧、正文两格缩进，内容与分节顺序一字不变）。
  - CJK / East-Asian-Ambiguous（`·` `●` `…` 等恒记 1 列）的宽度量测与 `text-layout.ts` 共用同一张表。
  - `Section` 的 text 面按 `ctx.panelMode` 接线到 `panel.ts` 而非自行拼框字符。
    这一条只需证明「确实调用了 panel.ts 的输出」，不重复 panel.ts 自己的几何断言。
  - 隔条（`renderRule`）：`boxed` 时是一条不封口的横线，左侧嵌名称、总显示宽度等于框宽并同样夹紧到 100；`plain` 或 `width < 60` 时降为不带横线的标题行。
    嵌字截断复用边框那份优先级。
- **数据格框（`Table` 与 `Grid` 的 text 面）**（[契约](../../../feature/reports/library/layout.md#数据格框table-与-grid)）：断言面是 text 面输出字符串与行宽。
  - `Table`：外框 `╭┬╮` / 表头横线 `├┼┤` / 下边框 `╰┴╯` 各一条，同一张表所有物理行的显示宽度相等。
  - 框宽贴合内容：宽终端下窄表不摊成空白、所有行同宽，自然宽超过 100 列的表也不被夹到 100。
  - 横线按行树边界：有嵌套时每个顶层行之前一条、组内不切；平表只有表头那一条。
  - `Grid` 的格宽同样贴合内容，末行吃掉剩余宽度的那一格跟着收窄，框仍是矩形。
  - 嵌在画框的 `Section` 里只留列边界与表头横线，输出里只有一层外框。
  - 放不下时按比例压左对齐列并在格内折行：两列各让一部分、都不被压到下限，也不报「丢了几列」。
  - 身份列（首列）停在 24 列、其余文本列先让到 8；压到各自下限仍放不下就从右侧丢列并报数，身份列不再变窄。身份列自然宽短于下限时以自然宽为准。
  - 折行保住格子开头的缩进：被压窄的子行续行仍对齐在同一个缩进上，层级不因折行丢失。
  - `Grid`：外框加列边界，行间线交点 `┼`；末行不足一整行时最后一格吃掉剩余宽度，下边框跟着它收——每行宽度仍等于终端宽度。
  - 区分力：同一份数据在 `plain` 与 `boxed` 下的字段与顺序逐字相同，只有线出现或消失。
- **`Tabs` 的 text 面体裁**（[契约](../../../feature/reports/library/layout.md#tabs)）：断言面是 text 面输出字符串。
  - 每个 tab 起一条隔条，名称后带 `n/m` 位次；`Tabs` 自己不画框。
  - tab 正文不缩进：同一张宽表在 tab 里与直接放在页上的输出逐字相同。
  - 区分力：tab 里放 `Section` 时框由那个 `Section` 画，输出里只有一层边框。
- **宿主装载等价**：不带选项的 `show`/`view` 与 `--report` 在装载边界消费同一份 definition（同引用）。
  它们也消费由同一固定 `RecordGraphRef` 与规范化 selection 生成的 `MaterializedSample`（深等），不按时间戳或可变 head 另选成员。
  这里不比较终端输出与 HTML；渲染面与进程级读面行为归 E2E。
- **报告取值链与 `--report` 值判别**：两宿主共用的读取函数，断言面是读取出的 definition 引用与错误对象，不经渲染。
  - 三档取值链按 `--report` → `config.report` → 内建 `standard` 逐档回落。
    每档产出的 definition 与直接 import 该定义同引用。
     `config.report` 在场时不带选项运行不得再取内建。
  - `--report` 形态判别：含 `/`、以 `.` 开头、带 `.ts`/`.tsx`/`.js`/`.mjs` 后缀的按文件装载。
    其余不含路径的名称查内建视图名表（`standard` / `failures` / `stability` 各命中且与对应具名导出同引用，`standard` 兼默认导出）。
    未命中时报错列出全部可用名字并给出路径写法，不做文件系统探测。
  - `config.report` 不是 `defineReport` 返回的定义值时的完整用户反馈，出处点名配置文件的 `report` 字段。
  - 报告出处标签与取值链同档：`--report` 在场点名它的取值，只有 `config.report` 时点名配置文件的 `report` 字段，两者都没有才说内建。
    区分力场景是「没写 `--report` 但配了 `config.report`」——把出处按 `--report` 是否在场二分的实现在这一格说成内建。
  - fresh import 让装载入口及其项目内 import 子图失效；改报告文件或它 import 的组件后下一次装载读到新内容。
- **view 数据装载（ViewScan）**：`loadViewScan` 的数据层语义以返回结构、Map/Set 内容与错误对象为断言面。
  - Store / Graph / payload 失败按 Record 的穷尽错误与 `EvidenceValue` 轴如实进入数据层。
  - 报告槽与 show 使用同一固定 `RecordGraphRef`、规范化 `SampleSelection` 和 `MaterializedSample` identity。
  - membership 按完整 `SampleMemberIdentityV1` 与 proof 验证；不得按时间、locator 或对象引用去重。
  - 新布局落盘直接可读（写入面 / 读取面同一契约）；零成员与 unavailable coverage 仍是可分辨结果。
  - `viewData` 只含证据室元信息，不携带统计输出。
  - 自定义报告未声明 attempt-input page 时，ViewScan 补官方详情页与 locator 索引，但不把隐式页混入自定义导航；显式详情页仍优先。
  - 报告文件或其项目内依赖变更后下一次装载读取新内容（namespaced import，不复用陈旧模块缓存）。
  - `resolveViewInput` 的输入校验、外壳导航与标题在真实站点上的呈现，归 [E2E 功能域 · 报告与读面](../e2e/report.md)。
- **持续重建（view 本地模式）**：watch 输入闭集的判定——有效根内的落盘变更、报告文件与它的项目内 import 图（含自定义组件文件）、主题文件、`niceeval.config.ts` 触发重建。
- 有效根之外的落盘与依赖目录里的包不触发。
  本地 server 默认监听全部 IPv4 网卡，并列出可访问的本机与局域网 URL；显式 `host` 时只绑定并公布该地址。
  重建是整条管线重跑，同一页同一语言的报告块与 `--out` 逐字节一致（这一格是「增量拼接」错误算法唯一会红的地方，fixture 要让新落盘的 attempt 改变样本命中范围分母）。
  连续事件去抖后合成一次，重建期间到达的事件在本次结束后再建一次、不堆积。
  装载失败时保留上一份可用输出并推出结构化错误，`--out` 下同样的错误按非零退出。
  断言面是重建调度器的调用序列与产出结构，不是浏览器行为。
- **重建理由的闭集性（无旁路）**：闭集之外的事件不重跑管线。
  请求 `/` 不构成重建理由——盘上没变时连续两次请求命中同一份输出，管线只跑过启动那一次。
  区分力靠计数：只断言响应体相同的写法在「每次请求都重建」下照样全绿，必须数 `planSite` 的调用次数。
- **失效分流（落盘变更不重装模块图）**：落盘变更沿用上一次装载出的报告 / 主题定义，模块文件变更才重新装载。
  区分力在**定义对象身份**上，不在输出字节上：改落盘后重建，报告定义是同一个对象；改报告文件后重建，是新对象。
  两格都断言输出跟着变——只测身份不测输出，「永不重装」的错误算法会漏过去。
- **按订阅渲染（只渲染看得见的那一块）**：本地模式一次重建只渲染订阅声明的 `(pageId, locale)`；其余页与语言经 `report/<pageId>.<locale>.html` 按需渲染，`--out` 全渲并预烘进 `index.html`。
   fixture 用多页报告（至少两页 × 两语言），断言面是每页渲染函数的调用次数——单页 fixture 分不开「渲染一块」与「渲染全部」。
  同一 `(pageId, locale)` 在按需路径与 `--out` 下逐字节一致，这一格接住渲染时机漂移。
- **renderer 资产进入站点管线**：一张已求值的 page 返回 HTML 与按内容哈希复制到 `assets/` 的 CSS/JS。
  站点块带对应的加载标签，资产文件登记进同一份 `SitePlan.files`；同一资产被两种 locale 请求时只登记一次。
  区分力是只在 renderer 单测调用 `materializeRendererAssets()`、但 view 完全不消费结果的错误接线会红。
  浏览器是否执行脚本、切页时是否加载资产归 E2E。
- **推送分档（就地换内容与整页重载）**：外壳指纹（`styles` / `scripts` / `head` 资产 / 主题令牌）不变时推报告块与视图数据，变了推重载指令。
  两格用同一份 fixture 分别只改报告内容与只改主题，断言推送的事件类别与载荷键；缺「只改报告」那一格，「一律整页重载」的错误算法全绿。
- **站点根归一（`index.html` 的 `<base>` 引导脚本）**：脚本对 `location.pathname` 的站点根判定——无尾斜杠的索引路径补出目录形态；已是目录形态（`/`、`/sub/`）不插入 `<base>`；末段带扩展名（`/out/index.html`）按其目录取根。
  断言面是把导出输出里那段脚本原样喂给 fake `location` / `document` 后落下的 `base.href`。
- **timeline / trace 投影的时间树语义**：
  - phase 沿主链累计 `startOffsetMs`，不全为 0；`PhaseTiming.failed` 与 `TimingActivity` 子树原样进节点。
  - 带 `traceId` 的 turn 节点把同 trace 的 spans 收为 children，锚在该轮起点，轮内相对时序保留；关联不上任何 turn 的 span 落在 `eval.run` 层，不丢弃。
  - `eval.run` phase 与 turn 节点带 `open` 展开标记；默认 `AttemptDetails` 只放 timeline 一张 `Waterfall`，trace 数据源仍公开导出。
  - trace 投影按 `parentSpanId` 建树，子 span 是 children 而不是被过滤掉。
    区分力 fixture 要有「父子两个 span」——只保留根的错误实现会丢节点数。
- **Attempt 证据数据源**：`toAttemptSummary` / `toConversationTurns` 等公开转换与内部 `attempt*Data` 零 IO、evidence 装配恰好一次。
   `AttemptDetails` 组合件的展开树构成与二选一规则； attempt page 缺 locator 的完整反馈。
  渲染出的 DOM、默认展开标记、染色与交互归 E2E；改动这些组件后需要 `pnpm run build:report`，改动 view 壳 / dialog 摆放后需要 `pnpm run view:build`。
- **源码调用树的数据语义**：源码证据按 entry 角色确定主干，不按断言命中数猜测。

  - 跨文件 `loc` 在没有 callers 时进入 detached，有 callers 时挂回最内层主干帧。
  - package 与 unavailable 中间段不吞掉更深节点；正文存在但定位行越界同样保留 unavailable；只有没有 `loc` 的条目进入 unmapped。
  - passed / failed / unavailable、挣分 / 显式满分与中止自底向上汇总，unavailable 不计成 failed；send / assertion / score 按统一发生序交错排列。
  - 完整树不受展示预算影响。行选择只在 default、full、file 与 web 的投影函数发生：主干 / 子树上下文半径为 3 / 2，无关段折叠阈值为 8 / 4。
  - full 展开全部调用边但节点内部仍折行；default 超过 400 行时先收深层，同层先 soft 后 gate。
  - web 保留全部路径并只设置默认 open；file 按捕获路径后缀唯一匹配并显示全文。零命中与多命中都是可分辨的用法错误。
  - text、web 与 ShowJson 消费同一个 `AnnotatedSourceResult`，旧的按命中数猜单文件投影不得再出现在公开或内部读取路径。
- **`attemptAssertions` 的计分制字段**：
  - `.points` 挣分随所在 Assertion Claim 一起出现，包括「失败的检查点挣 0 分」。
  - **得分点不参与 passed 收纳**：passed 的得分点逐条进平铺列表、不折进 `passedGroups` 计数（[收纳豁免](../../../feature/assertions/library/display.md#计分制points-与给分条目)）。
  - 得分点挣满计数（`2/5 得分点挣满`）是 data 层字段。
  - `t.score(label, n)` 的 score Claim 与 Assertion Claim 分属两个 Claim kind，按 `groupPath.join(" > ")` 分组。
  - 没有 assertion 但存在给分条目时 `attemptAssertions` 不是 `null`。
  - 通过制 Attempt 的 score Claim Projection 恒为空；`validateAssertionsData` 校验 score Claim Projection 结构，而不是读取 AttemptPayloadV1 字段。
- **计分制的 attempt 详情数据**：`attemptSummary` 的本轮挣分字段只在计分制 attempt 出现；它是详情页总分的唯一出现处。
  标注源码树投影得分点的挣分 / 满分、`t.score` 给分、前置中止的 `⤓`，以及后续源码行的未到达状态。
  `attemptFixPrompt` 把丢分与前置中止都算可操作失败。计分制挣满且未中止才返回 `null`；通过制 passed 恒为 `null`。
  染色、降灰、pill 与右缘 sticky 的呈现归 E2E 报告域。
- **计分制的跨文件源码投影**：跨文件给分进入调用片段或 detached block。
  没有 `loc` 的得分点与给分条目进入 unmapped，并按 `groupPath` 分组；分组算法与 `attemptAssertions` 相同。
- **外壳与页面装载**：规范化输出、`pages` 非空、单页 `defineReport(render)` → id `report`、外壳穷尽 title / theme / dimensionPins / head / pages、输入 `"sample"` / `"attempt"`。
  断言装载结果或错误对象。
- **惰性 page render** （[Architecture · 执行模型](../../../feature/reports/architecture.md#执行模型)）：装载不执行 render；打开一页不执行兄弟页；同一实例 text/web/locale 共用一次 render Promise。
  区分力：多页 + 调用计数。
- **show 终端宿主的文案纯函数**：`show` 的纯函数以返回值为断言面，不依赖终端排版。
  `verdictReasonLine` 把多行 `error.message` 收为首行并移除控制字节；完整 message 只在 attempt 详情块展开。
  `showCommand` / `otherPagesText` 按 `HostCommandContext` 生成可复现的页 / 组索引命令，只列未渲染页并携带完整上下文。
  选择收窄、`--history` 时间轴与用法错误矩阵是进程级读面行为，在真实进程的退出码与 stderr 上验收，归 [E2E 功能域 · 报告与读面](../e2e/report.md)；跨 Run 的显式 materialize、union 与 conflict 语义归[单元测试 Record / Sample](record.md)的 Sample 类别。
- **o11y 数据派生**：
  - `estimateCost` 对未知 Model 返回 `null`。
    缺少 Usage 时不猜零成本。
  - `buildExecutionTree` 合成标准事件流与 OTel span。
    按 callId 精确关联；关联失败时保留占位，不按名字猜。
     `context.injected` 原样进入执行树。
  - `deriveRunFacts` 把只有 called 的调用记为 `pending`。
    配到 result 后使用 result 状态。
    只有 result 时保留占位。
  - 同一 callId 在 result 之后再次 called，表示新的调用。
     Fixture 要跨 Turn 复用 callId，防止实现替换前一次调用。
  - `contextInjections` 只计数 `context.injected`，不与其它事实重复。
- **对照口径（`deltaRows` / `stabilityRows`）**：
  - 多条件按 Eval id 配对，缺席条件显示 `—`，且不计入分母。
  - `flipped` 只表示判定不一致。
    逐行差值使用原始值；任一侧缺失时，差值也缺失。
  - 每个条件的 totals 描述自身命中范围。
     paired delta 只聚合对照组与候选共同拥有的 Eval。
     Fixture 必须让两侧命中范围不同，防止实现直接相减两个 totals。
  - 混合题型按通过制与计分制分段，各自使用独立分母。
    断言面是 `deltaRows`。
  - `--stats` 中 `failed` 与 `errored` 分列，`skipped` 不计。
    无执行组合是缺失，不是三个零。
    断言面是 `stabilityRows`。
  - 切片对范围的接受面（单 locator 只是单元素范围）、`--exp` 的范围校验与每一种参数冲突的完整用法错误，是进程级读面行为，归 [E2E 功能域 · 报告与读面](../e2e/report.md)。

  用户侧全流程见[从终端做跨条件归因](../../../feature/reports/use-case/分析/终端跨条件归因.md)。
  口径单源见 [Measure Views](../../../feature/reports/components/charts/README.md)。

- **usage 组装**：口径单源见 [Attempt Usage](../../../feature/reports/components/attempt-detail/attempt-usage.md#组装口径单源)。
  - turns/toolCalls 来自事件流，token 来自桶互斥的 `Usage`。
  - 只有 `cacheReadTokens` 在场才显示 "uncached in"；`requests` 缺失时省略整段。
  - 含 `—` 的合计列标不完整。断言面是 `attemptUsage`。
- **facts 完整键值表投影**：口径单源见 [Attempt Facts](../../../feature/reports/components/attempt-detail/attempt-facts.md)。
  - `attemptFactsData` 按 attempt 的 facts Observation 的 key 插入顺序投影为 `{ key, value }[]`；facts 缺失或为空对象时返回 `null`，不摆空表。
  - 断言面是 `attemptFactsData` 的返回值，以及 `standardAttemptRender`（内建 `show` 默认页）与公开 `AttemptDetails` 组件两条渲染路径各自的 text 面输出——两条路径分别组装数据，只测一条会漏另一条忘记接线的回归。
   attempt 首页 `usage:` / `facts` 表、`--usage` 表、缺失占位与分节怎样被用户看到，统一由 Report E2E 从公开 CLI 验收，不在 show 单元测试复述文本。
- **execution 的预算、句柄与 grep**：
  - timing、非零命令、Agent 事件与 Attempt error 在落盘前按 `CommandOptions.sensitiveValues` 脱敏。
    summary/full、`--expand`、`--grep` 与 JSON 只能消费 `<redacted>`，不得从其它 artifact 补回。
    旧 artifact 与未登记自由文本不在 renderer 用 key-name regex 猜测。
  - 命令证据只保存 `checked` 调用事实；`exitCode === 0` 由消费层推导为中性的 `succeeded`，非零时 unchecked（`checked: false`）推导为 `observed`、不带失败样式，checked（`checked: true`）才推导为 `failed`。三态各一条区分力场景。
    成功、observed、failed 三类命令都保留原始 exit code 与输出，并在独立 lifecycle 区块按 timing 顺序展示，不进入 `Conversation`。
  - 预览按段截断。
    普通卡正文、TOOL 的 input/result、命令证据的命令行/stdout/stderr 分别计段。
  - 每段最多三行，并有 1 KiB 的 UTF-8 字节回退。
    骨架标签不占正文预算。
  - 卡尾只出现一条截断提示，汇总被折叠的行数和字符数。
  - Agent 卡与命令证据卡的句柄从事件序确定性派生。
    相同 Fixture 两次派生必须同值。
  - `--expand` 恢复完整落盘值；句柄越界时报告实际范围。
  - `--grep` 搜索角色文本、工具名、input、result，以及命令证据的 display/stdout/stderr。
  - 命中卡片仍受预览预算约束。
    完整可见输出由 Report E2E 验收。

  用户怎样从 locator 下钻，见[`@locator` 用例](../../../feature/reports/use-case/调试/按定位符下钻.md)。

- **`--timing` 的两棵树与 sandboxBuild 卡**（[契约](../../../feature/reports/show/timing.md)）：
  - 带 attempt locator 时投影 attempt 的耗时事实生命周期树；不带 locator 时投影 Run 侧时间树。
  - 未知 activity key 渲染 producer 的 `label`，不查 LifecyclePhase 参照点标签表。
  - sandboxBuild 专用卡从 `sandboxBuilds` provenance 读 locator / inputs / 依赖 attempt，经 `timingNodeId` 取耗时，不解读 timing label。
  - fixture 要同时有 Run activity 与 attempt phases，证明两棵树分流、互不冒充。
  - 命令节点的时限归属：因超时失败的节点在 text 面原位标注生效 deadline 值与出处层；`--json` 与 `--timing=full` 对全部命令节点给出该字段。fixture 要有两个不同出处层的超时命令，证明标注取的是各自生效的那层，不是全树共用一个值。

- **`--json` 投影**：
  - envelope 包含 format、schemaVersion、view 与 sample 回显。
  - `view` 判别 `data` 的完整 task Result 类型；消费方收窄 `view` 后不出现 `unknown`。
  - text、JSON 与对应内建 page 消费同一次 task Result 计算出的数据。
    它们必须选择同一批实体，共有字段必须同值。
  - JSON 是 text 的数据超集，不要求字段集合相等。
  - timing 的 JSON 始终保留完整树，不受 text 的节点预算影响。
  - stdout 只写一个 JSON 文档，警告写 stderr。
     `--json` 与 `--report` 互斥。
  - 本类别只证明 envelope 与跨视图不变量。
    逐视图字段由对应数据源类别证明。

- **内建 task Result**：
  - 10 个公开 task 函数返回可序列化普通数据，不含 `ReportNode`。
  - 一个切片的 text / JSON / page 接线使用调用计数或严格同值 fixture 证明只解码一次。
  - `AttemptJson` 用 `runStartedAt`；ShowJson 信封用 `sample`，不保留旧别名。

  设计理由见[show 的切片是组件选择](../../../feature/reports/architecture.md#show-的切片是组件选择)。

- **主题装载与规范化**：
  - `defineTheme` 的校验按规则类别取代表场景，不逐字段枚举：颜色 hex 语法、`ThemeColorPair` 缺分支、`series` 长度不是六、`font` / `fontSize` / `radius` 里出现 `;` 或 `}`、资产路径违规（`..` / 绝对路径 / `~`）各一条。
    报错必须指到具体字段路径（`theme.series[3].dark`）。
  - **四档取值链的区分力**：`--theme` / 报告外壳 `theme` / `config.theme` / 内建 `basalt` 四档要用**互不相同**的令牌值构造，断言生效的是预期那一档；至少一条 fixture 同时配两档以上，证明高档整份取代低档而不是合并。
  - **不跨档合并**：生效主题未声明的令牌取 Basalt 的值，不取下一档同名令牌。
    这一格是唯一能区分「取代」与「合并」两种实现的场景。
  - 规范化输出是数据级断言：完整令牌表（单值展开成相同的 light / dark，pair 保留两支）与有序资产清单，路径相对**主题文件**定位。
    不断言生成的 CSS 文本。
  - `--theme` 不含路径的名称只查内建主题名表、不回落文件探测；未命中的报错列出可用名字。
    与 `--report` 的判别规则同源，只保留一条代表场景。
  - `show --theme` 拒绝：断言错误对象与下一步指引，不断言终端输出。
- **`dimensionPins` 在页级色分配中的作用**：固定的键原样占位、其余键在剩余槽里探测、多个键钉同一下标不触发探测、钉了但本页未出现的键不保留槽位。
  分配结果是**下标**，fixture 必须证明换一份 `series` 色板不改变任何键的下标——这是「主题只管颜色、报告只管含义」在数据层的判据。
  校验错误指到 `dimensionPins.<维度>.<值>`。

  用户怎样换主题与写主题包，见[给报告换主题](../../../feature/reports/use-case/交付报告/主题/)；官方主题取值见 [Basalt](../../../feature/reports/themes/basalt.md)。

## 不这样测

- 不把 Reports 整体当作"展示层"薄测；选择、去重、读数和聚合会静默给错答案。
- 不在本层断言渲染输出——终端排版、DOM 结构与 Run 锁定的是呈现，归 [E2E 功能域 · 报告与读面](../e2e/report.md)对真实输出验收；本层观察数据。
- 不用相同 attempt 数的题目验证两级聚合，因为它与平铺算法可能恰好相等。
- 不在本层断言主题的最终视觉：令牌块文本、级联结果、对比度与色觉可分辨性归 E2E 与主题验收，本层只证明装载选了哪一档、规范化出了什么数据。
- 数值、排序、证据完整度和 refs 直接精确断言，不从渲染字符串反推。
