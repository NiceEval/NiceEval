# hermes 仓库

## adapter-hermes-live-compatibility

Repo ID 是 `adapter/hermes`；manifest 声明 `areas: ["adapter", "sandbox"]`、live lanes、Docker 与 external network。
被测对象是 `hermesAgent()` 在 Docker Sandbox 里的完整生命周期（契约见 [Hermes 契约页](../../../../feature/adapters/sdk/hermes/README.md)）。

## Eval 闭环

| 协议行为 | Eval 断言（只读事件流） |
| --- | --- |
| coding 任务工具轨 | sessions export / `state.db` 归一出文件与 shell 工具事件并完成配对 |
| Skills | 本地 Skill 安装到 `~/.hermes/skills`；原生 `skill_view` 归一为 `skill.loaded`，只选择匹配项、不误用 decoy |
| 会话 | `--resume` 续轮能引用首轮事实 |
| usage | 每个独立 turn 的 session 级 token / cost 归一进 `Usage` |

## 仓库验收

- `ci` Experiment 选中本仓库的 coding、Skill、会话与 usage Eval；原生验收脚本列全 Hermes 协议 Eval ID，防止少发现/少运行后假绿。
- **Eval 结果**：原生验收只断言通过数与未通过数。工具入参、Skill 正选与 decoy 反选都由对应 Eval 的标准事件断言判分。
- **Evidence Page**：独立 `show @locator --report <fixture-module> --page <execution-route>` test 只读回 coding Eval 的代表性工具入参 sentinel，不重复判定 Skill。
- **Timing / OTel 边界**：通用 Runner timing 由 [`runner-history-dedup`](../runner.md#runner-history-dedup) 唯一读回；当前没有可把 mapper-specific OTel 归因给 Hermes 的公开 seam。
