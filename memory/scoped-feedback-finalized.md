---
format: concord.document/v1
id: scoped-feedback-finalized
title: 设计裁决:ScopedFeedback(progress/diagnostic)定稿为 feature 契约,roadmap 提案页删除
createdAt: 2026-07-14T06:20:18Z
createdAtSource:
  kind: first-recorded
  path: memory/scoped-feedback-finalized.md
  commit: d55d3c3ba405b5ad50a51140d312aae0933e88fd
kind: memory
memoryKind: decision
state: captured
epoch: 0
promotions: []
history: []
---
# 设计裁决:ScopedFeedback(progress/diagnostic)定稿为 feature 契约,roadmap 提案页删除

**裁决**(2026-07-14):按 owner 作用域的 `ScopedFeedback { progress(); diagnostic() }` 从「roadmap 候选提案」定稿为现行 feature 契约,单一归属 `docs/feature/experiments/library.md`「生命周期代码怎样向这次运行反馈」;`docs/roadmap/scoped-attempt-feedback.md` 整页删除(内容早已被 feature 吸收,双挂只制造「到底定稿没有」的矛盾——experiments/library.md、sandbox/library.md、eval 的 context.md 都已按定稿写,只有 experiments/cli.md 一段与 roadmap 页还说它是候选)。

roadmap 页遗留的三个「待裁决分歧」逐条裁决:

1. **签名怎么落到调用点** → ctx 注入,不加新参数:hook/setup/adapter 用 `ctx.progress/diagnostic`,eval 用 `t.progress/diagnostic`,自定义 provider 用 `options.feedback`(experiments/library.md 的表即定稿)。
2. **core 中立边界** → 是实现纪律不是契约分歧:runner 按接口分发 scope,禁止 agent==X/sandbox==Y 特判(architecture.md 既有边界),不构成推迟定稿的理由。
3. **`AgentContext.log` 去向** → 定为 `progress({ message: text })` 的别名,不是第二条通道;行为(只更新 Human active 行 detail、agent/ci 不展示、不落盘)不变。

scope 取值随同日的 lifecycle-phase-vocabulary-unification 裁决统一为 `LifecyclePhase` 闭集成员。

**与 2026-07-13 推迟裁决的关系**(attempt-phase-scoped-feedback-api-deferred):那条推迟的是**实现排期**(先跑稳内部枚举再实现公开 API),不是设计本身;其「不要顺手实现」的告诫对实现 agent 仍然有效。本裁决只解决文档侧的定稿状态矛盾:设计契约定稿、单一归属 feature,实现节奏由 plan 控制。

**How to apply**:后续不要再把 ScopedFeedback 写成「候选/提案/定稿前」;引用契约一律指 experiments/library.md。实现时警惕核心路径特判(见 07-13 条目的适用场景段)。
