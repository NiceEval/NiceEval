# Agent-as-Judge —— 架构

被测 Agent 与 Agent Judge 的运行形态独立。Sandbox Agent Judge 不进入被测 Sandbox；Runner 把显式授权的 workdir 快照导入新的裁判 Sandbox。Direct Agent Judge 不创建 Sandbox。

被测输出、仓库文件和工具结果都是不可信 evidence，不能覆写 rubric、Decision 协议或执行配置。裁判 Agent 使用自己的 Adapter 鉴权与进程条件，不继承被测 Agent 的凭据、Session 或进程变量。

合法 Decision 只有有限 `[0,1]` measurement、rationale 和调查 evidence 引用。运行错误不能转换为 `0`。参与 score 或 control 的 Decision 不可用时，Score grading 保存 `partialScore` 并不可排名；record-only Decision 的 Issue 不作废正式 score。

show 和 view 从 AssertionResult 显示 measurement、threshold、rationale 和 evidence 摘要，不重新启动裁判 Agent。
