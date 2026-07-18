# claude-code 仓库

仓库 ID `claude-code`，group `sandbox`，`e2e.json.requires.docker: true`。被测对象是 `claudeCodeAgent()` 在 Docker Sandbox 里的完整生命周期：安装、扩展装配、真实 coding 任务、transcript 采集与会话续接（契约见 [Claude Code 契约页](../../../feature/adapters/sdk/claude-code/README.md)）。

## Eval 闭环

| 协议行为 | Eval 断言（只读事件流） |
|---|---|
| coding 任务工具轨 | 真实任务下 transcript JSONL 归一出文件与 shell 工具事件，按 `tool_use.id` / `tool_result.tool_use_id` 配对 |
| Skills | 挂载的 Skill 被使用时产生 `skill.loaded` 一等事件 |
| MCP | stdio 与远程 HTTP 两种形态的 server 都能被调用，工具以 `mcp__<server>__<tool>` 命名出现；反例断言未挂载的 server `notCalledTool` |
| Plugins | marketplace 安装的 Plugin 行为在事件流中可观察 |
| settingsFile | `permissions.deny` 关闭 WebSearch / WebFetch 后，反例断言 `notCalledTool` 的 `web_search` / `web_fetch` |
| 会话 | 原生 resume ID 续接，第二轮能引用首轮事实 |
| usage | transcript 抠出的逐轮 usage 非空并聚合进 attempt |

## 仓库验收

- 验收脚本核对 CLI 退出码与实际运行的 Eval 集合。
- **CLI 读回**：`show` 榜单列出本仓库 Eval 与 verdict；对通过 attempt 的 `show --execution` 执行树出现 `skill.loaded` 与 `mcp__` 调用节点，节点带 span 时间注释。
- **OTel**：adapter 的 `tracing.env` 注入原生 OTLP 遥测，执行树的时间注释就是记录成立的展示证明；`openResults()` 抽查 span 呈现 `claude_code.interaction → llm_request / tool` 层级。原生 span 内容默认脱敏是常态——trace 只证时间与结构，行为断言仍以 transcript 归一的事件流为准。
