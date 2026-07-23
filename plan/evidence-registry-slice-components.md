# 证据 registry × show 切片组件化:docs 传播 TODO(树形)

两条核心裁决已由 planner 落进架构文档,本 plan 只列**传播**工作——把裁决贯通到受影响的分篇、库文档与既有 plan。契约单源,一律以 docs 为准,不在本文复述:

- 证据 registry、`artifacts` 列表、o11y 缓存正名:`docs/feature/results/architecture.md#证据-registry`(裁决 `memory/results-evidence-registry-ruling.md`)
- 切片=组件、`--json`=resolve 产物信封:`docs/feature/reports/architecture.md#show-的切片是组件选择`(裁决 `memory/show-slices-are-components-ruling.md`)

**范围**:只改 `docs/` / `plan/`;不动 `src/`、不动 `docs-site/`(公开站等实现跟上后再同步)。

## 执行纪律(每个节点都遵守)

- 声明式重写受影响小节:不写差分句(「不再」「已改为」)、不写实现状态。
- **只编辑本节点「独占文件」清单内的文件**;发现需要改别的文件,写进返回报告,不动手。
- 既有小节标题(锚点)不改名;必须改时把全仓引用一并更新(先 grep)。
- 不执行任何 git 命令;不改 `memory/INDEX.md`(索引行由 planner 统一维护)。
- 完成后跑 `pnpm vitest run test/docs-consistency.test.ts` 确认绿;返回报告列出重写的小节与发现的矛盾。

## TODO 树

```
R 传播(核心裁决已落架构,见上)
├─ [x] N0 核心:results/architecture.md + reports/architecture.md + 两条 memory 裁决(planner,已完成)
├─ [ ] W1 exp `--json` 事件流 typed 单源                    ── 并行
├─ [x] W2 results 库文档与词表贯通                          ── 并行(已验收;planner 顺手清掉 observability/testing-results/source-map 三处清单外 has* 残留)
├─ [ ] W3 对照与稳定性组件(DeltaTable 多条件 + StabilityMatrix)── 并行
├─ [ ] W4 usage 组件化(UsageTable + 组装口径归位)          ── 并行
├─ [ ] W5 show 总纲与 json 信封重写                         ── 并行
├─ [ ] W6 证据切片归属重写(execution/timing/diff/source)   ── 并行
└─ [ ] W7 既有 plan 波及同步                                ── 串行,等 W1–W6 全部验收后
```

W1–W6 文件集互不相交,可全并行;W7 引用 W1–W6 定稿后的小节名,必须串行殿后。planner 在每个节点完成后验收并按路径提交。

## 节点定义

### W1 exp `--json` 事件流 typed 单源

- **独占文件**:`docs/feature/experiments/cli.md`
- **要点**:在「机器怎么读:`--json`」小节为事件流补 TypeScript 单源——每个事件(`start` / `progress` / `failure` / `error` / `eval` / `kept` / `warning` / `budget_exhausted` / `reporter_error` / `interrupted` / `experiment_setup` / `experiment_teardown` / `result`)一个 interface,判别字段 `event`,首事件携带 `format: "niceeval.exp"` / `schemaVersion`;`--dry --json` 计划文档的 `format: "niceeval.exp-plan"` 顶层形状一并声明。字段名沿用 Results 词表。既有 JSON 示例逐行核对与声明形状一致(计数自洽,不引入示例与 schema 的矛盾)。
- **验收**:词表中每个事件都有 interface;示例是声明形状的合法实例;文中不再存在「只有示例没有形状」的事件。

### W2 results 库文档与词表贯通

- **独占文件**:`docs/feature/results/library.md`、`docs/concepts.md`、`memory/results-schema-version-history.md`
- **要点**:`library.md` 按 registry 重写受影响小节——`writeAttempt` 注释(artifact 全集与截断落点按 registry 词干)、`copySnapshots` 的 `artifacts` 合法值与缺省(指向 registry 单源,不再自维护并列清单)、reader 要点里 `has*` 表述换 `artifacts` 列表、懒加载方法与词干一一对应。`concepts.md` 的 Artifact 词条按 registry 改写(文件清单指向单源)。`memory/results-schema-version-history.md` 追加 v9 条目(has*→artifacts、o11y 删 usage/cost,引用裁决)。
- **验收**:grep 全 docs 无 `hasEvents|hasTrace|hasSources|hasCommands` 残留;copySnapshots 词表与 registry 词干一致;版本史有 v9。

### W3 对照与稳定性组件

- **独占文件**:`docs/feature/reports/library/metric-views.md`、`docs/feature/reports/show/compare.md`、`docs/feature/reports/show/stats.md`、`docs/feature/reports/use-case/measure-ab-delta.md`、`docs/feature/reports/use-case/diagnose-reliability.md`
- **要点**:`metric-views.md` 把 `DeltaTable` 升级为多条件对照组件(吸收 compare 分篇全部语义:条件顺序与基准、eval id 配对、翻转标记、占位与时效、混型分段、各条件汇总、共同题 paired delta),声明 `deltaTableData` 的完整 `*Data` 形状(即 `--json` 该视图的 data 单源,吸收原 json.md 的 `CompareJson`);新增 `StabilityMatrix` + `stabilityMatrixData` 小节(吸收 stats 分篇口径与原 `StatsJson` 形状,写明与 `MetricMatrix` 的分工:历史全执行证据面 vs 现刻水位)。`compare.md` / `stats.md` 重写为「该组件在 show 的装配」:CLI 行为、示例、边界保留,数据形状与聚合口径引用组件小节单源,`--json` 小节改为指针。两个 use-case 页的组件指引同步。
- **验收**:对照/稳定性的聚合口径(paired delta、✗/! 分列等)全 docs 恰好声明一处;compare/stats 分篇无与组件小节重复的形状声明;`⇄`、`never ✓` 等展示语义无两处矛盾。

### W4 usage 组件化

- **独占文件**:`docs/feature/reports/show/usage.md`、`docs/feature/reports/library/attempt-detail.md`
- **要点**:`attempt-detail.md` 新增(或改写既有 Usage 区块为)`UsageTable` + `usageTableData`:声明 data 形状(吸收原 json.md 的 `UsageJson`:行为计数来自 events、token 来自 `Usage`、`uncachedInputTokens` 派生条件、缺失省略不编 0),attempt 首页 `usage:` 行声明为同一组件的单行装配。`usage.md` 重写为该组件在 show 的装配:组装口径单源移到组件小节,分篇保留 CLI 示例、范围化分节与合计 `—`/`*` 规则,`--json` 改指针。
- **验收**:usage 组装口径全 docs 恰好一处;`usage:` 行与 `--usage` 表引用同一单源;无 requests 凑数表述回潮。

### W5 show 总纲与 json 信封重写

- **独占文件**:`docs/feature/reports/show.md`、`docs/feature/reports/show/json.md`
- **要点**:`show.md` 三轴总纲中「切片」轴改写为组件选择语义(引用 architecture 新节;缺省切片选择表、范围/互斥规则、`--report` 与 `--json` 互斥保留);`json.md` 重写为**信封 + 指针**:保留 `ShowJson` 信封(format/schemaVersion/view/scope 回显)与跨视图不变量(单文档、stderr 走警告、忠实转发截断、text 预算不适用),逐视图 data 形状删除,换成「view → 组件 `*Data` 声明」的指针表(leaderboard→`experimentListData`+`scopeSummaryData`、compare→`deltaTableData`、stats→`stabilityMatrixData`、usage→`usageTableData`、attempt/source/execution/timing/diff/history→attempt-detail 族与 history 对应声明)。W3/W4/W6 并行进行中,指针按组件名与文件路径写,不需要等对方完稿。
- **验收**:json.md 无逐视图手写 interface 残留(信封除外);指针表覆盖 view 枚举全部取值;show.md 与 architecture 新节无重复声明、无矛盾。

### W6 证据切片归属重写

- **独占文件**:`docs/feature/reports/show/execution.md`、`docs/feature/reports/show/timing.md`、`docs/feature/reports/show/diff.md`、`docs/feature/reports/show/eval-source.md`、`docs/feature/reports/show/attempt.md`
- **要点**:各分篇开头的归属表述改为「attempt-detail 组件族对应区块的 text 面」;预览预算、`--expand`、`--grep`、`--timing` 80-node 预算改述为「text 渲染面选项,JSON 面恒全量」(行为契约本身——预算数值、句柄语法、grep 语义、分节规则——逐字不动);多 attempt 分节声明为宿主机器映射。`attempt.md` 的 `usage:` 行指向 W4 的组件单源(锚点按 `docs/feature/reports/library/attempt-detail.md` 内 UsageTable 小节写)。
- **验收**:五个分篇无「专用终端投影」类表述;行为契约(数值、语法)与改前逐字一致(只换归属与理由表述)。

### W7 既有 plan 波及同步(串行,等 W1–W6 验收)

- **独占文件**:`plan/show-scope-slice-json.md`、`plan/failed-command-evidence.md`、`plan/exp-json-machine-form.md`
- **要点**:三份实现 plan 的落点与措辞对齐新契约——show plan 的 C1/C1b/C2/D1 改为组件化落点(组件 + `*Data` + show 装配),B/D 引用新锚点;failed-command plan 的 `hasCommands` 改 `artifacts` 列表、落盘按 registry;exp plan 核对 A/B 节点引用的 cli.md 锚点仍真实。不复述契约,只改落点与引用。
- **验收**:三份 plan 无 `has*` 与「宿主投影」残留;引用的 docs 锚点全部真实存在。

## 全局验收(planner 执行)

1. `pnpm vitest run test/docs-consistency.test.ts test/memory-index.test.ts` 绿。
2. 跨文件对账:json.md 指针 → 组件 `*Data` 声明真实存在;registry 词干 ↔ copySnapshots 词表 ↔ reader 方法名三方一致;compare/stats/usage 的口径声明全仓唯一。
3. 残留扫描:`hasEvents|hasTrace|hasSources|hasCommands`、「宿主证据投影」、`CompareJson|UsageJson|StatsJson`(作为独立声明)全 docs 无残留。
4. 每节点验收通过后按路径限定提交;W7 提交后本 plan 勾销。
