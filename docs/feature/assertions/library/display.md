# Assertions —— display

`exp`、`show` 与 `view` 呈现同一份闭合 Assertion、Verdict、Score 与诊断值。终端反馈只服务当前进程；frozen reader 打开 `Sample` 后，Report 通过 [Analysis Library](../../analysis/library.md) 的 `query()` 取得需要的 `SemanticFrame` 或 `DomainView`，不把 Record 文件、路径或读取 capability 交给页面。

## Attempt 摘要

Pass Eval 的区块顺序是 Execution、Verdict、检查项。Score Eval 的区块顺序是 Execution、Verdict、Score、评分项。Score 的主读数是 earned score，并同时显示 `complete`、`partial` 或 `unavailable` 的完整度。

`partial` 显示已知 earned 下界与缺失原因；`unavailable` 显示原因而不显示 `0`。低分和合法零分正常显示为数值。只有相同 rubric 下的 complete 结果参与名次或数值选择；partial 的下界只用于诊断。Verdict 的四态含义与优先级始终以 [Verdict architecture](../../verdict/architecture.md) 为准。

## 单条 Assertion

每条 Assertion 显示其 display、sealed result、coverage、limitations 与有界的 subject／evidence preview。criterion 可解释时显示 criterion 说明；unknown 或 invalid criterion 只影响该 entry，并明确显示 `unsupported` 或 `invalid`。

未配置 points 且没有失败 gate 的 Assertion 以 `recorded passed`、`recorded failed` 或 `recorded unavailable` 显示，不补 `+0`。失败 gate 仍显示 `gate failed`。配置 points 的 entry 显示 points、sealed evaluation 与实际 contribution。entry 的 points 不是 max、百分比或 Evaluation kind。

`notCalledTool` matched 时，展开区显示期望零命中与 `0 definite matches`。mismatched 时显示实际命中数、决定结果的 tool occurrence，以及命中输入内的位置。诊断采样或截断不能删除 sealed result 与决定性见证。

Assertions display 不携带 source path、origin source snapshot 或跨 family blob ref。需要源码导航时，Analysis 的 source-navigation DomainView 组合 Assertions payload 内的 `sourceSites` 与 origin Sources snapshot。
没有对应 row 或 Sources 无法形成可用值时，entry 位置显示 `unmapped`，不能猜测当前 worktree。`.orStop()` 已执行的位置可由 role 为 `stop` 的 source site 显示，不能由未保存的控制流推断。

## identity 与 route

每个 Assertion 详情实例、链接与 route 都使用持久 `entryId`。Attempt key 与 entryId 经 Report route adapter 构造 route；entryId 不直接拼 raw `AttemptId`。同名条目仍是不同详情项；name、groupPath 与 entries 位置只服务标题、分组和展示顺序。

## 相关 durable facts

Turn、conversation、diff、telemetry、timing 和 diagnostic 使用各自的固定 family。页面只呈现 Analysis 已关闭的值与 Calculation results，并包装为闭合的 report document；展开详情不能重新读取 Record、请求网络或执行 criterion。

颜色、图标或悬停提示不能是状态的唯一表达。展示前剥除 ANSI 与不可打印控制字节，按显示宽度截断预览，并明确标记省略。原始大文本只在相应 owner 的 own blob closure 中；详情只保留有界入口。

## 相关阅读

- [Assertions architecture](../architecture.md)
- [Assertion evidence](../architecture/evidence.md)
- [Source sites](../architecture/source-sites.md)
- [Record architecture](../../record/architecture.md)
- [Verdict architecture](../../verdict/architecture.md)
- [Analysis Library](../../analysis/library.md)
- [Reports 架构](../../reports/architecture.md)
- [Reports CLI](../../reports/cli.md)
