---
name: ui-message-stream-pending-call-is-started-not-executed
description: "裁决(2026-08-09): UI Message Stream approval-requested 表示逻辑调用已宣布但副作用未执行；等待轮先发 started+input.requested，resume 只补同 call 的 completed/output 或 rejected/无 output"
metadata:
  type: design-decision
---

# UI Message Stream pending call 的公开语义

`approval-requested` 已包含稳定的 tool call ID、名字与完整 input，所以调用在协议
上已经被模型宣布；但人工批准前工具副作用尚未执行。把它完全隐藏到批准后，会让
等待轮无法解释「用户正在批准什么」；把它直接记 completed，又会谎报执行成功。

裁决是等待轮按顺序公开一次 `operation.started`，再公开 `input.requested`，不发
`operation.finished`。批准 resume 只给同一 call ID 补 completed 与 output；拒绝
只补 rejected，不带 output。历史重发沿用会话簿记，不重复 start；完成后的新 user
send 新建本条消息簿记。

这里的 `started` 是「逻辑调用已宣布」，不是「副作用已经开始」。公开 execution、
事实派生与断言都必须保留这一区别。确定性 owner 在
`e2e/adapter/local-protocol/test/approval.test.ts`，契约在
`docs/feature/adapters/sdk/ai-sdk/README.md`。

该外部可观察语义在实现验收前经过独立只读 `design_grill`；结论为 PASS。
