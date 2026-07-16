# 设计裁决:Reports 第四轮评审修订(2026-07-16)

第三轮（[reports-external-review-rulings](reports-external-review-rulings.md)）落稿后又做了一轮全量 docs 评审（读 `docs/feature/reports/` 全部 14 篇，不读 src），按裁决重写受影响小节。定稿形态在 `docs/feature/reports/`，场景行同批更新在 `docs/engineering/unit-tests/reports/cases.md`。本条记翻案、否决与来龙去脉。

## 接受（评审指出的真缺陷）

- **组索引示例与 `evals` 口径互相矛盾**：`show/default-report.md` 示例里 compare 组 Eval 列 6、verdict 构成 9+3=12，而契约定义 `evals` = `experimentId + evalId` 去重计数。裁决：口径以契约为准（对计数），示例改 12/16，并在 default-report 写明「Eval 列与同行 verdict 构成同分母，两个数字能直接对账」。**曾选方案**：Eval 列显示去重 eval id 数；**否决理由**：同一行两个数字不同分母无法对账，且 data 里根本没有「去重 id 数」这个字段。
- **redact 有洞**：`attemptListData` 有 `redact`，但 `EvalListItem` / `ExperimentListEvalRow` 嵌套完整 `AttemptListItem[]`，同一段 `failureSummary` 从 `evalListData` / `experimentListData` 原样流出。裁决：三个列表数据函数共用 `EntityListDataOptions { redact }`，改写范围=条目本身与全部嵌套 attempt 的 `failureSummary`，自由文本没有绕过遮蔽的出口。
- **`evalGroup` 全程未定义**：文档里存在两条竞争规则（可比组=完整父路径 vs Scoreboard subject 默认=第一段）。裁决：`evalGroup` = eval id 完整父路径（无 `/` 取完整 id），与可比组同一条派生规则；Scoreboard `subject` 缺省改为同规则，全库只留一条路径分组规则。
- **`--history` 是幽灵功能**：出现两处、互斥关系有声明，但没有输出契约。裁决：在 show.md 补最小契约——逐 `experimentId + evalId` 分节、attempt 身份键跨快照去重、startedAt 升序、每行时间/verdict/单行摘要/耗时/成本/locator；与 `--report` 互斥（都占主输出）；快照级趋势归报告库历史配方。
- **view 位置参数破坏 CLI 模型**：「存在的文件=打开该 snapshot.json」让位置参数含义随文件系统状态改变，且与 show 不一致。裁决：新增 `--snapshot <file>`，位置参数只表示 eval id 前缀。
- **「Est. cost / 预估成本」列头与 `costUSD` 定义（实测优先、估算兜底）打架**：实测值被标成估算。裁决：列头改「Cost / 成本」，列头不断言口径。
- **数据形状维度名字段三分**：`TableData.dimension` / `MatrixData.rows`（string）/ `ScatterData.points`，且 `MatrixData.rows: string` 与 `TableData.rows: Array` 同名异型。裁决：统一为「选项名 + `Dimension` 后缀」（`rowDimension` / `columnDimension` / `pointDimension` / `seriesDimension` / `byDimension`），条目数组一律 `rows`；**选项名不动**（`DeltaTableOptions.by` 等第三轮已否决改名的 props 保持原名）。
- **`AttemptListItem.costUSD?: number` 用 optional 表达缺失**：与全库「null=测不了」相悖，序列化后 undefined 消失与 null 在场是两种语义。裁决：`costUSD: number | null`，attempt 级缺失一律 null。
- **两级前缀匹配语义并存无解释**：`--experiment` 路径段匹配 vs eval 位置参数裸前缀。裁决：语义保持不同但把理由写进 show.md——experiment 选身份与可比组须精确，eval 位置参数是收窄过滤、宽松多命中是特性。
- **`Row` / `Col` text 面无契约**：补——Col 两面纵向；Row web 横排，text 面宽度装得下按显示宽度并排（与 `columns` 同尺），装不下整块纵向堆叠不截断。
- **`Style` 作用域未声明**：补——页级全局，树位置只决定声明顺序；有外壳时优先外壳 `styles`，`Style` 服务树形态与自带样式组件。
- **文档小修**：`ScopeSummary input={scope.filter(...)}` 示例裸用 `scope` 变量（树顶层不存在），包进组合组件；architecture「Reports 只有三个概念」收敛为「可装载的分层只有三个概念」；shell.md scripts 注释里 GA4 / react-grab 具体产品名中性化为「站点分析与埋点一类第三方脚本」。

## 命名翻案（含对第三轮的再翻案）

- **`ScopeOverview` 并入 `ScopeSummary`**（翻案：第三轮刚定名 `RunOverview`→`ScopeOverview`、`GroupSummary`→`ScopeSummary` 两个组件）。否决理由：Overview/Summary 是近义词，选择表里两行描述无法区分；真实差异只是计票层级（attempt 级原始 vs eval 级折叠）与时间字段（range vs lastRunAt），本来就是参数级差异。裁决：单一 `ScopeSummary`，data 恒携带 `attemptVerdicts` + `evalVerdicts` 两份计票与 `range`（`lastRunAt` 被 `range.latestStartedAt` 吸收），呈现 prop `votes?: "eval" | "attempt"`（默认 eval）只选显示。第三轮拆 `attemptVerdicts` / `evalVerdicts` 字段名的裁决保留并成为合并的前提——两份计票摆在同一份 JSON 里口径自明。
- **`--run <dir>` → `--results <dir>`**：`--run` 指的是结果根目录，不是一次 run；与 `exp --runs`（重试次数）一字之差完全两义，与 view 旧 Runs 页三方撞名。
- **view 证据页 `Runs` → `Attempts`**：页内容就是 attempt 列表，全库术语是 attempt，页名跟随。
- **`turns` → `assistantTurns`**：指标数的是 o11y 事件流的 assistant turn，与 `t.send` 的 `s/t` 轮次是两个计数，无限定词必然被按 send 轮误读。
- **`MetricAggregate.across` → `acrossEvals`**：`across` 悬空（across 什么？），`perEval` / `acrossEvals` 两级各自点名。
- **`ReportMeta.page` → `pageId`**：值是 page id，不是页对象。

## 否决 / 撤回（尊重第三轮已有裁决）

- **`*Data` 加 `locales` 选项**：本轮曾以「shell.md 声明数据协议不封语言上限 vs display 只出 en/zh-CN 矛盾」为由重新引入，随即撤回——第三轮已明确否决（speculative knob，回退语义已够），且「协议开放」说的是 LocalizedText 键形状，与官方生成面覆盖范围不矛盾。
- **`relativeTo` 改名 `parentPath`**：第三轮已明确否决 relativeTo 改名，本轮曾改后撤回。
- **`Powered by niceeval` 加 `poweredBy: false` 关闭配置**：曾落进 shell.md，用户当场推翻——品牌行写死、恒带官网链接，是产品决策不是缺陷；「无关闭配置」措辞保留。
- **标题回退串 `"NiceEval"` 改小写**：仓库散文体品牌就写 NiceEval，不改。
