---
title: 'scope-status 失败在 Human 面板退化为 error: failed'
severity: 'major'
---

## Expected Behavior

Pass Eval 因 `turn.succeeded().orStop()` 的 scope-status 断言失败时，Human FAILURES 行应显示失败的具名检查和可行动原因；若该 Turn 含 `error` 事件，公开详情还应能读到对应 conversation error。

## Current Behavior

`failureDetailFromResult()` 只会从带 `factId` 的 Fact/use 形成 `PrimaryFactSummary`。scope-status 断言没有可进入该分支的 Fact identity，于是 failed terminal 既没有 fact，也没有 `AttemptError`，reason 最终退化为 verdict 字面值。TTY 只显示 `error: failed`，无法区分 Agent Turn 失败、普通命令断言失败或其它 scope-status 失败。

## Possible Solution

让 scope-status 等非 Fact assertion 形成自己的稳定 failure summary，或在 sealed assertion readback 中提供统一的 primary failing assertion 投影；Human feedback 应消费它，不把 `result.verdict` 当失败原因。

## Minimal Reproducible Example

Eval 执行 `await t.send(...).then((turn) => turn.succeeded().orStop())`，令 Adapter 返回 `{ status: "failed", events: [{ type: "error", message: "native failure detail" }] }`。运行 Human TTY `niceeval exp`，观察 FAILURES 行只显示 `error: failed`。

## Context

2026-08-21 在 MemoryBench `compare/codex-mempal` 的 `react-tooltip/pr-1269` live 运行中观察到。相邻的 Codex app-server execution error 能显示完整 `Codex app-server turn failed: ...`，说明这是 failed assertion 投影与 errored execution error 两条通道的差异。
