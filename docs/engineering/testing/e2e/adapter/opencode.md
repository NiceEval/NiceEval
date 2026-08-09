# opencode 仓库

## adapter-opencode-live-compatibility

Repo ID 是 `adapter/opencode`；manifest 声明 `areas: ["adapter", "sandbox"]`、live lanes、Docker 与 external network。
被测对象是 `openCodeAgent()` 在 Docker Sandbox 里的完整生命周期（契约见 [OpenCode 契约页](../../../../feature/adapters/sdk/opencode/README.md)）。

## Eval 闭环

| 协议行为 | Eval 断言（只读事件流） |
| --- | --- |
| coding 任务工具轨 | `opencode run --format json` 归一出文件与 shell 工具事件并完成配对；两笔调用都保留同一个有区分力的输入 marker |
| Skills | status-report 与 decoy 同时装进 `.agents/skills/`；无 native frontmatter 的通用 `SKILL.md` 会被 Adapter 补成 OpenCode 可发现的最小 header，目标由原生 `skill` 工具选择并把独有 marker 写进生成文件，decoy 没有被读取或采用 |
| 会话 | 首轮捕获 `sessionID`，`--session` 续轮能引用首轮事实 |
| usage | 每一轮的 `inputTokens` 与 `outputTokens` 都为正，直接从 `Turn.usage` 读取 |

## 仓库验收

- coding 任务提示词显式点名文件写入 / 文件编辑工具，避免 OpenCode 习惯性用 bash 完成文件操作。
- `ci` Experiment 选中本仓库的 coding、Skill、会话与 usage Eval；原生验收脚本列全 OpenCode 协议 Eval ID，防止少发现/少运行后假绿。
- **CLI 读回**：`show` 成绩单列出本仓库 Eval 与 verdict；对通过 attempt 的 `show --execution` 执行树出现工具调用节点及其 input 块。
  coding 的两笔 marker 输入、Skill 生成文件的 marker，以及 usage Eval 的两个 turn usage 都可公开读回。
- **OTel**：适配器复用 canonical OTel mapper；时间轨缺失只影响 timing 注释，不影响事件流断言。
