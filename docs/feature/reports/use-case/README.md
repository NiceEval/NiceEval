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

- [先证明数据范围值得相信](分析/核对样本完整性.md) —— `SampleNotices` / `RunNotices` / `SampleSummary` / Experiment summary Calculation。
- [从终端做跨条件归因](分析/终端跨条件归因.md) —— 多 `--exp` 对照矩阵 / `--usage` / `--json`。
- [比较质量、成本与前沿](分析/比较质量与成本.md) —— 质量—成本 Calculation / `Chart` 的 scatter mark / `aggregate()`。
- [固定题集做考试成绩单](分析/固定题集成绩单.md) —— 报告旁成绩单 Calculation。
- [分数低时区分任务失败与执行失败](分析/诊断可靠性.md) —— `aggregate()` + 三种通过率。
- [定位「哪道题 × 哪个配置」出问题](分析/定位配置与评测交互.md) —— `aggregate()` 声明的矩阵与 `Bars`。
- [比较基准与候选的成对差异](分析/测量成对差异.md) —— 成对比较 Calculation。
- [扫描参数档位的趋势与拐点](分析/扫描参数趋势.md) —— 数值轴 `Chart` 的 line mark。
- [跟踪一个 Experiment 的历次 Run](分析/跟踪实验历史.md) —— 固定历史 Sample + run provenance。

## [构建报告](构建报告/README.md)

- [用 Projector 定义业务读数](构建报告/定义业务读数.md) —— Projector / Calculation / `rollup()`。
- [从单页报告升级为多页站点](构建报告/构建多页报告.md) —— `defineReport` / pages / 参数化详情页。
- [把 NiceEval 读数和外部业务数据放进同一张表](构建报告/接入外部业务数据.md) —— Record snapshot / Projector。
- [自己写报告组件：规范与取主题色](构建报告/自定义组件/) —— 双面 renderer / `defineRenderer()` 与稳定视觉身份。

## [交付报告](交付报告/README.md)

- [给报告换主题，或做一份自己的主题包](交付报告/主题/) —— `--theme` / `defineTheme` / 令牌 / 分发。
- [把报告嵌入自己的产品页](交付报告/嵌入产品.md) —— 数据源 + `niceeval/report/react`。
- [`--out`:把结果导出成静态站](交付报告/导出静态站.md)

## [使用宿主](使用宿主/README.md)

- [在浏览器里复盘一份固定样本](使用宿主/浏览器复盘.md)
- [`--record` / `--run`:选择另一份 Record，或只看一份 Run](使用宿主/选择Record与Run.md)
- [`--report` / `--page`:show 与 view 共用同一份自定义报告](使用宿主/共用自定义报告.md)
- [人看 web、Agent 读终端：共用自定义业务口径](使用宿主/让Agent读取自定义报告.md)

## 组件 / API → 用例对照

| 能力 | 主用例 |
|---|---|
| `FailureList` / `SampleFixPrompt` / `AttemptDetails` | [修失败](调试/整理失败清单.md) |
| `Waterfall` / 已计划 trace data 的显著性折叠 | [瀑布定位耗时](调试/从瀑布定位耗时.md) |
| 质量—成本 Calculation / `Chart` 的 scatter mark | [质量 × 成本](分析/比较质量与成本.md) |
| 报告旁成绩单 Calculation | [固定题集考试](分析/固定题集成绩单.md) |
| `aggregate()` | [可靠性诊断](分析/诊断可靠性.md) · [质量 × 成本](分析/比较质量与成本.md) |
| `aggregate()` 声明的矩阵与 `Bars` | [配置 × Eval 定位](分析/定位配置与评测交互.md) |
| 成对比较 Calculation | [A/B 成对差异](分析/测量成对差异.md) |
| `Chart` 的 line mark | [参数扫描](分析/扫描参数趋势.md) |
| run provenance / fixed Sample union | [Experiment 历史](分析/跟踪实验历史.md) |
| `SampleNotices` / `RunNotices` / `SampleSummary` / Experiment summary Calculation | [范围完整性](分析/核对样本完整性.md) |
| `rollup()` / 自定义分组 | [业务读数](构建报告/定义业务读数.md) |
| `defineReport({ plan })` / shell / `dimensionPins` | [多页报告](构建报告/构建多页报告.md) |
| 普通转换 / `defineRenderer()` / 主题令牌 | [自己写组件](构建报告/自定义组件/) |
| `defineTheme` / `--theme` / `themeStylesheet` | [换主题与主题包](交付报告/主题/) |
| 数据源 / `niceeval/report/react` | [嵌入产品页](交付报告/嵌入产品.md) |
| `Grid` / `Stat` / `Row` / `Col` / `Section` / `Tabs` | 所有 Library 用例的布局层;内容过多时看[多页报告](构建报告/构建多页报告.md) |

## CLI 输入 → 篇目对照

| 输入 | 命令 | 所在篇目 |
|---|---|---|
| 位置参数(eval id 前缀) | show / view | [`--history` 用例](调试/查看不稳定历史.md) · [浏览器复盘](使用宿主/浏览器复盘.md) |
| `@<locator>` 位置参数 | show | [`@locator` 下钻](调试/按定位符下钻.md) |
| `--source` / `--execution` / `--timing` / `--diff` | show | [`@locator` 下钻](调试/按定位符下钻.md) |
| `--usage` | show | [跨条件归因](分析/终端跨条件归因.md) |
| `--json` | show | [跨条件归因](分析/终端跨条件归因.md) |
| `--history` | show | [`--history` 用例](调试/查看不稳定历史.md) |
| `--stats` | show | [跨条件归因](分析/终端跨条件归因.md) |
| `--exp` | show / view | [`--history` 用例](调试/查看不稳定历史.md) · [浏览器复盘](使用宿主/浏览器复盘.md) |
| `--exp` ×N(对照) | show | [跨条件归因](分析/终端跨条件归因.md) |
| `--record` | show / view | [选择另一份 Record](使用宿主/选择Record与Run.md) |
| `--run` | view | [选择另一份 Record](使用宿主/选择Record与Run.md) |
| `--no-open` / `--port` | view | [浏览器复盘](使用宿主/浏览器复盘.md) |
| `--out` | view | [静态导出](交付报告/导出静态站.md) |
| `--report` / `--page` | show / view | [自定义报告](使用宿主/共用自定义报告.md) |
| 项目默认报告 | show / view | [人和 Agent 共用口径](使用宿主/让Agent读取自定义报告.md) |
| `--theme` | view | [换主题与主题包](交付报告/主题/) |
