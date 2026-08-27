# claude-code 仓库

## adapter-claude-code-live-compatibility

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [adapters](../../../../feature/adapters/README.md)

Repo ID 是 `adapter/claude-code`；manifest 声明 `areas: ["adapter"]`、live lanes、Docker 与 external network。
被测对象是`claudeCodeAgent()` 在 Docker Sandbox 里的完整生命周期：安装、扩展装配、真实 coding 任务、transcript 采集与会话续接（契约见[Claude Code 契约页](../../../../feature/adapters/sdk/claude-code/README.md)）。

## Eval 闭环

| 协议行为          | Eval 断言（只读事件流）                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 本地 Skills       | 同时挂载 marker / checklist / decoy 三个互斥 Skill；专用 Eval 用任务结果验证目标 Skill 的行为，`skill.loaded` 只保留为报告与诊断证据，当前公开 Assert-first API 不提供对应的正负断言 |
| Repo Skill        | 从钉定 Git commit 只选择 `calibre`；安装文件进入 `.claude/skills/`，原生 Skill 工具加载后采用远程命令约定 |
| MCP               | stdio 与远程 HTTP 两种形态的 server 都能被调用，工具以 `mcp__<server>__<tool>` 命名出现并保留精确入参 |
| MCP Plugin        | 从 Anthropic 官方 marketplace 安装知名的 `context7`；Plugin 自带的匿名远程 MCP 被实际调用，声明 `sandboxReuse` 时同一沙箱的两条 Attempt 都调用正确工具成功 |
| 远程 Plugin       | 从 Anthropic 官方远程 marketplace 安装 `frontend-design`；缓存文件存在，Plugin 自带 Skill 被实际加载并完成真实请求 |
| settingsFile      | 同一条请求在对照 Experiment 中真实调用 `web_search`；`permissions.deny` 关闭 WebSearch / WebFetch 后 Turn 仍正常完成，反例断言两个工具均零调用 |
| 会话              | 原生 resume ID 续接，第二轮能引用首轮事实                                                                                        |
| HITL 选项         | `AskUserQuestion` 返回 waiting 与两个原生选项；按 request ID 选择后恢复同一会话并采用所选项；同一 Eval 的普通内容对照没有请求时得到 failed verdict |
| usage             | transcript 抠出的逐轮 usage 非空并聚合进 attempt                                                                                 |

## 仓库验收

- `coding` Experiment 选中本仓库的 coding task、session-resume 与 WebSearch 正例。`locked-down` 用完全相同的 WebSearch 请求验证 deny 反例。
- `hitl` 验证原生选项暂停与恢复。`hitl-content` 用同一 Eval 验证普通内容轮因没有待输入请求而判为 failed；验收脚本列全 Claude Code 协议 Eval ID。
- `skill` Experiment 在同一个 agent 上安装三个 Skill：marker 与 checklist 分别验证目标 Skill 产生的可观察任务结果，`skill-unused` 验证不相关普通对话没有受到这些 Skill 的行为影响。`skill.loaded` 只作为报告诊断，不充当作者断言。
- `repo-skill` 从 `CorrectRoadH/skills` 的固定 commit 安装 `calibre`，专用 Eval 核对安装位置与命令结果；`skill.loaded` 留在报告里供诊断。
- `plugin` 与 `plugin-reuse` 都从 Anthropic 官方 marketplace 安装 `context7`；前者证明远程 MCP 可调用，后者以四路并发运行两波 Attempt，证明复用沙箱时仍都能调用正确工具。
- `remote-plugin` 从 Anthropic 官方远程 marketplace 安装 `frontend-design`，专用 Eval 核对缓存文件与 Plugin 产生的可观察结果；带 Plugin 命名空间的 `skill.loaded` 留在报告里供诊断。
- owner test 只从 `exp --json` 收据核对预期 Experiment / Eval 完整发现、每条 Attempt 全部通过与 JUnit 无错误；Skill、MCP、Plugin 和配置的具体行为只在各自专用 Eval 中断言，不重复匹配 View 的展示文本。
