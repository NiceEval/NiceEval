# Assertions —— display

`exp`、`show` 与 `view` 呈现同一份 Assertion、Verdict、Score 与诊断值。终端反馈只服务当前进程；frozen reader 形成 Sample 后，Report 的 `RecordProjection` 声明需要的业务 Attachment。

## Attempt 摘要

Pass Eval 的区块顺序是 Execution、Verdict、检查项。Score Eval 的区块顺序是 Execution、Score status、Score、评分项。Score 的主读数是 earned score；Score status 使用 scored、skipped 或 errored，通用摘要把 scored 映射为 passed。

Score 显示 `complete`、`partial` 或 `unavailable`。partial 显示已知 earned 下界与缺失原因；unavailable 显示原因而不显示 `0`。只有 scored + complete 参与名次或数值选择。raw legacy failed 只在 Attempt 审计详情显示为 historical verdict claim。

## 单条 Assertion

每条 Assertion 显示其 display、sealed result、coverage、limitations 与有界的 subject / evidence preview。criterion 可解释时显示 criterion 说明；unknown 或 invalid criterion 只影响该 entry，并明确显示 `unsupported` 或 `invalid`。

未配置 points 的 Assertion 显示 `recorded`，不显示 `+0`。配置 points 的 entry 显示 points、其 sealed evaluation 与实际贡献。entry 的 points 不是 max、百分比或 Evaluation kind。

Assertions v1 的 display 不携带 source path、origin source snapshot 或跨 Attachment blob ref。需要源码导航时，Report
必须显式声明 Assertions、source-sites 与 origin Sources 三个 projection；否则 entry 保持 `unmapped`，不能猜测当前
worktree 位置。`.orStop()` 的已执行位置和 `continued`、`stopped`、`interrupted` 结果从
[source-sites mapping](../architecture/source-sites.md) 显示，不再只靠 diagnostic 推断。

## identity 与 route

每个 Assertion 详情实例、链接与 route 都使用持久 `entryId`。Attempt key 与 entryId 经 Report route adapter 构造 route；entryId 不直接拼 raw `AttemptId`。同名条目仍是不同详情项；name、groupPath 与 entries 位置只服务标题、分组和展示顺序。

## 相关 Attachment

Turn、conversation、diff、telemetry、timing 和 diagnostic 使用各自的 Attachment。页面只呈现声明的 projected values 与 Calculation results，并包装为闭合的 `niceeval.report-document/v1`；展开详情不能重新读取 Record、请求网络或执行 criterion。

颜色、图标或悬停提示不能是状态的唯一表达。展示前剥除 ANSI 与不可打印控制字节，按显示宽度截断预览，并明确标记省略。原始大文本留在 Attempt-owned blob，详情只保留有界入口。

## 相关阅读

- [Assertions 架构](../architecture.md)
- [Assertion evidence](../architecture/evidence.md)
- [Reports 架构](../../reports/architecture.md)
- [Reports CLI](../../reports/cli.md)
