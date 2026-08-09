# Assertion 与 Turn 的展示

<code>exp</code>、<code>show</code> 与 <code>view</code> 呈现同一份 assertion、Verdict 和诊断值。终端反馈只服务当前进程；停稳后的 Sample 保留核心和分母，ReportPlan 再声明需要读取的业务通道。

## 两种信息密度

| 入口 | 目的 | 显示内容 |
|---|---|---|
| <code>exp</code> 的完成反馈和列表页 | 快速定位问题 | Verdict、首个相关错误或 Assertion 摘要，以及其余数量。 |
| <code>show</code>、<code>view</code> 的 Attempt 详情 | 解释本次 Attempt | 所有 Assertion、分组、材料预览、诊断、usage、timing、conversation 与 diff 的可用部分。 |

通过项在概要中不逐条展开。详情页按 <code>groupPath</code> 和声明顺序展示所有条目，并保留 <code>unavailable</code>。

## 概要选择

概要按以下顺序选择一条主要说明：

1. 执行错误或 Runner 诊断。
2. 使 Verdict 为 <code>errored</code> 的非 optional unavailable Assertion。
3. 使 Verdict 为 <code>failed</code> 的首个 gate；strict policy 下可选择首个相关 soft。
4. 计分制中首个丢分的条目。

其它相关条目显示为数量，例如 <code>+2 more</code>。概要不从 Assertion 名称拼接长列表，也不把未知、未采集或损坏数据隐藏为通过。

## 单条 Assertion

每条显示以下稳定信息：

~~~text
gate  package manifest has the required entry
      includes("exports") · expected match · received missing
~~~

- 标题优先使用分组路径；没有分组时使用 <code>name</code>。
- <code>severity</code>、<code>outcome</code>、matcher 摘要和可用的 expected / received 进入同一条或相邻文本行。
- <code>unavailable</code> 显示 <code>reason</code> 和证据摘要，不显示零分或失败值。
- <code>stopOnFailure</code> 只在详情中说明后续测试代码被停止。
- 计分制同时显示 <code>points</code> 与 <code>pointsAvailable</code>。

source 信息存在时，详情页链接到项目相对路径和行列。没有 source 的条目进入 unmapped 区，不猜测源码位置。

## Turn、conversation 与相关通道

Turn 详情来自 conversation channel。它显示用户输入、Agent 文本、tool、阶段和可用的 usage；每项都保留自己的采集与解码状态。

diff、telemetry、timing 和 diagnostic 使用各自 channel 的数据。页面只能呈现 ReportInput 已交付的事实，不能为展开详情重新读取 Record 或请求网络。

## 状态文字

| 状态 | 文字要求 |
|---|---|
| partial | 显示 observed、denominator 和 partial。 |
| unavailable | 说明未采集或不适用的原因。 |
| unsupported | 说明当前 reader 不支持对应 channel。 |
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
