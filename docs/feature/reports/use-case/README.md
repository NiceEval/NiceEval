# Reports —— 用例手册

本目录把 Reports 的 CLI 与 Library 能力放回真实任务里。
先说用户要回答什么问题，再串起 Sample、组件、宿主和下钻路径，最后划出何时应换另一种形态。
契约单源仍在 [Show](../show.md)、[View](../view.md)、[Library](../library.md) 与各组件分篇。
可直接复制的代码在[完整示例](../library/examples.md)，用例篇不重复字段全集和渲染契约。

## [调试](调试/README.md)

- [从失败清单到可修复任务](调试/整理失败清单.md) —— `FailureList` / `SampleFixPrompt` / `AttemptDetails`。
- [`@locator`:从默认报告一行下钻到一次失败的全部证据](调试/按定位符下钻.md)。
- [`--history`:一道题时好时坏,按 attempt 看历次执行](调试/查看不稳定历史.md)。
- [瀑布里全是短节点:哪些值得看,时间去了哪](调试/从瀑布定位耗时.md) —— Traces 页 /`Waterfall` 显著性折叠 / `--timing` 下钻。

## [分析](分析/README.md)

- [先证明数据范围值得相信](分析/核对样本完整性.md) —— `SampleNotices` / `RunNotices` /`SampleSummary` / `toExperimentRows(sample)`。
- [从终端做跨条件归因](分析/终端跨条件归因.md) —— 多 `--exp` 对照矩阵 / `--usage` / `--grep` / `--json`。
- [比较质量、成本与前沿](分析/比较质量与成本.md) —— 首页任务函数的质量成本 points / `Chart` 的 scatter mark / `aggregate()`。
- [固定题集做考试成绩单](分析/固定题集成绩单.md) —— 报告旁成绩单函数。
- [分数低时区分任务失败与执行失败](分析/诊断可靠性.md) —— `aggregate()` + 三种通过率。
- [定位「哪道题 × 哪个配置」出问题](分析/定位配置与评测交互.md) —— `aggregate()` 后的矩阵与 `Bars`。
- [比较基线与候选的成对差异](分析/测量成对差异.md) —— `comparisonResult()`。
- [扫描参数档位的趋势与拐点](分析/扫描参数趋势.md) —— 数值轴 `Chart` 的 line mark。
- [跟踪一个 Experiment 的历次 Run](分析/跟踪实验历史.md) —— `record.experiments` + run 维度。

## [构建报告](构建报告/README.md)

- [用 artifact 定义业务读数](构建报告/定义业务读数.md) —— `rollup()` / 自定义分组。
- [从单页报告升级为多页站点](构建报告/构建多页报告.md) —— `defineReport` / pages / 参数化详情页。
- [把 NiceEval 读数和外部业务数据放进同一张表](构建报告/接入外部业务数据.md) —— 冻结快照模块 / report 文件 import。
- [自己写报告组件：规范与取主题色](构建报告/自定义组件/) —— `defineComponent` 双面协议 /`defineRenderer()` 与视觉身份 context。

## [交付报告](交付报告/README.md)

- [给报告换主题，或做一份自己的主题包](交付报告/主题/) —— `--theme` / `defineTheme` / 令牌 / 分发。
- [把报告嵌入自己的产品页](交付报告/嵌入产品.md) —— 数据源 + `niceeval/report/react`。
- [`--out`:把结果导出成静态站发布](交付报告/导出静态站.md)

## [使用宿主](使用宿主/README.md)

- [不带选项的 `view` 与收窄:在浏览器里复盘,只看关心的那部分](使用宿主/浏览器复盘与收窄.md)
- [`--record` / `--run`:换记录根,或只看一份 Run](使用宿主/切换记录根与Run.md)
- [`--report` / `--page`:show 与 view 共用同一份自定义报告](使用宿主/共用自定义报告.md)
- [人看 web、Agent 读终端：共用自定义业务口径](使用宿主/让Agent读取自定义报告.md)

## 组件 / API → 用例对照

| 能力 | 主用例 |
|---|---|
| `FailureList` / `SampleFixPrompt` / `AttemptDetails` | [修失败](调试/整理失败清单.md) |
| `Waterfall` / `toTraceNodes(sample)` 的显著性折叠 | [瀑布定位耗时](调试/从瀑布定位耗时.md) |
| 首页任务函数的质量成本 points / `Chart` 的 scatter mark | [质量 × 成本](分析/比较质量与成本.md) |
| 报告旁成绩单函数 | [固定题集考试](分析/固定题集成绩单.md) |
| `aggregate()` | [可靠性诊断](分析/诊断可靠性.md) · [质量 × 成本](分析/比较质量与成本.md) |
| `aggregate()` 后的矩阵与 `Bars` | [配置 × Eval 定位](分析/定位配置与评测交互.md) |
| `comparisonResult()` | [A/B 成对差异](分析/测量成对差异.md) |
| `Chart` 的 line mark | [参数扫描](分析/扫描参数趋势.md) |
| run 维度 / `ctx.record.experiments` | [Experiment 历史](分析/跟踪实验历史.md) |
| `SampleNotices` / `RunNotices` / `SampleSummary` / `toExperimentRows(sample)` | [范围完整性](分析/核对样本完整性.md) |
| `rollup()` / 自定义分组 | [业务读数](构建报告/定义业务读数.md) |
| `defineReport({ pages })` / shell / `dimensionPins` | [多页报告](构建报告/构建多页报告.md) |
| 普通转换 / `defineRenderer()` / 主题令牌 | [自己写组件](构建报告/自定义组件/) |
| `defineTheme` / `--theme` / `themeStylesheet` | [换主题与主题包](交付报告/主题/) |
| 数据源 / `niceeval/report/react` | [嵌入产品页](交付报告/嵌入产品.md) |
| `Grid` / `Stat` / `Row` / `Col` / `Section` / `Tabs` | 所有 Library 用例的布局层;内容过多时看[多页报告](构建报告/构建多页报告.md) |

## CLI 输入 → 篇目对照

| 输入 | 命令 | 所在篇目 |
|---|---|---|
| 位置参数(eval id 前缀) | show / view | [`--history` 用例](调试/查看不稳定历史.md) · [不带选项的 `view` 与收窄](使用宿主/浏览器复盘与收窄.md) |
| `@<locator>` 位置参数 | show | [`@locator` 下钻](调试/按定位符下钻.md) |
| `--source` / `--execution` / `--timing` / `--diff` | show | [`@locator` 下钻](调试/按定位符下钻.md) |
| `--usage` / `--grep` / `--expand` | show | [跨条件归因](分析/终端跨条件归因.md) |
| `--json` | show | [跨条件归因](分析/终端跨条件归因.md) |
| `--history` | show | [`--history` 用例](调试/查看不稳定历史.md) |
| `--stats` | show | [跨条件归因](分析/终端跨条件归因.md) |
| `--exp` | show / view | [`--history` 用例](调试/查看不稳定历史.md) · [不带选项的 `view` 与收窄](使用宿主/浏览器复盘与收窄.md) |
| `--exp` ×N(对照) | show | [跨条件归因](分析/终端跨条件归因.md) |
| `--record` | show / view | [换记录根](使用宿主/切换记录根与Run.md) |
| `--run` | view | [换记录根](使用宿主/切换记录根与Run.md) |
| `--no-open` / `--port` | view | [不带选项的 `view` 与收窄](使用宿主/浏览器复盘与收窄.md) |
| `--out` | view | [静态导出](交付报告/导出静态站.md) |
| `--report` / `--page` | show / view | [自定义报告](使用宿主/共用自定义报告.md) |
| 项目默认报告 | show / view | [人和 Agent 共用口径](使用宿主/让Agent读取自定义报告.md) |
| `--theme` | view | [换主题与主题包](交付报告/主题/) |
