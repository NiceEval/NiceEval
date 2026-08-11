# Agent-as-Judge —— 生命周期

1. 作者调用 recipe 时登记 Assertion，并冻结材料引用、rubric、callsite 和 source order。
2. Runner 检查 capability、profile 与 workspace snapshot 授权。
3. 独立 Agent Session 读取交付材料，按自己的运行条件调查并返回 Decision。
4. collector 验证 finite `[0,1]` measurement，写入同一 AssertionResult。
5. Pass 或 Score projection 结算，读取面离线显示结果。

裁判 Agent 的 cleanup 在自己的 Scope 中进行。普通 cleanup diagnostic 不自动作废 Score grading；被测 Attempt 的 Verdict 不能用来猜测裁判结果。
