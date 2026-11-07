# Agent-as-Judge —— 生命周期

1. 作者用具名 Material View 建立 Judge Check；调用 Agent runtime 时登记 Assertion。
2. Runner 查找 source、执行 selector 并核对三层 coverage，seal MaterialBindingManifest；required 材料不可用时不启动 Agent。
3. Runner 检查 Agent identity、受管 tool、network 与 workspace snapshot capability，并建立独立 Judge Session。
4. Investigation broker 把已授权材料和 workspace copy 交给 Agent，逐项封口受管调查 input/output。
5. Collector 验证 finite `[0,1]` measurement、公开 rationale 与 evidence refs，seal Judge Evaluation。
6. Grading Claim 应用 Pass 或 Score projection；读取面从 sealed 结果离线显示。
7. Judge Evaluation 封口后，Runner 终止独立 Session 并删除临时 workspace。

裁判 Agent 的 cleanup 在自己的 Scope 中进行。普通 cleanup diagnostic 不自动作废 Score grading；封口前丢失必要 investigation evidence 会使 Evaluation unavailable。被测 Attempt 的 Verdict 不能用来猜测裁判结果。
