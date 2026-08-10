# claude-code 仓库

## adapter-claude-code-live-compatibility

Repo ID 是 `adapter/claude-code`；manifest 声明 `areas: ["adapter"]`、live lanes、Docker 与 external network。
被测对象是`claudeCodeAgent()` 在 Docker Sandbox 里的完整生命周期：安装、扩展装配、真实 coding 任务、transcript 采集与会话续接（契约见[Claude Code 契约页](../../../../feature/adapters/sdk/claude-code/README.md)）。

## Eval 闭环

| 协议行为          | Eval 断言（只读事件流）                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 本地 Skills       | 同时挂载 marker / checklist / decoy 三个互斥 Skill；两条正调分别只产生目标 `skill.loaded`，普通对话以 turn / session / `t` 三种 scope 的 `notEvent("skill.loaded")` 证明零加载 |
| Repo Skill        | 从钉定 Git commit 只选择 `calibre`；安装文件进入 `.claude/skills/`，原生 Skill 工具加载后采用远程命令约定 |
| MCP               | stdio 与远程 HTTP 两种形态的 server 都能被调用，工具以 `mcp__<server>__<tool>` 命名出现；反例断言未挂载的 server `notCalledTool` |
| MCP Plugin        | 从 Anthropic 官方 marketplace 安装知名的 `context7`；Plugin 自带的匿名远程 MCP 被实际调用，声明 `sandboxReuse` 时同一沙箱的两条 Attempt 都调用正确工具成功 |
| 远程 Plugin       | 从 Anthropic 官方远程 marketplace 安装 `frontend-design`；缓存文件存在，Plugin 自带 Skill 被实际加载并完成真实请求 |
| settingsFile      | `permissions.deny` 关闭 WebSearch / WebFetch 后，反例断言 `notCalledTool` 的 `web_search` / `web_fetch`                          |
| 会话              | 原生 resume ID 续接，第二轮能引用首轮事实                                                                                        |
| usage             | transcript 抠出的逐轮 usage 非空并聚合进 attempt                                                                                 |

## 仓库验收

- `coding` Experiment 选中本仓库的 coding task 与 session-resume；验收脚本列全 Claude Code 协议 Eval ID。
- `skill` Experiment 在同一个 agent 上安装三个 Skill：marker 与 checklist 分别验证目标 `loadedSkill` 和其它 Skill 未加载，`skill-unused` 验证不相关普通对话一个也不加载。
- `repo-skill` 从 `CorrectRoadH/skills` 的固定 commit 安装 `calibre`，专用 Eval 核对安装位置、`skill.loaded` 与命令内容。
- `plugin` 与 `plugin-reuse` 都从 Anthropic 官方 marketplace 安装 `context7`；前者证明远程 MCP 可调用，后者证明复用同一沙箱时两条 Attempt 仍都能调用正确工具。
- `remote-plugin` 从 Anthropic 官方远程 marketplace 安装 `frontend-design`，专用 Eval 核对缓存文件与带 Plugin 命名空间的 `skill.loaded`。
- owner test 只从 `exp --json` 收据核对预期 Experiment / Eval 完整发现、每条 Attempt 全部通过与 JUnit 无错误；Skill、MCP、Plugin 和配置的具体行为只在各自专用 Eval 中断言，不重复匹配 `show` 的展示文本。
