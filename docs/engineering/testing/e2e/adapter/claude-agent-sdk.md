# Claude Agent SDK converter 仓库

## adapter-claude-agent-sdk-live-compatibility

Repo ID 是 `adapter/claude-agent-sdk`。它在 host 上锁定
`@anthropic-ai/claude-agent-sdk@0.3.226`。它声明 Node 22、external network 与 main / nightly /
release lanes。它且仅声明 `ANTHROPIC_API_KEY` 与 `ANTHROPIC_BASE_URL` 两项 secret。
它验证候选包公开的 `createClaudeSdkEventStream()` 能消费真实 SDK 的原生 `SDKMessage`；它不新增
NiceEval public factory。

## 受限 DirectAgent consumer

Experiment 内的 consumer 调用 SDK `query()`，并把 `ctx.signal` 转成该锁定 `Query` 的
`interrupt()`。它把 reducer 已捕获的 session id 交给 `ctx.session.capture()`。下一轮会把
`ctx.session.id` 作为 SDK `resume` 传回。每一条原始 `SDKMessage` 不改写地交给候选包的
`createClaudeSdkEventStream()`；`driveFrameStream()` 负责产生标准事件、usage 与终态。consumer
不构造 `StreamEvent`，不手写字段映射，也不自行计算 canonical tool、usage 或 status。

锁定 SDK 的 `Query` 明确公开 `interrupt()` 与 `close()`：前者由 abort listener 调用，后者在
normal 和 exceptional path 的 `finally` 中结束底层 SDK 查询。任一 cleanup 错误继续向外传播。

本 Repo 不起 HTTP server，不使用 MCP，也不运行 live HITL。`input.requested` 是应用把
`canUseTool` 停轮编排成 NiceEval pause 的职责，不属于 converter。converter 只读取并归一原生
`tool_use` / `tool_result` 配对、`system/init` session id、`result` usage 与 `result` 终局。

`query()` 固定只暴露原生 `Bash`：`tools: ["Bash"]`、`allowedTools: ["Bash"]`、`permissionMode:
"dontAsk"`、空 `settingSources` 与 strict MCP config。Read、Write 和其它工具不在可用工具集合中，
不是依赖提示词的尽力约束。

原生 test 为每一次 invocation 在系统 temp 内新建独立 HOME 与 workspace，并把两个绝对路径注入
进进程；它们不进入 `.niceeval` artifact。`withProcess({ processGroup: true })` 启动安装后的
`niceeval exp`，body 内等待 `handle.done` 收据。Testkit 的 `dispose()` 终止并核验 owned-process
group，确保没有残留子进程。

## Eval 闭环与公开读回

唯一 `bash-session` Journey 的首轮要求真实模型用原生 Bash 执行一条带随机 marker 的安全
`printf`。它断言 canonical `shell`、精确 command input 与 `completed`；这个 completed 状态同时证明
`tool_use_id` 和 `tool_result` 已配对。首轮和 resume 轮的 input / output usage 都必须为正，
`t.sessionId` 必须已经由 `system/init` 捕获。第二轮要求模型引用首轮随机哨兵，证明 SDK `resume`
真正取回首轮会话。

测试只通过公开 CLI 的 `show`、`show --json` 和代表 Report 的 execution / timing target Page 读回通过结果。
target Page 使用 `show @locator --report <fixture-module> --page <route>`。
它检查 session assertion、完整原始 `Bash` 名和 marker，不读取私有结果文件。
Experiment 固定 `attempts: 1`，Vitest `retry: 0`，不配置 Judge。缺少任一声明 secret
是 configuration failure，不会 skip。
