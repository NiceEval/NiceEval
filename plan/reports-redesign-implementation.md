# PLAN:Reports 三层重设计的实现落地

设计已定稿并全部落进 `docs/feature/reports/`（2026-07-16,设计裁决台账见 `memory/reports-component-page-report-redesign.md`）。本 PLAN 给实现 Agent:按 docs 声明改 `src/`,测试只实现 `docs/engineering/unit-tests/reports/cases.md` 已登记的行。

## 契约变更总览(实现对照清单)

1. **`Selection` 改名 `Scope`**(全仓类型与导出):`results.latest()` / `results.current()` 返回 `Scope`;`ScopeWarning`;`ReportInput = Scope | readonly Snapshot[]`。类型的家在 `src/types.ts` / results 模块。这是破坏性改名,不留别名。
2. **`defineComponent` 双形态**(`src/report/`):
   - 函数形态 `(props, ctx) => ReportNode | Promise<ReportNode>` → 组合组件;`ctx: ComposeContext = { scope, results, report }`(`report: ReportMeta` 形状见 `docs/feature/reports/library/layout.md`)。
   - 对象形态 `{ resolve?, text, web }` → 双面组件;`resolve(props, ResolveContext { input })` 把 props 规范化成渲染 props;缺 `text`/`web` 定义时报错。
3. **官方数据组件 props 双形态**(`data` 判别):spec 形态 = Options 平铺 + 可选 `input`(默认宿主 Scope);`data` 与 spec 字段同时出现报完整用户反馈。`DataProps<Data, Options, Presentation>` 联合见 `docs/feature/reports/library/metric-views.md`。
4. **resolve 管线**(`src/report/tree.ts` 的 `resolveReportTree` 扩展):`装载 → resolve(展开组合组件 + spec 取数,同层并行、保持声明顺序、按「同引用 input + 深相等 spec」记忆化)→ validate → render`。非法节点(React 组件、未包装函数、intrinsic)在展开遇到时拒绝且不取数。
5. **`defineReport` 单一产物**:`defineReport(树)` / `defineReport({外壳, content | pages})`;`ReportPage = { id, title, content: ReportNode }`;`ReportBodyDefinition` / `ReportSiteDefinition` / `ReportBuild` / `ReportContext` 类型删除;`ReportDefinition { kind: "report" }` 不在 `ReportNode` 内。报错文案:content/pages 同缺或同给时下一步是 `content: <ExperimentComparison />`。
6. **内建报告**(`src/report/built-ins/`):`niceeval/report/built-in` 入口改为一行 `export default defineReport(<ExperimentComparison />)`;`comparisonReport` 具名导出删除。`ExperimentComparison` 获得 spec 形态(input 可选)。
7. **`ctx.report`(ReportMeta)**:规范化声明只读注入组合组件——回退链后的 `title`、`links`(默认 `[]`)、`footer`、`pages: [{id,title}]`、当前 `page` id;`scripts`/`styles` 不进。
8. **组件 `.data` 静态属性形态废除**:计算函数只以具名 `*Data` 导出(`metricTableData` 等);`niceeval/report/react` 仍只导出 data 形态纯组件。
9. **`view --out` 无档位**(`src/view/`):根里存在且前端会读取的证据文件全部复制——`diff.json` 有就带(旧行为「一律不复制 diff」废除),`o11y.json` 永不复制;发布防呆(redaction 标记 / `--allow-sensitive-artifacts`)行为不变,报错文案措辞从「数据等级」改「发布防呆」、「消毒」改「脱敏」(错误信息与注释同步,API 名 `redact`/`publish.redaction` 不动)。`--out` 与位置参数 / `--experiment` 互斥,报错下一步是 `copySnapshots` + `filter` 换根。见 `docs/feature/reports/view.md#静态导出`。

## 2026-07-16 外部评审修订（第二轮，docs 已全部改完）

外部设计评审后的契约修订已落进 `docs/feature/reports/`、`docs/feature/results/library.md` 与两份 cases.md（裁决台账见 `memory/reports-external-review-rulings.md`）。实现时在上面清单之外**再对照这批**：

10. **`current()` 可比性前提**（results 选择层）：每个 experiment 以最新快照的可比性配置（agent、model、reasoningEffort、flags、budget、timeoutMs、sandbox）为基准，配置不一致的旧快照不贡献 attempt，缺口走 partial-coverage；编排字段（runs、earlyExit、maxConcurrency、selectedEvalIds、evalFilterFingerprint、description）不参与比较。见 `docs/feature/results/library.md#官方现刻水位resultscurrent`。
11. **改名清单**（破坏性，不留别名）：`RunOverview`→`ScopeOverview`（`runOverviewData`→`scopeOverviewData`、`RunOverviewData`→`ScopeOverviewData`）；`GroupSummary`→`ScopeSummary`（同规律）；`RunOverviewData.verdicts`→`attemptVerdicts`、`ScopeSummaryData.verdicts`→`evalVerdicts`、`ExperimentListItem.verdicts`→`evalVerdicts`；实体列表 `score`→`examScore`、`cost`→`costUSD`、`duration`→`durationMs`；`config()`→`runConfig()`、`numericConfig()`→`numericRunConfig()`、`DimensionRef.kind: "config"`→`"runConfig"`、键收 `RunConfigKey` union；CLI flag `--eval`→`--source`（AttemptEvidence 能力位 `eval`→`source` 同步）。
12. **`AttemptListItem` 瘦身**：删 `assertions` / `error` / `diagnostics`，改携带 `failureSummary: string | null`（Scoring display 契约算好）与 `moreFailures: number`；`redact` 只作用于 `failureSummary`。
13. **`ReportNode` 穷尽定义**：元素 | 数组/Fragment | null/undefined/boolean；裸字符串与数字树校验拒绝并指引包 `Text`。见 `docs/feature/reports/library/layout.md#树的节点reportnode`。
14. **data 结构校验**：组件消费 `data` 时校验形状，不符按完整用户反馈报错并提示版本漂移。
15. **`DeltaData.rows` 补 `label`**（pair label 原样透传）。
16. **Scoreboard 缺失拆分**：`missing`→`notRun` + `unscorable`，计分口径不变（都按 0）。
17. **`MetricLine` 点身份**：点 = `(series, x)`，聚合顺序 `(series, x, experiment, eval)`；自定义 `NumericAxis.of` 在同一 experiment × eval 内不恒定时报错；`LineData.rows[].key` 是 x 的稳定十进制串。
18. **`experimentListData` 配置单义**：同一 experiment 的输入混不一致可比性配置时按完整用户反馈失败。
19. **静态导出源码自包含**：`artifact/<snapshot-path>/sources/<sha256>.json` 正文随站复制，携带条目归拢进本快照 `sources/`。见 `docs/feature/reports/view.md#静态导出`。
20. **记忆化比较规则**：深相等中函数与 Metric / Dimension / NumericAxis 实例按引用比较。
21. **`ReportLocale = string`**（开放）：官方内置文案与 `MetricCell.display` 生成面当前覆盖 en / zh-CN，其它 locale 走 LocalizedText 回退。
22. **标题回退单点**：view 与 shell 统一为「def.title → Scope 中唯一且相同（深相等）的快照 name → NiceEval」。
23. **默认报告散点方向文案**：成本 × 成功率下是「越靠左上越好」。

明确否决（不要实现）：`ExperimentComparison` 不加 `groupBy`（路径即分组 API，自定义分组走组合组件）；`*Data` 不加 `locales` 选项；`redact` / `Col` / `relativeTo` / `DeltaTable.by` 不改名；`Powered by niceeval` 行、证据页归宿主、`TableRow.locator` 维持原契约。`Reporter` 改名（`RunObserver`）不在本轮范围，未裁决。

## 2026-07-16 第四轮评审修订（docs 已全部改完）

第四轮全量 docs 评审的契约修订已落进 `docs/feature/reports/`、`docs/concepts.md`、`docs/feature/results/library.md`、`docs/feature/sandbox/cli.md` 与两份 cases.md（裁决台账见 `memory/reports-fourth-review-rulings.md`）。实现时再对照这批：

24. **`ScopeOverview` 并入 `ScopeSummary`**（对第 11 条改名清单的再翻案）：单一组件 `ScopeSummary` / `scopeSummaryData` / `ScopeSummaryData`；data 恒携带 `range: { earliestStartedAt, latestStartedAt }`、`attemptVerdicts` 与 `evalVerdicts` 两份计票（`lastRunAt` 字段删除，由 `range.latestStartedAt` 承担）；呈现 prop `votes?: "eval" | "attempt"`（默认 `"eval"`）只选择显示哪份计票，不改变 data。`ScopeOverview` / `scopeOverviewData` / `ScopeOverviewData` 删除。见 `docs/feature/reports/library/summaries.md`。
25. **CLI flag `--run` → `--results`**（show / view / sandbox enter·list·stop 共用；破坏性，不留别名）：值是结果根目录；`show` 索引命令携带的上下文同步。
26. **view 证据页 `Runs` → `Attempts`**（导航项、路由与文案）。
27. **view 位置参数收窄为 eval id 前缀**：文件路径语义移到新 flag `--snapshot <file>`；位置参数不再随文件系统状态改变含义。
28. **指标改名**：`turns` → `assistantTurns`；`MetricAggregate.across` → `acrossEvals`；`ReportMeta.page` → `pageId`。
29. **数据形状维度名字段统一 `+Dimension` 后缀**（选项 props 名不动）：`TableData.dimension` → `rowDimension`、`ScoreboardData.dimension` → `rowDimension`、`MatrixData.rows/columns` → `rowDimension`/`columnDimension`、`ScatterData.points/series` → `pointDimension`/`seriesDimension`、`LineData.series` → `seriesDimension`、`DeltaData.by` → `byDimension`；条目数组一律 `rows`（Matrix 稀疏格子仍 `cells`）。
30. **`EntityListDataOptions { redact }` 三列表共用**：`experimentListData` / `evalListData` / `attemptListData` 都收 `redact`，改写范围=条目与全部嵌套 attempt 的 `failureSummary`。
31. **`AttemptListItem.costUSD: number | null`**（不再 optional；缺失一律 null）。
32. **`evalGroup` 维度定义**：eval id 完整父路径，无 `/` 取完整 id；Scoreboard `subject` 缺省同规则（不再是「第一段」）。
33. **`evals` 计数口径**：`ScopeSummaryData.evals` 与组索引 Eval 列都按 `experimentId + evalId` 计，与 verdict 构成同分母（示例 12/16 见 `show/default-report.md`）。
34. **`--history` 契约**：逐 `experimentId + evalId` 分节、attempt 身份键跨快照去重、startedAt 升序，每行时间 / verdict / 单行摘要（display 契约）/ 耗时 / 成本 / locator；与 `--report` 互斥。见 `docs/feature/reports/show.md#--history一个-eval-的执行时间轴`。
35. **`ExperimentList` 成本列头 `Est. cost` → `Cost`**（中文「预估成本」→「成本」）。
36. **`Row` / `Col` text 面与 `Style` 作用域**：Col 两面纵向；Row text 面宽度装得下按显示宽度并排、装不下整块纵向堆叠不截断；`Style` 页级全局、树位置只定声明顺序。

第四轮明确否决 / 撤回（不要实现）：`locales` 选项与 `relativeTo` 改名维持第三轮否决；`poweredBy` 关闭配置被用户当场推翻——`Powered by niceeval` 行继续写死、恒带官网链接。

## 2026-07-16 DX 试写回灌（第五批，docs 已改完）

在真实 eval repo 按新契约试写报告后的四条裁决（台账见 `memory/reports-dx-dogfood-rulings.md`）：

37. **`pairsByFlag(name, { baseline? })`**：`DeltaTableOptions.pairs` 接受 `FlagPairs` 派生声明（仅 `by: "experiment"`）——配对域=同可比组 + 删除该 flag 后可比性配置深相等（复用 `current()` 可比性字段集）；a=baseline（缺省=未声明该 flag），b 侧每个其它取值各一对；label 自动 `<a 末段> · <flag>=<显示键>`；(a 末段, 显示键) 字典序；0 对显示空态（N 个实验、0 个可配对），`by` 非 experiment 报完整用户反馈。见 `docs/feature/reports/library/metric-views.md#deltatable`。
38. **`FailureList` 官方组合件**（`niceeval/report` 导出）：verdict ∈ failed/errored、开始时间降序（同刻按 locator 字典序）、`limit` 默认 20、`total` 报截断前总数；props `{ limit?, input?, redact?, attemptHref?, locale?, className? }`；与手写组合严格等价。见 `docs/feature/reports/library/entity-lists.md#failurelist`。
39. **非空元组放宽（按元素来源二分）**：`DeltaTableOptions.pairs` 与 `ScoreboardOptions.questions` 改 `readonly T[]`，空数组在计算时按完整用户反馈报错；`metrics` / `columns` / `pages` 保留非空元组。
40. **`repeatedFailedCommands` 内置指标**：同一 attempt 内每条 shell 命令失败 n 次（n>1）记 n−1 求和；lower better、unit cmds、源 `o11y.json`，skipped 与缺 o11y 返回 null。见 `docs/feature/reports/library/metrics.md#内置指标`。

否决：DeltaTable 不加「隐藏未命中 pair」选项（缺失格契约已覆盖，隐藏走组合组件）。参考消费方：`/Users/ctrdh/Code/coding-agent-memory-evals/reports/memory-conditions.tsx` 已按 37–40 写好，可作实现后的真实冒烟对象。

## 步骤建议

1. 类型层:Scope 改名 + 新 `defineComponent`/`defineReport` 签名(`src/types.ts`、`src/report/report.ts`、`src/define.ts` 如涉及)。
2. resolve 管线:扩展 `src/report/tree.ts`(组合展开、记忆化、并行序保持、非法节点反馈),宿主接线 `src/report/report.ts`(text)与 `src/report/web.ts`(web)。
3. 官方组件逐个加 spec 形态(resolve 调对应 `*Data`)。
4. 内建入口、CLI 装载(`src/cli.ts` `--report`/`--page` 报错文案)、view 宿主。
5. 测试:把 `cases.md` 新增/改写的行变绿,特别是「组件解析(resolve)与组合组件」新分区;旧的 `Component.data` spy 相关测试按 memory/report-component-data-fn-spyon-must-target-component 的历史注意迁移。
6. 收尾同步义务(CLAUDE.md 表):`pnpm run typecheck`、`pnpm test`、`pnpm run build:report`(注意 memory/stale-dist-report-type-identity-typecheck)、公开面变更跑 `pnpm docs:reference`、核对 `src/i18n/` 两份 `--help` 速查、更新 `docs/source-map.md` reports 相关行、在真实 evals repo(如 `/Users/ctrdh/Code/coding-agent-memory-evals`)跑 `pnpm exec niceeval show / view --report` 对照 docs 预期。

## docs-site

`docs-site/zh` 四篇(custom-reports / report-components / publish-report / results-data)与英文入口按新契约同步——若本 PLAN 执行时它们尚未更新,以 `docs/feature/reports/` 为准源改写;改前必读 `docs-site/AGENTS.md`。验证:`PATH=/opt/homebrew/opt/node@22/bin:$PATH pnpm run docs:validate && pnpm run docs:links`。
