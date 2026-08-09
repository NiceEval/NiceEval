# Sample：从当前 Record 选择分析范围

[Record](../record/README.md) 保存可以编辑的当前结果。Sample 从一个已经打开的 Record 中选择 Run，形成 Reports 和脚本可以继续组合的 core-only 内存值。

Sample 不写回 Record，也不是持久化文件。再次执行选择时，它会读取 Record 当时的核心身份、membership 和引用；业务通道等 ReportPlan 形成后才按需读取。

## 核心心智

选择分两步完成：

1. `selectSample()` 明确选择 Run，并从各 Run 的 expected membership 建立分母。
2. `narrowSample()` 在既有分母上排除不需要的 Experiment、Eval、Run 或 slot。

每个分母项都保留明确状态：

| 状态 | 含义 |
|---|---|
| `included` | slot 有合法 Member，能够读取它采用的 Attempt |
| `not-recorded` | expected slot 没有 Member |
| `invalid` | Member、Attempt 核心或引用矛盾，Record reader 已给出具名 issue |
| `excluded` | 调用方通过 selector 排除了该项 |

`not-recorded` 只表示 expected membership 中缺少 Member。它不表示证据没有采集，也不用于掩盖损坏文件。

## 选择必须明确

Sample 不提供隐含的“当前结果”。调用方必须选择以下一种输入：

- `runs`：给出一个或多个明确的 `runId`；
- `latest`：使用具名 policy，从每个匹配的 Experiment 中选择最后完成的 Run。

`latest` 只考虑带 `completedAt` 的 Run，并在每个目标 Experiment 内按 `completedAt`、`runId` 排序。调用方给出 Experiment 列表时，它就是完整目标集合；省略时目标来自全部可读 Run 核心。目标为空或任一目标没有完成 Run 都明确失败，不缩小比较组。unfinished Run 只能通过 `runs` 显式选择。

## 数据边界

Sample 保存普通、已校验的核心数据和 Record issues。它不保存文件句柄、读取器、业务 facts、隐藏查询或延迟 selector。

carried 与 accepted Member 保留源 Attempt 引用。用户修改源 Verdict、Usage 或 artifact 后，下一次 ReportInput 构造会读取修改后的值；源 Attempt 缺失时，该 slot 是 `invalid`，不是 `not-recorded`。

Sample 不读取通道。一个通道 unknown、retired、缺失或损坏，不会让整个 slot 自动变成 `invalid`；slot 的 `invalid` 只描述核心 membership、identity 与引用错误。ReportPlan 形成后，composition adapter 才把被请求通道的 `ChannelRead` 放进 ReportInput。

## 范围

Sample 包含：

- 明确 Run 或具名 policy 的选择；
- expected membership 分母；
- included、not-recorded、invalid、excluded 四种范围状态；
- 对既有 Sample 的纯内存收窄；
- included Attempt 的核心身份、origin 与 locator。

Sample 不包含：

- 跨 Record 合并；
- 可持久化的 Sample 包；
- 内容摘要、producer 真实性或编辑历史；
- 报告布局、指标缓存或 renderer 状态。
- 任何 Run 或 Attempt 业务通道值。

## 入口

- [Library](library.md) —— 选择器、Sample 形状和构造入口。
- [局部补跑](use-case/partial-rerun.md) —— executed、carried 与 accepted 怎样进入同一分母。
- [收窄样本](use-case/收窄样本.md) —— 怎样从既有 Sample 排除不需要的成员。
- [Reports](../reports/README.md) —— 怎样呈现和导出 Sample。
