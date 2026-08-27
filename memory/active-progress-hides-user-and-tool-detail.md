---
format: niceeval.memory/v1
id: active-progress-hides-user-and-tool-detail
title: ACTIVE 进度隐藏用户消息与工具细节
createdAt: 2026-08-27T11:33:07+08:00
kind:
  type: problem
  state: resolved
  resolution:
    kind: fixed
    proof:
      - "E2E red: the installed-candidate local-protocol inverse removed Runner user projection and failed because the live PTY showed only the old turn summary plus tool detail, never user: local-live-user-sentinel."
      - "E2E red: pnpm e2e test --repo eval -- --run test/active-progress-redaction.test.ts showed active-secret-c0 and the C1 OSC payload in the live dashboard instead of two <redacted> values."
      - "E2E green: installed candidates passed cli/live-pty, eval/active-progress-redaction, adapter/local-protocol/live-progress, adapter/codex-cli/live-progress, and the two-turn adapter/claude-code/live-progress owners; the Testkit PTY lifecycle source also passed 7/7 against its built package."
promotions:
  - kind: feature
    current:
      - docs/feature/adapters/architecture.md#human-live-detail
    history: []
---
## Problem

从安装后的 `niceeval exp` 运行 Codex 等支持原生增量事件的适配器时，Human TTY 的 ACTIVE 区只显示笼统阶段或截断的 turn 摘要，看不到 Runner 已知的完整 user message，也看不到适配器已收到的 command/tool 细节。用户因而无法在长时间运行过程中判断当前请求和动作是否正确。

## Root cause

Runner 把 `progress()` 实现为 `log()` 的别名，使只应短命显示的 user/tool 文本会进入 timeout breadcrumb；为避免持久化泄漏，上层只敢投影短摘要。与此同时，Codex app-server 的长期 driver 捕获了首次 send 的反馈闭包，缺少每个物理 send 的订阅与原生 thread/turn 身份隔离；其它适配器也没有一条按协议能力区分的 live projection 边界。

## Regression proof

修复必须从安装后的 CLI 真实 PTY 证明 `user: <sentinel>` 与可信 `tool: <sentinel>` 在 candidate 仍运行时已经出现，而不是进程结束后从 transcript 回填。确定性的 CLI、Lifecycle、Report 与本地 UI Message Stream owner 负责 Testkit 和公共显示边界；Codex、Claude Code 的真实 adapter owner 只在明确费用授权后执行。所有 owner 都不得读取 `.niceeval/` 私有产物。

## Repair boundary

Runner 统一投影其发送时已知的 `user:`，并在唯一 ACTIVE 出口做 secret redaction、终端控制字符清理、空白归一与 UTF-8/grapheme 有界化；`progress` 保持短命，只有显式 `log` 可进入 timeout breadcrumb。适配器只投影原生协议能证明属于当前物理 send 且输入已经完整的 tool/action；仅在结束后获得 transcript 的适配器不伪造实时细节。
