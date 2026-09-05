---
format: niceeval.memory/v1
id: attempt-interruption-closes-teardown-bridge
title: Attempt 中断关闭执行桥后跳过 Agent 与 Eval Plugin teardown
createdAt: 2026-09-05
kind:
  type: problem
  state: open
promotions: []
---
# Attempt 中断关闭执行桥后跳过 Agent 与 Eval Plugin teardown

P1；2026-09-05，审查基线 `6c6d5ce39414df86be304fb3ed6923d27aae775a`。来源：Astra review，父 agent 独立复核。入口：`packages/niceeval/src/runner/attempt.ts:1104`。

Agent 或 Eval Plugin setup 已进入，作者 test 尚未完成时发生 timeout 或 Invocation 中断，已激活的 teardown 可能没有执行机会。目标顺序见 [Sandbox lifecycle](../docs/feature/sandbox/lifecycle.md#cleanup) 与 [Plugin lifecycle](../docs/feature/plugins/lifecycle.md)。

`attempt.ts` 的 Scope finalizer 调用 `assertFirst.closeEffectRequests()`。`runner/assert-first-bridge.ts` 先设置 terminalError，再拒绝等待中的 Promise；作者 body 恢复到 finally 后，Agent teardown（约 3186 行）与 Eval Plugin teardown（约 3242 行）仍通过已关闭的 requestEffect 提交，enqueue 立即拒绝。managed Attempt resource release 有独立 Scope 兜底，不能代替任意作者 callback。

待验证：安装后 consumer 使用 Direct Agent 与 Eval Plugin，setup/teardown 各写独立标记；长驻 test 分别由 timeout、SIGINT 结束。观察每个已激活 teardown 恰好一次、资源消失和原始中断结果。修复应让 cleanup obligation 在前向执行桥关闭后仍有执行 owner。

状态保持 open。本记录不代表产品 E2E 红灯、修复转绿或可靠性接管已完成。
