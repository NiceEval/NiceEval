# codex-cli 仓库

仓库 ID `codex-cli`，group `sandbox`，`e2e.json.requires.docker: true`。被测对象是 `codexAgent()` 在 Docker Sandbox 里的完整生命周期：安装、扩展装配、真实 coding 任务、`codex exec --json` 行为轨与续轮（契约见 [Codex CLI 契约页](../../../feature/adapters/sdk/codex-cli/README.md)）。

## Eval 闭环

| 协议行为 | Eval 断言（只读事件流） |
|---|---|
| coding 任务工具轨 | 真实任务下 `codex exec --json` 的结构化 stdout 归一出命令与文件工具事件，优先按显式 call ID 配对 |
| Skills | Skill 写入可发现目录后，验证走**读取行为**（事件流中出现对 Skill 文件的读取）或 Skill 特有结果——不假设存在 Claude Code 式的自动加载事件 |
| MCP | stdio 与远程 HTTP 两种形态的 `[mcp_servers.<name>]` 都能被调用；反例断言未挂载的 server `notCalledTool` |
| Plugins 与 hook 信任 | marketplace 安装的 Plugin 行为可观察，其 hook 在 bypass 信任姿态下确实生效——hook 注入/捕获行为在事件流或产物中留下证据，不是被静默跳过 |
| configFile | 如 `web_search = "disabled"` 生效后，反例断言 `notCalledTool` 的 `web_search` |
| 会话 | thread started 事件的 session ID 续接 `codex exec resume`，第二轮能引用首轮事实 |
| usage 与实际模型 | usage 逐轮到位；实际模型从 Codex session 侧写核对，不只信请求参数 |

## 仓库验收

- 验收脚本核对 CLI 退出码与实际运行的 Eval 集合。
- **CLI 读回**：`show` 榜单列出本仓库 Eval 与 verdict；对通过 attempt 的 `show --execution` 执行树出现命令与文件工具调用节点，节点带 span 时间注释。
- **OTel**：adapter 的 `tracing.configure` 写入 `config.toml` 的 `[otel]` 块，执行树的时间注释就是记录成立的展示证明；`openResults()` 抽查 span 经专属 mapper 归一到 canonical GenAI 语义约定——工具 span 带 `gen_ai.operation.name: execute_tool` 与显式 call ID，与事件流的对应关系靠 correlation 属性成立，不靠名字猜。
