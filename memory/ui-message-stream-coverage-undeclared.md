---
format: concord.document/v1
id: ui-message-stream-coverage-undeclared
title: ui-message-stream-coverage-undeclared
createdAt: 2026-07-19T08:35:09+08:00
createdAtSource:
  kind: first-recorded
  path: memory/ui-message-stream-coverage-undeclared.md
  commit: 56e51eec8d972972b4f6c74eb82a2a9b2d3e1a5c
description: 内置 uiMessageStreamAgent 没有声明 EvidenceCoverage，让所有作用域断言在真实协议下
  unavailable→errored——e2e/adapter/ai-sdk 的 hitl-approval/tool-call 首跑全 errored
  才发现
kind: memory
memoryKind: problem
state: resolved
epoch: 0
promotions: []
history: []
resolution:
  reason: 正文或对应 INDEX 明确使用“已修/已修复”；这是作者声明的事实，不等同于本视图验证证明。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: "- 已修
      [ui-message-stream-coverage-undeclared](ui-message-stream-coverage-undecl\
      ared.md) — 内置 uiMessageStreamAgent 没声明 EvidenceCoverage,真机跑
      e2e/adapter/ai-sdk 时 succeeded()/notCalledTool()/noFailedActions() 全部
      unknown→errored(不是断言写错);修为补 coverage(complete + usage
      unavailable)(`src/agents/ui-message-stream.ts`)"
    proof: []
    source:
      path: memory/INDEX.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:67d7d964587394bf0db4632f93541d005dd00854588493e9c63fa573506473d5
---

**现象**：`e2e/adapter/ai-sdk`（AI SDK 三接入面 E2E 仓库）用内置 `uiMessageStreamAgent` 真机跑
`ui-message-stream/tool-call` 与 `ui-message-stream/hitl-approval` 两条 Eval，`--output ci`
报 6 条 `errored`（不是 `failed`），reason 都是 `coverage:actions=unknown` /
`coverage:status=unknown`——`notCalledTool(calculate)`、`succeeded()`、`noFailedActions()`
全部命中。`niceeval show @<locator>` 显示 6 passed / 3 unavailable：断言本身逻辑没错，事件流里
明明有完整的 tool-call/result 与终态，但框架判定"证据不可信"。

**根因**：`src/agents/ui-message-stream.ts` 的 `defineAgent({...})` 调用没有 `coverage`
字段，`docs/feature/adapters/architecture/evidence.md` 的约定是"整个 Agent 不声明时，全部
通道视为 unknown"。`src/scoring/scoped.ts` 里 `succeeded()`/`parked()` 对 `status` 通道是
**无条件**先查 coverage gap（`if (gap) return gap`），不管实际 `ctx.status` 是什么都先判
unavailable；负断言（`notCalledTool`）同理对 `actions` 通道。`uiMessageStreamAgent` 消费的是
`readUIMessageStream` 归约后的**完整**协议帧（等价于 `fromAiSdk`/`aiSdkAgent` 消费的 AI SDK
`steps`/`content`，两者是同一份底层 tool-call/result 状态，只是走 HTTP SSE 而不是进程内），
后者已经声明 `coverage: completeCoverage`（`src/agents/ai-sdk.ts`），前者却漏了——是官方
适配器遗漏声明，不是协议本身证据不完整。

**修法**：`src/agents/ui-message-stream.ts` 补 `coverage: { ...completeCoverage, usage:
{ status: "unavailable", reason: "..." } }`——events/actions/messages/status/data 全部
`complete`，只有 `usage` 例外（协议帧本身不带 token 计数，声明 unavailable 而不是硬编 unknown
或造假 complete）。已加回归测试（`src/agents/ui-message-stream.test.ts` 新增一条
`coverage` 断言用例）、`docs/engineering/testing/unit/adapters/cases.md` 补场景行、
`pnpm run typecheck` 与该文件单测全绿。

**适用场景**：任何"官方 SDK 适配器"新增或改动时，检查 `defineAgent`/`defineSandboxAgent` 调用
是否带 `coverage` —— 漏了不会报类型错误（字段可选），只会在真机跑负断言/`succeeded()`/
`noFailedActions()` 这类依赖 coverage 的作用域断言时全部 errored，容易被误判成"Eval 写错了"
而不是"Agent 没声明覆盖"。协议本身不提供的通道（如本例的 usage）如实标 `unavailable`，不要
为了"看起来更完整"就整体套 `completeCoverage` 而漏掉例外通道。
