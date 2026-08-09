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
- **CLI 读回**：`show` 成绩单列出本仓库 Eval 与 verdict；对通过 attempt 的 `show --execution` 执行树读回带区分力入参的文件与 shell 工具节点，以及所选 Skill，且不出现 decoy。
- **OTel**：无原生 OTel 时执行树显示 timing unavailable；事件流断言照常通过。
