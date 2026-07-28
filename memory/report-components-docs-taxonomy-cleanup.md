# 报告组件文档去专用件残影：Source 归 sources/、SampleNotices 改 Composition、影子 helper 公开化

日期：2026-07-28。起因：用户审「组件定义得对不对、内容好不好、该不该独立成文件」，
逐篇体检发现三类系统性问题，同批裁决并落地。

## 裁决一：Source 文档统一归 `components/sources/`，场景目录只留组件

- **裁决**：`tables/`、`entity-lists/` 两个目录解散——里面全是 `sources.measure.*` /
  `sources.entity.*` 的正文，却顶着专用件时代的文件名（`measure-table.md`、
  `experiment-rows.md`、`delta-table.md`……）。全部搬进 `components/sources/` 并按
  `measure-rows.md` 这类 source 名重命名；`site/` 里错放的 `trace-waterfall.md`
  （实为 `sources.sample.traces`）、`attempt-detail/` 里的 `attempt-source.md` 同批搬入。
  `eval-rows.md` / `attempt-rows.md` 是空壳（各十几行），并入 `entity.md`。
- **曾选方案**：按概念再立一个 `compositions/` 目录。否决：读者带场景问题来，
  场景目录（summaries / attempt-detail / site）继续留给组合组件与 Component；
  概念归属由 `components/README.md` 总表单点声明。
- **残影来源**：commit 55054f4a「原语 + sources 取代专用件」改了内容没改文件名与目录，
  死名字（`DeltaTable`、`UsageTable`、`ExperimentList`、`SampleWarnings`）在十几处
  引用点的锚文本里存活，本次一并清除。

## 裁决二：`SampleNotices` 从 Component 改为 Composition

- **裁决**：与 `RunNotices` / `AttemptNotices` 同构——`ctx.resolve(snapshot)` →
  `findSampleIssues()` → `<Callouts data>`。专用 `Notice` 形状废除，分类函数统一产出
  `CalloutGroup[]`。
- **曾选方案**：带私有 renderer 的 `defineComponent`（“与 Callouts 共用纯 renderer
  但不是报告树节点”）。否决理由：同一种东西（事实→分类→Callouts）三个组件两种写法；
  领域解释按四问判据属于计算不属于 renderer；旧示例还漏了必填的 `dimensions`，
  文档自相矛盾。
- **代价**：`niceeval/report/react` 不再导出 `SampleNotices`；嵌入页改用
  `Callouts` + 公开导出的 `findSampleIssues(snapshot)`（docs-site custom-reports 已同步）。

## 裁决三：影子 helper 的家（同日两版，第二版定稿）

- **现象**：Composition 契约承诺「等价全文照抄即可改」，但全文引用了一批既非公开导出
  也无签名的函数（`resolveComparisonSeries`、`summaryMeasureStats`、`verdictStats`、
  `classifyRunIssues`、`classifyAttemptIssues`、`isActionableFailure`、`buildFixPrompt`），
  照抄编译不过。
- **第一版（当日，已推翻）**：十个 helper 一律定为 `niceeval/report` 顶层公开导出、
  签名写在所属文档。用户复核指出：散函数公开面不成体系，与「拿实验颜色走
  `ctx.dimension`、取数走 `sources.*`」的目录式 API 先例不符。
- **第二版（定稿）**：按性质三分——
  口径收进具名目录 `notices.sample/run/attempt` 与 `fixPrompts.sample/attempt`
  （与 `sources.*` 同一种发现方式；筛选谓词 `isActionableFailure` 收进 `fixPrompts`
  入口内部）；题型构成与 labels 键是事实，升为 `sources.sample.snapshot` 的
  `scoringComposition` / `labelKeys` 字段，独立函数 `scoringComposition()` 删除；
  纯装配胶水（`verdictStats`、`summaryMeasureStats`、`resolveComparisonSeries`）内联进
  等价全文的字面代码，不占公开面。总规则升级为「全文只引用官方目录与字面装配代码」，
  落点 `components/README.md`「口径目录」小节。
- **代价**：「自己筛失败 + 复用官方措辞」的中间场景消失（fixPrompts 吞掉谓词）；
  判据是散谓词为边缘场景占一个公开名不划算。
- **实现注意**：目录与 snapshot 字段是文档先行的契约，`src/report` 落地时按各篇签名补齐。

同批补齐三篇缺失契约（`AttemptNotices`、`AttemptFixPrompt`、`AttemptSummary`），
Composition 总表补上缺席的 `Hero`。
