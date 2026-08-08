# codex-cli 仓库

Repo ID 是 `adapter/codex-cli`；manifest 声明 `areas: ["adapter", "sandbox"]`、live lanes、Docker 与 external network。
被测对象是 `codexAgent()` 在 Docker Sandbox 里的完整生命周期：安装、扩展装配、真实 coding 任务、`codex exec --json` 行为轨与续轮（契约见[Codex CLI 契约页](../../../../feature/adapters/sdk/codex-cli/README.md)）。

## Eval 闭环

| 协议行为 | Eval 断言（只读事件流） |
| --- | --- |
| 共享断言契约 | 普通对话以 `usedNoTools` / `notCalledTool` 证明零工具；真实 shell 调用分别在 turn、session 与 `t` scope 求值；coding 任务枚举 `ToolMatch` 的 input / count / output / status 与 Sandbox 正反断言 |
| coding 任务工具轨 | 真实任务下 `codex exec --json` 的结构化 stdout 归一出命令与文件工具事件，优先按显式 call ID 配对 |
| Skills | Skill 写入可发现目录后，验证走**读取行为**（事件流中出现对 Skill 文件的读取）或 Skill 特有结果——不假设存在 Claude Code 式的自动加载事件 |
| MCP | stdio 与远程 HTTP 两种形态的 `[mcp_servers.<name>]` 都能被调用；反例断言未挂载的 server `notCalledTool` |
| Plugins 与 hook 信任 | marketplace 安装的 Plugin 行为可观察，其 hook 在 bypass 信任姿态下确实生效——hook 注入/捕获行为在事件流或输出中留下证据，不是被静默跳过；声明 `sandboxReuse` 时同一沙箱的第二条 Attempt 安装收敛——同名不同出处的残留 marketplace 注册被替换为声明出处、Plugin 按声明重装，不因残留状态报错 |
| configFile | 如 `web_search = "disabled"` 生效后，反例断言 `notCalledTool` 的 `web_search` |
| 会话 | thread started 事件的 session ID 续接 `codex exec resume`，第二轮能引用首轮事实 |
| usage 与实际模型 | usage 逐轮到位；实际模型从 Codex session 侧写核对，不只信请求参数 |

## 仓库验收

- `e2e.json` 声明 `harness.adapterAssertions: true`；`evals/assertion-profile.ts` 只保存 Codex CLI 的真实提示词、canonical 工具名和 marker。根 runner 在隔离副本中把共享源码复制为 `evals/assertion-contract.eval.ts`。
- profile 的 coding 任务按 codex 的真实归一形状设计：apply_patch 新增 → `file_write`、apply_patch 修改 → `file_edit`、命令执行 → `shell`。提示词显式禁止用 shell 写文件，避免 codex 图省事用一条命令顶掉文件工具。
- `baseline` Experiment 一次选中全部 `assertion-contract/*` 与原生 `coding-task` / `session` / `usage`；原生验收脚本的 `EXPECTED_EVALS` 同时列全共享契约 ID 与 Codex CLI 特有 Eval ID。
- `show --page attempts` 逐条核验两类 ID，防止少发现/少运行后假绿。
- **CLI 读回**：`show` 默认报告列出本仓库 Eval 与 verdict；对通过 attempt 的 `show --execution` 执行树出现命令与文件工具调用节点，节点带 span 时间注释。
- **OTel**：adapter 的 `tracing.configure` 写入 `config.toml` 的 `[otel]` 块，执行树的时间注释就是写入成立的展示证明。`show --timing` 的 OTel 子树以 tool / model 角色挂出 span——专属 mapper 归一到 canonical GenAI 语义约定的展示结果，与事件的对应靠显式 call ID correlation 成立，不靠名字猜。
