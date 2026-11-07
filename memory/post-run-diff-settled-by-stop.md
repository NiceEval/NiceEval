# 后续 orStop 提前结算 post-run Sandbox Assertion

NiceEval-Eval 的 OpenSandbox 实跑中，changedPaths 在完整 agent send-window diff 已封口后仍为 source-unavailable。公开 diff 只包含允许的 experiments/local.ts；稳定版与 Canary 被测候选均出现，外层运行时是本地 NiceEval 候选。

现有契约规定 Sandbox 归因 Assertion 等作者 settle 后，由共享的冻结 workspace diff 求值；它们不提供 orStop。源码调查发现，后面普通 Assertion 的 orStop 调用 settleThrough，把此前所有 entry（包括 post-run sandbox-result）提前求值并记忆为 unavailable，此时 late.diff 仍 pending。最终 seal 不重新求值，因此与 complete File Changes 不一致。

修复保持已有契约：控制流 barrier 只按登记顺序结算可在作者阶段求值的 entry，sandbox-result 保留到最终 seal；不让 deferred entry 伪装为 unavailable，也不改写历史结果。以已有 Sandbox Assertion Eval owner 加入真实成功 orStop barrier，预期完整归因断言仍使 Eval passed。先取得同一 owner 的安装后候选红灯，再修生产代码并完成接管。
