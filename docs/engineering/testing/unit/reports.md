# Reports 怎么测

契约来源：[Reports](../../../feature/reports/README.md)、[Architecture](../../../feature/reports/architecture.md)、[Library](../../../feature/reports/library.md)、[Show](../../../feature/reports/show.md)、[View](../../../feature/reports/view.md)、[Observability](../../../observability.md)。

单元层证明 Reports 的**数据语义**：`Source.compute()`、读数聚合口径、resolve 管线、
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
  - `snapshot.scoringComposition` 分别覆盖纯通过制、纯计分制和混合 Sample。
  - `totalScore` 从 `niceeval/report`
    顶层导出，并与内部定义保持同一引用。只需一个代表场景，不为每个内建读数重复测试。

  用户怎样读取计分报告，见[固定题集做考试成绩单](../../../feature/reports/use-case/分析/固定题集成绩单.md)。主读数规则见[题型构成与主读数](../../../feature/reports/library/measures.md#题型构成与主读数)。

- **显示值单点**（[格式化只发生一次](../../../feature/reports/library/presentation.md#格式化只发生一次)）：
  `MeasureCell.display` 一律由 `measureDisplay()` 生成，`value` 与 `display` 各自可断言。逐项覆盖：

  - 五支 unit（`"%"` / `"ms"` / `"$"` / 自定义 unit / 省略）各一条。区分力场景是 `tokens` 单位的
    46500 折成 `46.5k tokens`——只有走 unit 分派才区别于 `String(value)` 的 `46500`。
  - 同一份 fixture 里 experiment 行、Eval 分组行与 attempt 行的同名读数格显示同一种格式；
    分组行与汇总行不另起一条格式化路径。
  - `Measure.display` 覆盖内建格式，且不改变 `value` 与聚合结果。
  - `formatAxisTick` 的精度跟随步长：步长 `0.25` 打 `0.25`，同一个值经 `formatMeasureValue` 走缩写。
- **缺数据词表**（[缺数据、不适用与占位](../../../feature/reports/library/presentation.md#缺数据不适用与占位)）：
  三个内建 code 在 `en` / `zh-CN` 各有文案，`formatCellText` 与 web 面读同一份；未命中词表的 code
  原样显示不被吞掉。区分力场景是 `zh-CN` 报告里的 `missing` 格不出现英文文案。
- **呈现工具箱的导出面**（[公开函数总表](../../../feature/reports/library/presentation.md#公开函数总表)）：
  总表里的函数从 `niceeval/report` 导出，前四组同时从 `niceeval/report/react` 导出且与内部定义同引用；
  色板数组、槽位号与取色 helper 不在任一公开面上。只需一个代表场景，不为每个函数复制一条。
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
  来自 `sample.coverage`、不参与任何读数聚合）；`experimentRows` 的
  [Eval 分组层](../../../feature/reports/components/sources/entity-experiments.md#eval-分组层)——按 evalId
  路径段递归分区，每一层兄弟各自判定两条收起条件（只有一个组、每组只有一道题），收起时该层
  消失且标签相对最近仍在的祖先（整链收起则退回完整 evalId），不含 `/`
  的题与组行同级且不进假组，组行读数是子孙聚合而占位行不进分母（fixture 让某组全部题缺失，
  证明组行读数格是 `missing` 而非 `notApplicable`），子行标签去掉父组前缀但 `evalId`
  仍是排序/过滤/展开身份；`currentSample()`
  下一个 experiment 展示用的水位基准 Run 选择——fixture 让同一 experiment 有多个真实贡献 Run、`startedAt`
  各不相同时，配置/agent/model 相关字段（config 列、Hero、`sampleSummary` 标题等）只读取贡献来源中
  `startedAt`
  最新的那一个，不是任取或合并多个来源；实体行的计分制字段——`ExperimentRow.scoring`
  是定义期事实投影（不从 attempt 结果推断），experiment / eval / attempt 三级的 `totalScore`
  cell 在计分制下按读数口径求值（experiment 级 acrossEvals sum、eval 级 perEval
  mean）、通过制下为 null cell 且与 `passRate` 并存不互斥。
- **站点组件与内建报告**：`standard` 的构成与具名导出同引用、`failures` / `stability`
  的构成与具名导出同引用（各一张导航页，且 pages 里的详情页与 `standardAttemptPage`
  同引用）、三张 scope-input page 均相邻放置
  `sampleWarnings` 与 `runDiagnostics`、`defineReport`
  复用别处页的数组展开（页等值、外壳不沿用）、组合组件与手写组合严格等价；
  数据派生覆盖 hero、warning 分组聚合与组排序，以及
  `runDiagnostics` 对 Sample / 裸 Run[] 的同值投影、空诊断过滤、experiment →
  startedAt 排序、来源不合并、开放 code 原样保留、React
  Content 不携带 Run/AttemptHandle。渐进增强不改数据；内建首页三行装配的构成
  （`SampleSummary` + frontier 散点 + 实验表）以页声明与展开树为断言面。
- **`sources.measure.frontier` 与缺省绑定**：产出与取用两侧各有区分力 fixture。
  - 产出侧三态：纯通过制与 mixed 的 `defaults.y` 引用 `passRate`，纯计分制引用 `totalScore`。
    mixed 只聚合通过制题，区分力是计分制题的成本不进散点分母。
  - 产出侧 series：范围内声明过 `line` 标签时 series 维度是 `label("line")` 且
    `connect: true`，否则是 `"agent"` 且不连线。维度字段沿用本名，页级配色身份与实验表同键。
  - 取用侧：`Chart` 省略 x / y / children 时按 `defaults` 展开，显式 props 逐槽位覆盖。
    给出任何子节点则整组缺省 series 作废。props 与 `defaults` 双缺时完整用户反馈报错。
  - 序列化与边界：`defaults` 经序列化往返保留。同一 Dataset 交给 `Table` 不受影响。
    `rows(...)` 恒不携带 `defaults`。
- **`StabilityOverview` 的投影**：散点与堆叠柱的 Dataset 从 `StabilityContent` 字面投影。
  点身份是 `eval · condition`；零执行格的 `passRatio` 为 `null` 不为 0；堆叠三段与 `totals`
  同值；格 `refs` 原样进两个 measure cell 的 `refs`（`refs.length` 等于该格执行数）。
  读数格的零通过与闪烁计数各一条区分力 fixture（全过与全挂都不算闪烁）。断言面是展开树与
  Content，不经浏览器。
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
- **主题钉色**（[钉色](../../../feature/reports/library/shell.md#钉色)）：报告外壳
  `dimensionPins` 的键原样占位、自动分配只在剩余槽里探测、多个值钉同一下标不触发探测、钉了但页内未出现的键不占槽；非法维度 name / 值键 /
  下标按完整用户反馈拒绝并指到 `dimensionPins.<维度>.<值>`。区分力场景是「同一份数据加钉与不加钉，未钉键的落槽不同」。
- **Chart 呈现覆盖**：`Chart.series` 只能覆盖已有 series key 的线型、点形、标签与可见性，
  不能改变 mark、绑定或聚合；未知 key 给出完整用户反馈。
- **`Markdown` 的解析与两面投影**（[排版原语 · Markdown](../../../feature/reports/library/layout.md#markdown)）：断言面是解析出的 AST 与两面输出字符串，不经浏览器。覆盖：每类块与行内节点在 text 面的投影（标题空行、列表前缀与缩进、代码块不折行、块引用 `>` 前缀、链接 `文字 (url)`、图片 `alt (url)`、无 ANSI 时脱去强调标记）；裸 HTML 块与行内 HTML 一律转义成可见文本，不进 web 输出；表格语法按完整用户反馈报错并指引 `Table`；折行与宽度量测走 `stringWidth` / `wrapText` 同一张表（中文正文不撕歪）；`LocalizedText` 正文按回退链选语言，缺语言不报错也不留空。
- **`Table` 的 subRows 与 placeholder**（[Table](../../../feature/reports/components/primitives/table.md)）：
  `subRows` 在 text / web 两面逐层渲染；`variant: "placeholder"` 行照常显示但不进入任何列的聚合读数。
  两面各一份区分力场景——断言面是 Content 与两面输出字符串，不经浏览器。
- **`Grid` 的换列规则与体裁**（[换列规则](../../../feature/reports/library/layout.md#换列规则)、
  [体裁与体量](../../../feature/reports/library/layout.md#体裁与体量)）：
  断言面是列数纯函数的产出、text 面输出字符串与 web 面的 HTML，不经浏览器。逐项覆盖：

  - 摊匀这一步：给定格数与容量列数产出实际列数，区分力场景是「6 格、容量 5 列排成 3 + 3」——
    只有摊匀会让结果区别于容量列数本身；7 格、容量 5 列排成 4 + 3 覆盖不整除。
  - 摊匀后的列数从不超过容量列数，因此从不把格子挤到最小格宽以下。
  - 最后一行只剩一格时那一格铺满整行；短于一行但不止一格时按上面各行的格宽左对齐，不拉伸。
  - text 面从格数向一列尝试，每格达不到最小可读内容宽度就降列，一列是无条件 fallback。
  - web 面的 `data-cells` 与随身 `@container` 规则只由格数决定：同格数的两个 Grid 规则文本
    逐字相同，各断点等于该列数下的最小格宽与格线合计，每条断点同时声明列数与 `--grid-columns`
    ——体量插值靠后者，规则里不出现留白或字号的具体值。
  - text 面画的是一张格线：列间 `│`、行间 `─`、交点 `┼`，格线之外不画外框；末行短于一行时，
    它上面那条行间线在缺格的位置收成 `┴`。
- **Callouts / Waterfall / SourceView / Conversation / DiffView / CopyBlock 的两面投影与维度封闭性**：
  每个原语各一条类别。断言面是 Content 与 text / web 两面输出字符串，不经浏览器；覆盖两面投影正确，
  以及 renderer 查询未声明维度时抛 `UndeclaredDimensionValueError`（与
  「`dimensions` 必填与查询封闭性」同一判据，落在各原语 fixture 上）。
- **`DiffView` 摘要行的增删着色**（[契约](../../../feature/reports/components/primitives/diff-view.md#渲染)）：
  web 面 `+N` 与 `-M` 各自成元素并各带自己的类，才染得上与 patch 增删行同一套颜色；
  text 面不受影响，仍是 `(+N/-M)` 一段纯文本。
- **`Waterfall` 的清单收敛与区块头**（[契约](../../../feature/reports/components/primitives/waterfall.md)）：
  web 面输出字符串为断言面。逐项覆盖：

  - 时长占比低于 1% 的连续短节点折成摘要，带 `kind` 计数与合计时长，留在原时间位置。
  - 摘要只收得到一条节点时不折，那个节点直接列出。
  - `failed` 与 `durationMs` 为 `null` 的节点不折；行总时长为 `null` 时整行不折。
  - 被折节点的 `children` 展开后原样还原。
  - text 面不列节点，行上的节点计数仍计全部节点。
  - 区分力场景是「把一个短节点抬到行总时长 1% 以上」——只有这一格改变清单构成，
    证明判据是占比而不是绝对时长或节点序数。
  - `title` 在两面渲染为区块头；Content 为 `null` 或空时整块不出现，标题也不出现。
  - 行头 `label` 与 `locator` 同文时只渲染 locator 一次，不同文时两者都在。
  - 带 `open` 的节点默认展开（`<details open>`）且不参与折叠。
- **`Waterfall` 的重复折叠**（[契约](../../../feature/reports/components/primitives/waterfall.md#重复节点折成一条)）：
  web 面输出字符串为断言面。逐项覆盖：

  - 连续、同 `kind`、`label` 同文的三个及以上显著节点折成一条带计数与合计时长的摘要，
    展开后逐条还原；被同名节点夹住的异名节点切断连续段。
  - 区分力场景是「同一批节点从三个减到两个」——两个时逐条列出，三个时才出摘要，
    证明判据是连续计数而不是「出现过重复就折」。
  - 带 `failed` 或 `open` 的节点不参与重复折叠，即使与相邻节点同名。
  - 短节点摘要与重复摘要各自成行，不合并成一条。
- **`Waterfall` 的分解条取叶子**
  （[契约](../../../feature/reports/components/primitives/waterfall.md#分解条画哪些节点)）：
  web 面输出字符串为断言面。逐项覆盖：

  - 条上的段数等于树里的叶子数，递归取；带 `children` 的父节点不出段。
  - 区分力场景是「把一个叶子挂上一个子节点」——段数不变而位置换成子节点的，
    证明取的是叶子而不是顶层或全部节点。
  - `durationMs` 为 `null` 的叶子不出段；全部叶子都缺时长时整条不画，清单照常列。
  - 失败叶子的段带 negative 类，与它落的分类色槽无关。
- **`Waterfall` 的类别着色不认词表**（[契约](../../../feature/reports/components/primitives/waterfall.md#类别与着色)）：
  web 面输出字符串为断言面。逐项覆盖：

  - 同一个 `kind` 字面在同一份报告里恒落同一个分类色槽，槽号只由字面决定，与节点顺序、
    所在行、所在层级无关。
  - 区分力场景是「把 `model` 换成一个从没出现过的词」——它照样落到五槽之一，
    证明色槽是散列出来的而不是查表查出来的。
  - 清单里的类别列不带任何着色类，条上的段才带。
- **页级呈现分配**（[分配单位是页](../../../feature/reports/components/README.md#维度呈现分配单位是页)）：
  给定一页 `dimensions()` 声明的集合产出映射，断言面是映射本身，不断言渲染出的颜色值。逐项覆盖：

  - 两个 keyset 分开——label keyset 收全部编码的值，visual keyset 只收 `color` / `series` 的值。
  - 区分力场景是「同页一张 27 值的 label-only 表加一张 3 值的图」：三个值仍落 1–3 槽，
    而它们的标签按 27 值的 keyset 算最短唯一后缀。
  - 同一键在同页多个组件得到同一个槽；撞槽按显示键字典序线性探测；缩短后的显示名不参与取键。
  - 24 槽序列的 `(色, variant)` 两两不同。
  - visual keyset 超过 24 按完整用户反馈拒绝该页，且 fix 行不提 `dimensionPins`。

- **`dimensions` 必填与查询封闭性**：缺 `dimensions` 的组件定义按完整用户反馈拒绝，
  `dimensions: () => ({})` 合法。renderer 查询未声明的句柄、越界下标或与声明编码不符的用法，
  抛 `UndeclaredDimensionValueError`，不临时分配。
  **每个自定义组件 fixture 必须同时执行 text 与 web 两个 renderer**，并各自断言未声明查询会失败。
  只跑 text 面抓不到 web renderer 用了未声明的值——text 面不消费颜色，可能根本不发起查询。

- **text 面的呈现降级**：text renderer 的 `ctx.dimension()` 恒返回 label 面，拿不到颜色、
  `strokeDasharray` 或 pattern。容量拒绝只发生在 web 编码规划，
  同一份超容量报告的 text 面照常输出。

- **公开呈现 helper**：`shortestUniqueLabels` 与 `presentDimension` 从 `niceeval/report` 顶层导出，
  并与内部定义同一引用。`presentDimension(declaration)` 与报告树内 `ctx.dimension(handle)`
  对同一份声明返回相同槽位。

- **定义入口**：`defineSource` / `defineComponent` / `defineComposition` 保留传入对象引用与泛型形状，
  不建立注册表或跨 page 缓存；缺 name / compute / renderer 的输入给出完整用户反馈。运行期 Content
  可序列化、row key 与 column key 的校验仍走 resolve / validate，不在定义期重复一份规则。

- **外部数据快照与确定性**（[外部数据走冻结快照](../../../feature/reports/architecture.md#外部数据走冻结快照)）：
  `ctx.data` 来自 `--data <file>` 或 `config.reportData`，取值链与报告装载链同形，装载失败同级。
  区分力场景是**同一份输入跑两次产出逐字节相同**——快照进了输入，所以恒等成立。
  展开回调读时钟、随机数或文件系统时按完整用户反馈拒绝；缺省 `ctx.data` 是空对象而不是
  `undefined`。

- **Composition 的展开与缓存**：`expand` 同步与 `async` 两种返回都在 resolve 阶段被 await。
  逐项覆盖：

  - `ctx.resolve(source)` 与同页 `<Table source={source}>` 命中同一份缓存只计算一次。
    区分力场景是一个计数 fake Source 被 Composition 与原语同时引用，计数必须是 1。
  - `ctx.resolve(source, input)` 与同页 `<Table source={source} input={input}>` 命中同一份缓存。
    省略 input 时与 `ctx.resolve(source)`、组件省略 `input` 共用 page 默认 input 的缓存键。
  - 缓存的是 Promise：两个并发消费者同时请求仍只计算一次，失败由同一个 Promise 广播给两者。
  - 同一个 Composition 用在两处是两个节点、各展开一次，内部的 `ctx.resolve` 仍共享 Source 缓存。
  - Composition 的 `Input` 与 page 的 `input` 声明不匹配时，装载期按完整用户反馈报错。
- **ResolvedPage 单次 resolve 多面投影**：`resolvePage` 一次产出可序列化组件树。之后
  `renderResolvedPageText` / `renderResolvedPageWeb(en)` / `renderResolvedPageWeb(zh-CN)` 都从同一
  `ResolvedPage` 同步投影。断言面是 Source `compute` 调用计数仍为 1（含并发渲染）。
  view 对每个 page / locator 只调用一次 `resolvePage`。
- **Component 公共协议收紧**：`defineComponent` 只接受 `{ dimensions, text, web, enhance?, styles? }`；
  携带 `resolve` 或函数形态定义时按完整用户反馈拒绝。renderer 参数是 Content、options 与呈现
  context，无法触达 Source input。缺 `dimensions` / `text` / `web` 时失败。
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
  `.ts`/`.tsx`/`.js`/`.mjs` 后缀的按文件装载，其余裸词查内建视图名表，三个名字
  （`standard` / `failures` / `stability`）各命中且与对应具名导出同引用（`standard`
  兼默认导出）；裸词未命中时报错列出全部可用名字并给出路径写法，不做文件系统探测（fixture 里存在同名
  `./site.tsx` 时 `--report site` 仍报错，证明判别只看字符串）；`config.report`
  不是 `defineReport` 产物时的完整用户反馈，出处点名配置文件的 `report` 字段（与文件默认导出非法的反馈只差出处）；fresh import 让装载入口及其项目内 import 子图失效——`--report
  <文件>` 改报告文件或它 import 的组件后下一次装载读到新内容，`config.report` 的入口是配置文件（每次 scan 重装），断言面是渲染产物里的标记字符串，不测进程重启行为。
- **view 数据装载（ViewScan）**：`loadViewScan` 的数据层语义以返回结构、Map/Set
  内容与错误对象为断言面——unreadable 的三种原因如实进 `viewData`（producer 感知的升级提示）；
  报告槽 Sample 是现刻水位口径（与 show 同一 `currentSample`，`composedRuns` 反映跨快照合成）；
  跨快照按 attempt 身份键去重，`--resume` 复印件不给证据室索引灌票；新布局落盘直接可读
  （写入面 / 读取面同一契约）；零可读结果直说不渲染空页面；`viewData`
  只含证据室元信息不携带统计产物；`loadLatestResultsPerEval`
  的续跑携带口径；报告文件或其项目内依赖变更后下一次装载读取新内容（namespaced
  import，不复用陈旧模块缓存），经 `config: { cwd }`
  装载时改配置所 import 的报告文件同样读到新内容。`resolveViewInput`
  的输入校验、收窄对证据室与导出的作用面、外壳导航与标题在真实站点上的呈现，归
  [E2E 功能域 · 报告与读面](../e2e/report.md)。
- **持续重建（view 本地模式）**：watch 输入闭集的判定——有效根内的记录变更、报告文件与它的项目内
  import 图（含自定义组件文件）、主题文件、`niceeval.config.ts` 触发重建；有效根之外的记录与依赖目录
  里的包不触发。重建是整条管线重跑，同一页同一语言的报告块与 `--out` 逐字节一致（这一格是「增量拼接」
  错误算法唯一会红的地方，fixture 要让新落盘的 attempt 改变覆盖分母）。连续事件去抖后合成一次，重建期间
  到达的事件在本次结束后再建一次、不堆积。装载失败时保留上一份可用产物并推出结构化错误，`--out`
  下同样的错误按非零退出。断言面是重建调度器的调用序列与产出结构，不是浏览器行为。
- **重建理由的闭集性（无旁路）**：闭集之外的事件不重跑管线。请求 `/` 不构成重建理由——盘上没变时
  连续两次请求命中同一份产物，管线只跑过启动那一次。区分力靠计数：只断言响应体相同的写法在
  「每次请求都重建」下照样全绿，必须数 `planSite` 的调用次数。
- **失效分流（记录变更不重装模块图）**：记录变更沿用上一次装载出的报告 / 主题定义，模块文件变更才重新
  装载。区分力在**定义对象身份**上，不在产物字节上：改记录后重建，报告定义是同一个对象；改报告文件后
  重建，是新对象。两格都断言产物跟着变——只测身份不测产物，「永不重装」的错误算法会漏过去。
- **按订阅渲染（只渲染看得见的那一块）**：本地模式一次重建只渲染订阅声明的 `(pageId, locale)`；其余页
  与语言经 `report/<pageId>.<locale>.html` 按需渲染，`--out` 全渲并预烘进 `index.html`。fixture 用
  多页报告（至少两页 × 两语言），断言面是每页渲染函数的调用次数——单页 fixture 分不开「渲染一块」与
  「渲染全部」。同一 `(pageId, locale)` 在按需路径与 `--out` 下逐字节一致，这一格接住渲染时机漂移。
- **推送分档（就地换内容与整页重载）**：外壳指纹（`styles` / `scripts` / `head` 资产 / 主题令牌）不变时
  推报告块与视图数据，变了推重载指令。两格用同一份 fixture 分别只改报告内容与只改主题，断言推送的
  事件类别与载荷键；缺「只改报告」那一格，「一律整页重载」的错误算法全绿。
- **站点根归一（`index.html` 的 `<base>` 引导脚本）**：脚本对 `location.pathname` 的站点根判定——无尾斜杠的索引路径（cleanUrls 托管）补出目录形态、已是目录形态（`/`、`/sub/`）不插入 `<base>`、末段带扩展名（`/out/index.html`）按其目录取根。断言面是把导出产物里那段脚本原样喂给 fake `location` /
  `document` 后落下的 `base.href`，不是整页 HTML；无尾斜杠那一格是唯一能把「按文档目录解析」与「按站点根解析」区分开的输入，缺了它相对引用少一层的错误算法照样全绿。
- **timeline / trace 投影的时间树语义**：
  - phase 沿主链累计 `startOffsetMs`，不全为 0；`PhaseTiming.failed` 与 `TimingNode`
    子树原样进节点。
  - 带 `traceId` 的 turn 节点把同 trace 的 spans 收为 children，锚在该轮起点，
    轮内相对时序保留；关联不上任何 turn 的 span 落在 `eval.run` 层，不丢弃。
  - `eval.run` phase 与 turn 节点带 `open` 展开标记；默认 `AttemptDetail` 只放
    timeline 一张 `Waterfall`，trace 数据源仍公开导出。
  - trace 投影按 `parentSpanId` 建树，子 span 是 children 而不是被过滤掉。
    区分力 fixture 要有「父子两个 span」——只保留根的错误实现会丢节点数。
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
- **外壳与页面装载**：两种声明形态归一到同一规范化产物、`content`/`pages`
  恰好其一、标题取值链、资产路径纪律与 head 白名单/转义/scheme 分流、page id 与 attempt-input
  page 的校验规则。全部以装载结果或错误对象为断言面。
- **show 终端宿主的文案纯函数**：`show`
  专属的纯函数以返回值为断言面，不依赖终端排版——紧凑索引行的判定原因（`verdictReasonLine`）对多行
  `error.message` 折首行并剥控制字节收口，完整多行 message 归 attempt 详情块展开；`showCommand` /
  `otherPagesText` 按 `HostCommandContext`
  拼出可复现的页/组索引命令，只列未渲染的页且携带完整上下文。选择收窄、`--history`
  时间轴与用法错误矩阵是进程级读面行为，在真实进程的退出码与 stderr 上验收，归
  [E2E 功能域 · 报告与读面](../e2e/report.md)；跨 Run 的当前 Sample
  选择与去重语义归[单元测试 Record / Sample](record.md)的 `currentSample()` 类别。
- **o11y 数据派生**：
  - `estimateCost` 对未知 Model 返回 `null`。缺少 Usage 时不猜零成本。
  - `buildExecutionTree` 合成标准事件流与 OTel
    span。按 callId 精确关联；关联失败时保留占位，不按名字猜。`context.injected` 原样进入执行树。
  - `deriveRunFacts` 把只有 called 的调用记为
    `pending`。配到 result 后使用 result 状态。只有 result 时保留占位。
  - 同一 callId 在 result 之后再次 called，表示新的调用。Fixture 要跨 Turn 复用 callId，防止实现覆盖前一次调用。
  - `contextInjections` 只计数 `context.injected`，不与其它事实重复。
- **对照口径（`deltaRows` / `stabilityRows`）**：
  - 多条件按 Eval id 配对，缺席条件显示 `—`，且不计入分母。
  - `flipped` 只表示判定不一致。逐行差值使用原始值；任一侧缺失时，差值也缺失。
  - 每个条件的 totals 描述自身覆盖面。paired
    delta 只聚合基线与候选共同拥有的 Eval。Fixture 必须让两侧覆盖不同，防止实现直接相减两个 totals。
  - 混合题型按通过制与计分制分段，各自使用独立分母。断言面是 `deltaRows`。
  - `--stats` 中 `failed` 与 `errored` 分列，`skipped` 不计。无执行组合是缺失，不是三个零。断言面是
    `stabilityRows`。
  - 切片对范围的接受面（单 locator 只是单元素范围）、`--exp`
    的范围校验与每一种参数冲突的完整用法错误，是进程级读面行为，归
    [E2E 功能域 · 报告与读面](../e2e/report.md)。

  用户侧全流程见[从终端做跨条件归因](../../../feature/reports/use-case/分析/终端跨条件归因.md)。口径单源见
  [Measure Views](../../../feature/reports/components/charts/README.md)。

- **usage 组装与 facts 投影**:usage 行/表的组装口径单源见
  [Library · Attempt 详情 · `attemptUsage` 组装口径（单源）](../../../feature/reports/components/attempt-detail/attempt-usage.md#组装口径单源)——行为计数(turns/toolCalls)来自事件流、token 来自
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
  - `defineTheme` 的校验按规则类别取代表场景，不逐字段枚举：颜色 hex 语法、`ThemeColorPair` 缺分支、`series` 长度不是六、`font` / `fontSize` / `radius` 里出现 `;` 或 `}`、资产路径违规（`..` / 绝对路径 / `~`）各一条。报错必须指到具体字段路径（`theme.series[3].dark`）。
  - **四档取值链的区分力**：`--theme` / 报告外壳 `theme` / `config.theme` / 内建 `basalt` 四档要用**互不相同**的令牌值构造，断言生效的是预期那一档；至少一条 fixture 同时配两档以上，证明高档整份取代低档而不是合并。
  - **不跨档合并**：生效主题未声明的令牌取 Basalt 的值，不取下一档同名令牌。这一格是唯一能区分「取代」与「合并」两种实现的场景。
  - 规范化产物是数据级断言：完整令牌表（单值展开成相同的 light / dark，pair 保留两支）与有序资产清单，路径相对**主题文件**解析。不断言生成的 CSS 文本。
  - `--theme` 裸词只查内建主题名表、不回落文件探测；未命中的报错列出可用名字。与 `--report` 的判别规则同源，只保留一条代表场景。
  - `show --theme` 拒绝：断言错误对象与下一步指引，不断言终端输出。
- **`dimensionPins` 在页级色分配中的作用**：钉住的键原样占位、其余键在剩余槽里探测、多个键钉同一下标不触发探测、钉了但本页未出现的键不保留槽位。分配结果是**下标**，fixture 必须证明换一份 `series` 色板不改变任何键的下标——这是「主题只管颜色、报告只管含义」在数据层的判据。校验错误指到 `dimensionPins.<维度>.<值>`。

  用户怎样换主题与写主题包，见[给报告换主题](../../../feature/reports/use-case/交付报告/主题/)；官方主题取值见 [Basalt](../../../feature/reports/themes/basalt.md)。

## 不这样测

- 不把 Reports 整体当作"展示层"薄测；选择、去重、读数和聚合会静默给错答案。
- 不在本层断言渲染产物——终端排版、DOM 结构与 Run 锁定的是呈现，归
  [E2E 功能域 · 报告与读面](../e2e/report.md)对真实产物验收；本层观察数据。
- 不用相同 attempt 数的题目验证两级聚合，因为它与平铺算法可能恰好相等。
- 不在本层断言主题的最终视觉：令牌块文本、级联结果、对比度与色觉可分辨性归 E2E 与主题验收，本层只证明装载选了哪一档、规范化出了什么数据。
- 数值、排序、覆盖率和 refs 直接精确断言，不从渲染字符串反推。
