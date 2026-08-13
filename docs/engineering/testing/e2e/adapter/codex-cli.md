# codex-cli 仓库

## adapter-codex-cli-live-compatibility

Repo ID 是 `adapter/codex-cli`；manifest 声明 `areas: ["adapter", "sandbox"]`、live lanes、Docker 与 external network。
被测对象是 `codexAgent()` 在 Docker Sandbox 里的完整生命周期：安装、扩展装配、真实 coding 任务、`codex exec --json` 行为轨与续轮（契约见[Codex CLI 契约页](../../../../feature/adapters/sdk/codex-cli/README.md)）。

## Eval 闭环

| 协议行为 | Eval 断言（只读事件流） |
| --- | --- |
| coding 任务工具轨 | 真实任务下 `codex exec --json` 的结构化 stdout 归一出命令与文件工具事件，优先按显式 call ID 配对 |
| 本地 Skills | 同时安装 status report / release note / decoy 三个互斥 Skill；两条正调各自证明只读取目标 `SKILL.md`、采用目标独有 marker 且未读取其它 Skill。Codex 没有原生 Skill 工具，两条路径都以 `notEvent("skill.loaded")` 守住“不伪造加载事件”的反例 |
| Repo Skill | 从钉定 Git commit 只选择 `calibre`；安装文件进入 `.agents/skills/`，Codex 读取后采用远程命令约定且不伪造 `skill.loaded` |
| MCP | stdio 与远程 HTTP 两种形态的 `[mcp_servers.<name>]` 都能被调用；反例断言未挂载的 server `notCalledTool` |
| Plugins 与 hook 信任 | marketplace 安装的 Plugin 行为可观察，其 hook 在 bypass 信任姿态下确实生效——hook 注入/捕获行为在事件流或输出中留下证据，不是被静默跳过；`sandboxReuse` 以四路并发运行两波 Attempt，复用波次安装收敛——同名不同出处的残留 marketplace 注册被替换为声明出处、Plugin 按声明重装，不因残留状态报错 |
| configFile | 如 `web_search = "disabled"` 生效后，反例断言 `notCalledTool` 的 `web_search` |
| 会话 | thread started 事件的 session ID 续接 `codex exec resume`，第二轮能引用首轮事实 |
| usage 与实际模型 | usage 逐轮到位；实际模型从 Codex session 侧写核对，不只信请求参数 |

## 仓库验收

- coding 任务按 Codex 的真实归一形状设计：apply_patch 新增 → `file_write`、apply_patch 修改 → `file_edit`、命令执行 → `shell`。提示词显式禁止用 shell 写文件，避免 Codex 用一条命令顶掉文件工具。
- `baseline` Experiment 选中本仓库的 `coding-task` / `session` / `usage`；原生验收脚本列全 Codex CLI 协议 Eval ID。
- `skill` Experiment 把三个 Skill 一起装进同一个 agent。status report 与 release note 两条 Eval 各自要求只读取目标文件；decoy 只作为反选哨兵，任一正调读到它都会判红。
- `repo-skill` 从 `CorrectRoadH/skills` 的固定 commit 安装 `calibre`；专用 Eval 核对安装位置、真实读取行为与命令内容。
- `show --page attempts` 逐条核验两类 ID，防止少发现/少运行后假绿。
- **CLI 读回**：代表性 `show --execution` 只验收 coding 工具与入参投影。Codex 没有原生 `skill.loaded`；本地与 Repo Skill 的目标读取、其它 Skill 未读取以及零 `skill.loaded` 反例全部留在 Eval 事件断言中。
- **Timing**：独立 `show --timing` owner 读回 Codex CLI 实际跨过的 runner 阶段。`tracing.configure` 仍属 Adapter 运行契约，但本 owner 不从 execution 文本或未持久的 raw OTLP 反推它。
