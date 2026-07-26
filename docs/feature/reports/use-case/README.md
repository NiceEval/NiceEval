# Reports —— 用例手册

本目录把 Reports 的 CLI 与 Library 能力放回真实任务里:先说用户要回答什么问题,再串起 Sample、组件、宿主和下钻路径,最后划出何时应换另一种形态。契约单源仍在 [Show](../show.md)、[View](../view.md)、[Library](../library.md) 与各组件分篇;可直接复制的代码在[报告配方](../library/recipes.md),用例篇不重复字段全集和渲染契约。

## 修失败与查证据

- [从失败清单到可修复任务](triage-failures.md) —— `FailureList` / `CopyFixPrompt` / `AttemptDetail`。
- [`@locator`:从默认报告一行下钻到一次失败的全部证据](show-locator-drilldown.md)。
- [`--history`:一道题时好时坏,按 attempt 看历次执行](show-history-flaky-eval.md)。

## 比较、评分与定位

- [从终端做跨条件归因](cli-cross-condition-attribution.md) —— 多 `--exp` 对照矩阵 / `--usage` / `--grep` / `--json`。
- [比较质量、成本与前沿](compare-quality-cost.md) —— `ExperimentComparison` / `ScatterChart` / `MetricTable`。
- [固定题集做考试成绩单](fixed-suite-scorecard.md) —— `Scoreboard`。
- [分数低时区分任务失败与执行失败](diagnose-reliability.md) —— `MetricTable` + 三种通过率。
- [定位「哪道题 × 哪个配置」出问题](locate-config-eval-interactions.md) —— `MetricMatrix` / `BarChart`。
- [比较基线与候选的成对差异](measure-ab-delta.md) —— `DeltaTable`。
- [扫描参数档位的趋势与拐点](sweep-parameter-trend.md) —— 数值轴 `LineChart`。
- [跟踪一个 Experiment 的历次 Run](track-experiment-history.md) —— `record.experiments` + run 维度。

## 完整性、定制与交付

- [先证明数据范围值得相信](audit-sample-quality.md) —— `SampleWarnings` / `RunDiagnostics` / `SampleSummary` / `ExperimentList`。
- [用 artifact 定义业务指标](build-custom-metric.md) —— `defineMetric` / 自定义维度。
- [从单页报告升级为多页站点](build-multipage-report.md) —— `defineReport` / pages / attempt-input page。
- [自己写报告组件：规范与取主题色](write-custom-component.md) —— `defineComponent` 两形态 / 取色纪律 / `ctx.seriesColor`。
- [给报告换主题，或做一份自己的主题包](theme-and-distribute.md) —— `--theme` / `defineTheme` / 令牌 / 分发。
- [把报告嵌入自己的产品页](embed-in-product.md) —— `*Data` + `niceeval/report/react`。

## `niceeval view`(浏览器与静态站)

- [裸 `view` 与收窄:在浏览器里复盘,只看关心的那部分](view-local-narrowing.md)
- [`--out`:把结果导出成静态站发布](view-out-publish.md)

## show 与 view 共用

- [`--record` / `--run`:换记录根,或只看一份 Run](record-root-and-run.md)
- [`--report` / `--page`:show 与 view 共用同一份自定义报告](report-shared-show-view.md)

## 组件 / API → 用例对照

| 能力 | 主用例 |
|---|---|
| `FailureList` / `CopyFixPrompt` / `AttemptDetail` | [修失败](triage-failures.md) |
| `ExperimentComparison` / `ScatterChart` | [质量 × 成本](compare-quality-cost.md) |
| `Scoreboard` | [固定题集考试](fixed-suite-scorecard.md) |
| `MetricTable` | [可靠性诊断](diagnose-reliability.md) · [质量 × 成本](compare-quality-cost.md) |
| `MetricMatrix` / `BarChart` | [配置 × Eval 定位](locate-config-eval-interactions.md) |
| `DeltaTable` | [A/B 成对差异](measure-ab-delta.md) |
| `LineChart` | [参数扫描](sweep-parameter-trend.md) |
| run 维度 / `ctx.record.experiments` | [Experiment 历史](track-experiment-history.md) |
| `SampleWarnings` / `RunDiagnostics` / `SampleSummary` / `ExperimentList` | [范围完整性](audit-sample-quality.md) |
| `defineMetric` / `CustomDimension` | [业务指标](build-custom-metric.md) |
| `defineReport({ pages })` / shell / `seriesPins` | [多页报告](build-multipage-report.md) |
| `defineComponent` / `ctx.seriesColor` / `--nre-*` 令牌 | [自己写组件](write-custom-component.md) |
| `defineTheme` / `--theme` / `themeStylesheet` | [换主题与主题包](theme-and-distribute.md) |
| `*Data` / `niceeval/report/react` | [嵌入产品页](embed-in-product.md) |
| `Grid` / `Stat` / `Row` / `Col` / `Section` / `Tabs` | 所有 Library 用例的布局层;内容过多时看[多页报告](build-multipage-report.md) |

## CLI 输入 → 篇目对照

| 输入 | 命令 | 所在篇目 |
|---|---|---|
| 位置参数(eval id 前缀) | show / view | [`--history` 用例](show-history-flaky-eval.md) · [裸 `view` 与收窄](view-local-narrowing.md) |
| `@<locator>` 位置参数 | show | [`@locator` 下钻](show-locator-drilldown.md) |
| `--source` / `--execution` / `--timing` / `--diff` | show | [`@locator` 下钻](show-locator-drilldown.md) |
| `--usage` / `--grep` / `--expand` | show | [跨条件归因](cli-cross-condition-attribution.md) |
| `--json` | show | [跨条件归因](cli-cross-condition-attribution.md) |
| `--history` | show | [`--history` 用例](show-history-flaky-eval.md) |
| `--stats` | show | [跨条件归因](cli-cross-condition-attribution.md) |
| `--exp` | show / view | [`--history` 用例](show-history-flaky-eval.md) · [裸 `view` 与收窄](view-local-narrowing.md) |
| `--exp` ×N(对照) | show | [跨条件归因](cli-cross-condition-attribution.md) |
| `--record` | show / view | [换记录根](record-root-and-run.md) |
| `--run` | view | [换记录根](record-root-and-run.md) |
| `--no-open` / `--port` | view | [裸 `view` 与收窄](view-local-narrowing.md) |
| `--out` | view | [静态导出](view-out-publish.md) |
| `--report` / `--page` | show / view | [自定义报告](report-shared-show-view.md) |
| `--theme` | view | [换主题与主题包](theme-and-distribute.md) |
