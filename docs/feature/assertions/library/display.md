# Assertions —— display

`exp`、`show` 与 `view` 呈现同一份闭合 Assertion、Verdict、Score 与诊断值。终端反馈只服务当前进程；frozen reader 打开 `Sample` 后，Report 通过 [Analysis Library](../../analysis/library.md) 的 `query()` 取得需要的 `SemanticFrame` 或 `DomainView`，不把 Record 文件、路径或读取 capability 交给页面。

## Attempt 摘要

Pass Eval 的区块顺序是 Execution、Verdict、检查项。Score Eval 的区块顺序是 Execution、Verdict、Score、评分项。Score 的主读数是 earned score，并同时显示 `complete`、`partial` 或 `unavailable` 的完整度。

`partial` 显示已知 earned 下界与缺失原因；`unavailable` 显示原因而不显示 `0`。低分和合法零分正常显示为数值。只有相同 rubric 下的 complete 结果参与名次或数值选择；partial 的下界只用于诊断。Verdict 的四态含义与优先级始终以 [Verdict architecture](../../verdict/architecture.md) 为准。

## 单条 Assertion

每条 Assertion 显示其 display、sealed result、coverage、limitations 与有界的 subject／evidence preview。criterion 可解释时显示 criterion 说明；unknown 或 invalid criterion 只影响该 entry，并明确显示 `unsupported` 或 `invalid`。

未配置 points 且没有失败 gate 的 Assertion 以 `recorded passed`、`recorded failed` 或 `recorded unavailable` 显示，不补 `+0`。失败 gate 仍显示 `gate failed`。

配置 points 的 entry 不使用 `soft passed` 或 `soft failed`。标题先显示 sealed result，再分别显示 `weight <points> pts` 与 `earned <earned> pts`。measurement 同时显示实际测量值与 threshold。contribution unavailable 时显示具名原因，不补成 `earned 0 pts`。entry 的 points 是计分系数，不是 max、百分比或 Evaluation kind。

`notCalledTool` matched 时，展开区显示期望零命中与 `0 definite matches`。mismatched 时显示实际命中数、决定结果的 tool occurrence，以及命中输入内的位置。诊断采样或截断不能删除 sealed result 与决定性见证。

Web 详情把 matcher 自身作为可展开行：`matched`、`mismatched` 与 `unavailable` 分别使用成功、失败与警告色，并在每行视觉显示状态文字；颜色、图标或无障碍名称都不能成为状态的唯一表达。

点击 matcher 后按诊断语义展示，而不是固定摊开通用对象：command 显示命令、实际退出码与预期退出码；tool collection 显示计数约束、确定命中数、检查数与候选调用分支；比较与阈值显示有效的实际值和预期值。`kind`、布尔 `outcome` 与 `expected.kind` 等机器路由字段不进入主视图，source、criterion、observed、policy expected 与 explanation 的完整闭合值仍收进技术详情。

generic input 的 scalar 直接显示。array 默认只显示 `Array(n)`，展开后按原顺序编号，每个元素保留独立视觉边界；object 字段保持同一元素内的结构。`satisfies` 等 opaque predicate 只显示作者命名、sealed result 与 input 摘要，不编造 expected、reason 或 witness。完整闭合值继续收进默认折叠的技术详情。

组合 matcher 按原声明层级展开，每个 `and`、`or`、`not` 与叶子 matcher 都携带自己的 sealed 状态，因此父组合命中时仍能辨认没有命中的分支。

Tool matcher 的候选 occurrence 也使用同一分支树：候选标题按检查顺序显示 `Call N`，可从闭合诊断确定时同时显示实际工具名；内部 occurrence identity 只作为技术 locator，不作为候选标题。调用名称、input、output、status 与命令 token 等子 matcher 各自显示状态，折叠态内联显示可用的 expected、observed 或 unavailable reason，展开后保留完整诊断事实与调用 locator。未知或第三方 matcher 使用 generic fallback，不因没有专用展示而丢失输入和闭合诊断。

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
