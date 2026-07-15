# Reports 的测试用例

本页是 Reports 契约的场景登记表。fixture 形状见 [测试架构](README.md)。

## 指标聚合口径

契约来源：[Architecture](../../../feature/reports/architecture.md)、[Library](../../../feature/reports/library.md)。

| 契约 | 场景 |
|---|---|
| 一般指标先在同一 eval 的多个 attempt 内折叠、再跨 eval 折叠（两级默认均 mean），重试次数不改变题目权重 | 正例：区分力 fixture 的 `endToEndPassRate` 得 5/9；反例：区分条件任务通过率 5/6、attempt 平铺 3/5 与"任一轮通过"2/3 三种错误口径 |
| 无限定词的成功率与默认组件使用 `endToEndPassRate`：errored = 0；`taskPassRate` 排除 errored，只能作为带限定名称的诊断指标 | 正例：2 passed + 5 errored 的默认成功率是 2/7，不是 100%；正例：并排展示三个指标可区分任务质量与执行可靠性 |
| `skipped` attempt 对全部内置指标返回 `null`，不进有效样本但保留在 total | 正例：samples < total 且 value 不受影响；反例：skipped 未被算成 0 分 |
| `null` 表示测不了不参与聚合；`0` 正常参与，二者聚合结果必须不同 | 边界：`[null, 0, 1]` 的 mean 是 0.5 而非 1/3 |
| `Scoreboard` 使用固定题集分母：未跑到的题按 0 分计入分母并计入 missing | 正例：题集 4 只跑 2 分母仍 4；反例：与"只统计有样本"口径区分 |
| `Scoreboard` 权重按 eval id 前缀匹配，多前缀命中取最长 | 正例：`security/` 与 `security/auth/` 同时命中取后者；边界：无命中 |
| 跨快照计算先按 attempt 身份键去重，同一 attempt 出现在多快照不重复计数 | 正例：局部补跑重叠快照下 samples 不虚增 |
| 宿主 Selection 为每个 experiment × eval 选择跨历史最新判定 | 正例：先 failed 后 passed 的两快照只用最新判定 |
| 自定义指标 `where` 是进入计算前的过滤；`aggregate: { perEval, across }` 两级分别生效 | 正例：failed attempt 不进聚合；边界：全被 where 排除 → missing；正例：perEval min + across mean 与双 mean 可区分 |
| 报告消费落盘 verdict，不重新判卷 | 反例：断言明细与 verdict 故意矛盾时以 verdict 为准 |

示例——先测 `.data()` 的事实：

```tsx
import { expect, it } from "vitest"
import { RunOverview } from "../../report/index.ts"

it("RunOverview 使用端到端两级聚合并保留覆盖率", async () => {
  const data = await RunOverview.data(selection)

  expect(data.totals.passRate.value).toBeCloseTo(5 / 9)
  expect(data.totals.passRate.display).toBe("55.6%")
  expect(data.totals.passRate.samples).toBe(5)
  expect(data.totals.passRate.total).toBe(6)
})
```

## MetricCell 与缺数据行为

契约来源：[Architecture](../../../feature/reports/architecture.md)、[Library](../../../feature/reports/library.md)。

| 契约 | 场景 |
|---|---|
| MetricCell 携带 value/display/samples/total/refs；缺数据格子 value 为 null 且不渲染成 0 | 三格 fixture：measuredZero、partial、missing 互不混淆 |
| 覆盖率与 refs 不因渲染或 JSON 序列化丢失 | 正例：serialize round-trip 后 refs 完整 |
| 缺 artifact 时指标返回 null，渲染层不猜值；`turns` 缺 `o11y.json` 显示缺失不冒充 0 | 正例：删 o11y.json 后 turns 为 missing；反例：来自 result.json 的指标不受影响 |
| value 与 display 分别可断言；display 由 unit 或自定义 display(value) 驱动 | 正例：value≈5/6 与 display="83.3%" 独立断言 |

## 组件 `.data()` 行为

契约来源：[Library](../../../feature/reports/library.md)、[Show](../../../feature/reports/show.md)。

| 契约 | 场景 |
|---|---|
| `ExperimentComparison.data()` 在计算前按 experiment id 的完整父路径分区，根目录 experiment 各自形成单例组；每组子块与对该组独立调用 `GroupSummary.data` / `MetricScatter.data` / `ExperimentList.data` 完全相同 | 正例：两个多配置目录组 + 一个根目录单例组；逐组 deepEqual 对账并断言 scatter / list refs 不跨组 |
| `ExperimentComparison` 的 web 面接收全部组并输出组选择器与相互隔离的完整 panel，第一组默认展开且无 JS 仍可读；text 面多组时只给索引和单组查看命令，单组时才输出散点与实验列表 | 正例：双组 web 静态 HTML 含两个 panel 且仅首组 open；text 多组无 experiment 明细、单组有明细 |
| `MetricScatter` 对缺 x 或 y 的点不绘制并报告缺失数；零点显示明确空态；单点照常绘制 | 边界：0 点 / 1 点 / 部分缺 x；反例：单点不被拒绝 |
| `MetricLine` 对未声明数值 flag 的 experiment 不伪造 x 值并报告未绘制数 | 正例：flag 缺失与 flag="high" 两种；反例：不落到 x=0 |
| `DeltaTable` 任一侧缺数据时 delta 保持缺失；方向按指标 `better` 判断改善/退化 | 正例：better:"lower" 的 costUSD 下降判改善；边界：一侧缺时 delta 为 null |
| `MetricMatrix` 是稀疏矩阵：无 attempt 的行列组合不生成格子；`MetricBars` 消费同一份矩阵数据 | 正例：缺组合无格子（而非 value:0）；正例：Bars 与 Matrix data 同源 |
| `AttemptList` 的 `redact` 只改写 message/cause/stack、diagnostic、断言 detail 和 evidence；身份字段与 code、lifecycle operation 不被改写 | 正例：全替换函数下身份字段原样；反例：evidence 中的 secret 被替换 |
| 分组维度上未声明的 flag 归 `(unset)` 组，不丢行 | 正例：部分 experiment 无该 flag 时 (unset) 计数正确 |
| `MetricTable` 的 `sort` 决定初始行序，方向由指标 `better` 决定（好在前） | 正例：sort=endToEndPassRate 高在前、sort=costUSD 低在前 |

## text/web 双面同源

契约来源：[Architecture](../../../feature/reports/architecture.md)、[View](../../../feature/reports/view.md)、[Show](../../../feature/reports/show.md)、[Library](../../../feature/reports/library.md)。

| 契约 | 场景 |
|---|---|
| 双面组件的 text 与 web 显示同一份 `.data()` 终值、覆盖率、判定构成和 warning，渲染不重算不丢值 | 正例：partial cell + warning 两面都含 "50%"、"1/2" 和 warning 文本；不要求逐字相同 |
| `validateReportTree` 拒绝缺任一渲染面的组件与任意 HTML intrinsic，报错为完整用户反馈 | 反例：树中放 `<div>` 或单面组件时校验失败，错误文案可 snapshot |
| web 面排序/过滤只改变浏览状态，不改变数据、口径或初始 HTML 中的数值 | 正例：有无 filter prop 时数值与行集合相同 |
| `ExperimentList` web 面是固定八列比较表，默认按 End-to-end pass rate 降序；Model 缺失显示明确空值 | 正例：断言 thead 列名与顺序；边界：model 缺失；反例：taskPassRate 高但 executionReliability 低的实验不能排到端到端成功率更高者之前 |
| `ExperimentList` text 面保持实体层级：Eval 父行、Attempt `├─`/`└─` 子行，不压平 | 正例：一题两 attempt 只出现一次 Eval 标题 |
| `ExperimentList` 传 `relativeTo` 时 web 与 text 两面行标签去掉该父路径前缀只显示 id 末段（与散点点标签同源），完整 id 仍用于排序键 / 着色 / 折叠；默认 `ExperimentComparison` 给每组传组键 | 正例：组键 `compare` 下 `compare/bub-gpt-5.4--agents-md` 显示 `bub-gpt-5.4--agents-md` 且 `data-sort-value` 仍是完整 id；边界：根目录单例组 id 无前缀时显示完整 id；反例：不传 `relativeTo` 时显示完整 id |

```tsx
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { RunOverview } from "../../report/index.ts"
import { createTextContext, renderNodeToText } from "../../report/tree.ts"

it("text 与 web 显示同一个 MetricCell 终值和 warning", () => {
  const data = overviewDataFixture({
    passRate: cells.partial,
    warnings: ["snapshot is incomplete"],
  })

  const html = renderToStaticMarkup(<RunOverview data={data} />)
  const text = renderNodeToText(
    <RunOverview data={data} />,
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

契约来源：[Library](../../../feature/reports/library.md)。

| 契约 | 场景 |
|---|---|
| `Table` 的 null 单元格与 cells 缺键都渲染成 `—`，不补 0 | 正例：两种行；反例：不渲染 "0" 或空串 |
| 列宽按显示宽度计算（CJK 记 2 列）；stringWidth/padEnd/padStart/wrapText 按显示宽度工作 | 正例：含中文 eval id 的表对齐；边界：`stringWidth("中a") === 3` |
| 超宽时先折行最宽的左对齐列，右对齐列永不折行；仍放不下从右侧丢列并如实标注丢列数 | 边界：窄 width 下数字列完整、标注 "hidden N columns"；反例：不静默删列 |
| 任一行带 locator 时表格多出 attempt 列：web 为证据室链接，text 列出 `@<locator>` | 正例：混合有/无 locator 行；边界：全部无 locator 时不出该列 |
| 官方表组件的 text 面建在同一 Table 渲染器上，折行/丢列/对齐行为一致 | 正例：同一窄宽度下标注格式一致 |
| 列可设 `maxLines`（text 面）：数据格折行超出的行丢弃、末行按显示宽度以 `…` 收口；表头不受约束 | 正例：Result 列两行收口带 `…`；反例：未设 maxLines 的列不收口 |
| 实体列表的 Result 单元格是两行收口的预览：主失败摘要先经宽度预算的优先级收口，再由列 `maxLines: 2` 兜底；值自带换行 / 空行不进表 | 正例：数千字符多行 received 的 attempt 行 ≤2 物理行、无空行、`…` 收口且 expected 前缀仍在 |

## show/view 宿主等价与选择

契约来源：[README](../../../feature/reports/README.md)、[Architecture](../../../feature/reports/architecture.md)、[Show](../../../feature/reports/show.md)、[View](../../../feature/reports/view.md)。

| 契约 | 场景 |
|---|---|
| 裸 `show` 与裸 `view` 把同一 Selection 交给同一内置 `ExperimentComparison` definition；`--report` 替换同一报告槽 | 正例：装载边界捕获两宿主的 definition 同引用、selection 深等 |
| 两宿主对 `--run` / `--experiment` / 位置参数用同一套选择规则；局部补跑/过旧/未完成快照形成结构化 warning 随 Selection 携带 | 正例：未完成快照在两宿主产出相同 warning 集 |
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
| 明确指定单个 snapshot.json 时该文件不可读令 view 失败（与扫描模式的跳过相反） | 反例：损坏文件作位置参数报错退出；正例：同文件在扫描模式仅被跳过 |
| 落盘无 phases 时 summary/full timing 都如实输出 unavailable 不猜；有 phases 时主链之和 ≤ total，收尾段 `+N` 不计入 total | 正例：含 teardown 的 fixture；反例：无 phases 的第三方结果；边界：errored 中途时最后主链阶段带 `✗` |

宿主等价在装载边界记录 definition 与 Selection，不比较完整终端输出与完整 HTML——各宿主的导航壳和证据室本就不同：

```ts
it("show 与 view 的默认报告槽消费同一 Selection", async () => {
  const results = resultsFixtureWithPartialRerun()
  const show = await captureShowReportInput(results)
  const view = await captureViewReportInput(results)

  expect(show.definition).toBe(ExperimentComparison)
  expect(view.definition).toBe(ExperimentComparison)
  expect(show.selection).toEqual(view.selection)
})
```

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
- 不只测 React component 能 render；要验证它没有重算或丢失 `.data()` 的终值。
- 不用相同 attempt 数的题目验证两级聚合，因为它与平铺算法可能恰好相等。
- 不用 snapshot 代替 `null`、`0`、samples/total 和 refs 的精确断言。
