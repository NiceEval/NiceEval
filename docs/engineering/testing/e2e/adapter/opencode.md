# opencode 仓库

## adapter-opencode-live-compatibility

Repo ID 是 `adapter/opencode`；manifest 声明 `areas: ["adapter", "sandbox"]`、live lanes、Docker 与 external network。
被测对象是 `openCodeAgent()` 在 Docker Sandbox 里的完整生命周期（契约见 [OpenCode 契约页](../../../../feature/adapters/sdk/opencode/README.md)）。

## 两条 provider 配置线

| 实验 | 鉴权与 provider | 模型 | 跑哪些 Eval |
| --- | --- | --- | --- |
| `ci` | 显式 `BUB_API_KEY` + `BUB_API_BASE`，注册 `compat` provider | `gpt-5.6-luna` | coding、会话、usage 三条通用协议闭环 |
| `skill` | 与 `ci` 相同的 compat provider，额外声明 status-report 与 decoy 两个 Skill | `gpt-5.6-luna` | 只跑 `skills/status-report` 专用 Eval |
| `go` | 显式 `OPENCODE_API_KEY`，不配置自定义 base URL，使用 OpenCode Go 原生 provider | `opencode-go/deepseek-v4-flash` | 只跑 `provider/go-routing` 专用 Eval |

`skill` 把安装配置从通用协议实验拆开，Experiment 与专用 Eval 一一对应。
`go` 证明 `apiKey` 能在不依赖宿主 OpenCode 登录状态的情况下进入隔离 Sandbox。专用 Eval 先用完整路由 `opencode-go/deepseek-v4-flash` 完成真实模型请求，再从官方 session export 核对实际 `providerID` 与 API `modelID`。两条配置线都不重复通用协议巡礼。

OpenCode Adapter 当前只公开 `skills` 扩展配置；契约明确不接受 Codex/Claude 的 `mcpServers` 或原生 `plugins` 字段。因此本 owner 不建立无法由公共 API 驱动的 MCP/Plugin 假实验；若将来 Adapter 增加这些能力，应分别新增配置 Experiment 与能够观察真实调用或安装文件的专用 Eval。

## Eval 闭环

| 协议行为 | Eval 断言（只读事件流） |
| --- | --- |
| coding 任务工具轨 | `opencode run --format json` 归一出文件与 shell 工具事件并完成配对；两笔调用都保留同一个有区分力的输入 marker |
| Skills | status-report 与 decoy 同时装进 `.agents/skills/`；无 native frontmatter 的通用 `SKILL.md` 会被 Adapter 补成 OpenCode 可发现的最小 header，目标由原生 `skill` 工具选择并把独有 marker 写进生成文件，decoy 没有被读取或采用 |
| Go provider 路由 | 完整 CLI route 完成真实请求；`opencode export <sessionID>` 暴露 `providerID: opencode-go` 与 `modelID: deepseek-v4-flash` |
| 会话 | 首轮捕获 `sessionID`，`--session` 续轮能引用首轮事实 |
| usage | 每一轮的 `inputTokens` 与 `outputTokens` 都为正，直接从 `Turn.usage` 读取 |

## 仓库验收

- coding 任务提示词显式点名文件写入 / 文件编辑工具，避免 OpenCode 习惯性用 bash 完成文件操作。
- `ci` Experiment 选中 coding、会话与 usage 通用 Eval；`skill` 与 `go` 各自只选一条专用 Eval。原生验收脚本分别执行三条配置线，防止少发现/少运行后假绿。
- **CLI 读回**：`show` 成绩单列出本仓库 Eval 与 verdict；对通过 attempt 的 `show --execution` 执行树出现工具调用节点及其 input 块。
  coding 的两笔 marker 输入、Skill 生成文件的 marker，以及 usage Eval 的两个 turn usage 都可公开读回。
- **OTel**：适配器复用 canonical OTel mapper；时间轨缺失只影响 timing 注释，不影响事件流断言。
