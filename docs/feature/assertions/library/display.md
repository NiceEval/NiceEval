# Assertions —— display

`exp`、`show` 与 `view` 呈现同一份 assertion、Verdict 和诊断值。终端反馈只服务当前进程；frozen reader 形成的 Sample 保留核心和分母，Report 的 `RecordProjection` 再声明需要读取的业务 Attachment。

## Pass Eval

Pass 的 Attempt 区块顺序为 Execution、Verdict、检查项。每条检查项显示 label 或 key、evaluation、
evidence、必要的 threshold 与 Issue。

measurement 只作诊断显示：`0.73, required >= 0.8, mismatched`。它不是 score，Pass 页面不显示
累计 score、百分比或贡献项。

## Score Eval

Score 的 Attempt 区块顺序为 Execution、Score、评分项。每条评分项显示 `recorded`、实际贡献，例如
`+2` 或 `+4`，以及 threshold condition 或 stop cause。

Score 页面不显示 Verdict、Pass / Fail、总分、max、百分比或其它旧式数值单位。未配置 `.score()` 的
Assertion 显示 `recorded`，不显示 `+0`。没有 contribution 时，正式 score 为 `0`，并提示
“没有贡献分数的评分项”。

不可排名的 Score grading 显示 `partial score not ranked`、partial score 与 Issue。正常 `.orStop()`
显示 stop cause，但仍显示可排名的正式 score。

## 同一投影

## 单条 Assertion

每条显示以下稳定信息：

~~~text
gate  package manifest has the required entry
      includes("exports") · expected match · received missing
~~~

- 标题优先使用分组路径；没有分组时使用 `name`。
- `decision`、派生的行状态、`detail` 和可用的 expected / received 进入同一条或相邻文本行。
- `gate` 与 `soft` 按 `score >= threshold` 显示 passed 或 failed；`observe` 只显示 score，不补猜行状态。
- `result.state: "unavailable"` 显示 `reason` 和证据摘要，不显示零分、失败值或实得分。
- conditional award 显示 available 与由 `available * score` 派生的实得分；direct score 显示持久化 points。

source 信息存在时，详情页链接到项目相对路径和行列。没有 source 的条目进入 unmapped 区，不猜测源码位置。

`stopOnFailure` 是 producer 控制流，不进入稳定投影。若停止后续测试本身需要解释，由独立 diagnostic 或 Run 级观测表达，Assertion 详情不从条目反推。

## Turn、conversation 与相关 Attachment

Turn 详情来自 conversation Attachment。它显示用户输入、Agent 文本、tool、阶段和可用的 usage；每项都保留自己的采集与解码状态。

diff、telemetry、timing 和 diagnostic 使用各自 Attachment 的数据。页面只能呈现声明的 projected values 与 Calculation results，并把它们包装成闭合的 `niceeval.report-document/v1` semantic document；展开详情不能重新读取 Record 或请求网络。

## 状态文字

| 状态 | 文字要求 |
|---|---|
| partial | 显示 observed、denominator 和 partial。 |
| unavailable | 说明未采集或不适用的原因。 |
| unsupported | 说明当前 reader 不支持对应 Attachment schema。 |
| invalid | 显示具名 issue，并让需要它的详情失败。 |

颜色、图标或悬停提示不能是这些状态的唯一表达。图表必须提供相同读数的文字或表格。

## 文本安全与长度

展示前剥除 ANSI 控制序列与不可打印控制字节，再把换行、回车和制表整理为可读文本。截断按显示宽度完成，并显式标记省略；不能让控制序列或超长原始值破坏终端布局。

原始大文本留在 Attempt-owned blob。详情页使用有界预览和明确的下载或定位入口，不将完整文件放入摘要行。

## 相关阅读

- [Assertions 架构](../architecture.md)
- [Assertion 证据](../architecture/evidence.md)
- [Reports 架构](../../reports/architecture.md)
- [Reports CLI](../../reports/cli.md)
