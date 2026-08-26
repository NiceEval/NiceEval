# codex-cli 仓库

## adapter-codex-app-server-failed-turn

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [adapters](../../../../feature/adapters/README.md)

Repo ID 是 `adapter/codex-app-server`。它以签入的外部 `codex app-server` JSON-RPC
fixture 驱动安装后的 `codexAgent()`、digest-pinned Node Docker Sandbox 与公开 CLI，不使用 provider 凭据。

这个 owner 固定验证以下结果：

- `turn/completed` 的 `turn.status = failed` 仍是可信协议终态；
- Record 把结果归为 assertion `failed`，而不是 execution `errored`；
- Human 反馈展示 scope assertion 的 expected / received 与原生 `turn.error.message`；
- 反馈不能退化为 `error: failed`，也不能抛出 adapter 组装的 SendFailure 文本。

## adapter-codex-app-server-host-config-isolation

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [adapters](../../../../feature/adapters/README.md)

Repo ID 是 `adapter/codex-app-server`。这个单边界 owner 为每个 case 创建测试自有的
`HOME` 与 `CODEX_HOME`，在两处写入不同的合法 sentinel config，再通过安装后 CLI、
`codexAgent()`、digest-pinned Node Docker Sandbox 与真实 app-server 协议运行。容器使用固定非 root 用户，
并把签入 fixture Codex 安装到自己的 `PATH`。fixture 只通过协议返回 Sandbox 进程的 HOME 身份与
config-present 布尔值；测试在进程结束后逐字节核对两份 sentinel，证明容器既不读取也不改写宿主 Codex 配置。

该 owner 的所有 Codex 初始化进程都显式继承 case 私有的 `HOME` 与 `CODEX_HOME`；它不读取、
检查或依赖执行机的真实 HOME 与 `.codex`，收据也不保存配置内容或进程变量内容。

## adapter-codex-cli-live-compatibility

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [adapters](../../../../feature/adapters/README.md)

Repo ID 是 `adapter/codex-cli`；manifest 声明 `areas: ["adapter", "sandbox"]`、live lanes、Docker 与 external network。
被测对象是 `codexAgent()` 在 Docker Sandbox 里的完整生命周期：安装、扩展装配、真实 coding 任务、`codex exec --json` 行为轨与续轮（契约见[Codex CLI 契约页](../../../../feature/adapters/sdk/codex-cli/README.md)）。

## Eval 闭环

| 协议行为 | Eval 断言（只读事件流） |
| --- | --- |
| coding 任务工具轨 | 真实任务下 `codex exec --json` 的结构化 stdout 归一出命令与文件工具事件，优先按显式 call ID 配对 |
| 本地 Skills | 同时安装 status report / release note / decoy 三个互斥 Skill；两条正调各自证明只读取目标 `SKILL.md`、采用目标独有 marker 且未读取其它 Skill。Codex 没有原生 Skill 工具，两条路径都以 `notEvent("skill.loaded")` 守住“不伪造加载事件”的反例 |
| Repo Skill | 从钉定 Git commit 只选择 `calibre`；安装文件进入 `.agents/skills/`，Codex 读取后采用远程命令约定且不伪造 `skill.loaded` |
| MCP | stdio 与远程 HTTP 两种形态的 `[mcp_servers.<name>]` 都能被调用并保留精确入参 |
| Plugins 与 hook 信任 | marketplace 安装的 Plugin 行为可观察，其 hook 在 bypass 信任姿态下确实生效——hook 注入/捕获行为在事件流或输出中留下证据，不是被静默跳过；`sandboxReuse` 以四路并发运行两波 Attempt，复用波次安装收敛——同名不同出处的残留 marketplace 注册被替换为声明出处、Plugin 按声明重装，不因残留状态报错 |
| configFile | 同一个 Eval 和 prompt 分别由 shell enabled / disabled Experiment 运行；前者调用 `shell`，后者正常完成且 `notCalledTool` |
| 会话 | thread started 事件的 session ID 续接 `codex exec resume`，第二轮能引用首轮事实 |
| HITL 选项 | `request_user_input` 返回 waiting 与两个原生选项；按 request ID 选择后恢复同一会话并采用所选项；同一 Eval 的普通内容对照没有请求时得到 failed verdict |
| usage 与实际模型 | usage 逐轮到位；实际模型从 Codex session 侧写核对，不只信请求参数 |

## 仓库验收

- `configfile` Eval 同时进入 baseline 与 disabled Experiment；两边通过 `flags.shellTool` 声明预期，并各自挂载显式 enabled / disabled 原生 configFile。相同 prompt 下工具面的结构差异形成正反对照，不依赖 custom provider 是否支持 Web Search。
- coding 任务按 Codex 的真实归一形状设计：apply_patch 新增 → `file_write`、apply_patch 修改 → `file_edit`、命令执行 → `shell`。提示词显式禁止用 shell 写文件，避免 Codex 用一条命令顶掉文件工具。
- `baseline` Experiment 选中本仓库的 `coding-task` / `configfile` / `session` / `usage`。
- `hitl` 验证原生选项暂停与恢复。`hitl-content` 用同一 Eval 验证普通内容轮因没有待输入请求而判为 failed；原生验收脚本列全 Codex CLI 协议 Eval ID。
- `skill` Experiment 把三个 Skill 一起装进同一个 agent。status report 与 release note 两条 Eval 各自要求只读取目标文件；decoy 只作为反选哨兵，任一正调读到它都会判红。
- 两条 Skill Eval 使用互不重叠的 `status-report` / `skill-release-note` ID，让 live 模型断言失败时可按 CLI 前缀选择规则精确补跑一条，不扩大成本，也不替换另一条结果。
- `repo-skill` 从 `CorrectRoadH/skills` 的固定 commit 安装 `calibre`；专用 Eval 核对安装位置、真实读取行为与命令内容。
- Verdict test 逐条核验 `(experimentId, evalId)` 与 `passed` 数，防止少发现、少运行或全局计数抵消后假绿。
- **CLI 读回**：独立固定 `query run --request <request>` test 只验收 coding 工具与入参的代表投影。Codex 没有原生 `skill.loaded`；本地与 Repo Skill 的目标读取、其它 Skill 未读取、零 `skill.loaded` 反例以及 MCP 完整矩阵全部留在 Eval 事件断言中。
- **Timing / OTel 边界**：通用 Runner timing 由 [`runner-generic-timing`](../runner.md#runner-generic-timing) 唯一读回。当前公开读面不能归因 Codex CLI 的 mapper-specific OTel，本 Repo 不从 execution 文字、日志或私有结果反推它。
