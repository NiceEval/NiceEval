---
relations:
  - role: supports
    target: docs/feature/adapters/architecture/README.md#human-live-detail
---

# ACTIVE 进度隐藏用户消息与工具细节

## Problem

从安装后的 `niceeval exp` 运行 Codex 等支持原生增量事件的适配器时，Human TTY 的 ACTIVE 区只显示笼统阶段或截断的 turn 摘要，看不到 Runner 已知的完整 user message，也看不到适配器已收到的 command/tool 细节。用户因而无法在长时间运行过程中判断当前请求和动作是否正确。

## Root cause

Runner 把 `progress()` 实现为 `log()` 的别名，使只应短命显示的 user/tool 文本会进入 timeout breadcrumb；为避免持久化泄漏，上层只敢投影短摘要。与此同时，Codex app-server 的长期 driver 捕获了首次 send 的反馈闭包，缺少每个物理 send 的订阅与原生 thread/turn 身份隔离；其它适配器也没有一条按协议能力区分的 live projection 边界。

## Regression proof

修复必须从安装后的 CLI 真实 PTY 证明 `user: <sentinel>` 与可信 `tool: <sentinel>` 在 candidate 仍运行时已经出现，而不是进程结束后从 transcript 回填。确定性的 CLI、Lifecycle、Report 与本地 UI Message Stream owner 负责 Testkit 和公共显示边界；Codex、Claude Code 的真实 adapter owner 只在明确费用授权后执行。所有 owner 都不得读取 `.niceeval/` 私有产物。

## Repair boundary

Runner 统一投影其发送时已知的 `user:`，并在唯一 ACTIVE 出口做 secret redaction、终端控制字符清理、空白归一与 UTF-8/grapheme 有界化；`progress` 保持短命，只有显式 `log` 可进入 timeout breadcrumb。适配器只投影原生协议能证明属于当前物理 send 且输入已经完整的 tool/action；仅在结束后获得 transcript 的适配器不伪造实时细节。

## Phase transition ordering

`attempt:phase` 会清空旧阶段的 detail。为在 send 期间投影 `agent.run` 而新增阶段事件时，必须先进入阶段，再发布本轮 `user:`，然后调用 Adapter；send 结束后才恢复外层阶段。若先发布 user progress，紧接着的阶段事件会在下一帧前把它清空。此时 PTY 可以正常输出工具活动并以零退出，但 user sentinel 永远不可见；延长等待或修改 PTY 夹具不能修复这个顺序错误。
