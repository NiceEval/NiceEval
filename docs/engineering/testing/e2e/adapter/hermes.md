# hermes 仓库

仓库 ID `hermes`，group `sandbox`，`e2e.json.requires.docker: true`。
被测对象是 `hermesAgent()` 在 Docker Sandbox 里的完整生命周期（契约见 [Hermes 契约页](../../../../feature/adapters/sdk/hermes/README.md)）。

## Eval 闭环

| 协议行为 | Eval 断言（只读事件流） |
| --- | --- |
| coding 任务工具轨 | sessions export / `state.db` 归一出文件与 shell 工具事件并完成配对 |
| 会话 | `--resume` 续轮能引用首轮事实 |
| usage | session 级 token / cost 归一进 `Usage` |

## 仓库验收

- 验收脚本核对 CLI 退出码与实际运行的 Eval 集合。
- **CLI 读回**：`show` 成绩单列出本仓库 Eval 与 verdict；对通过 attempt 的 `show --execution` 执行树出现工具调用节点。
- **OTel**：无原生 OTel 时执行树显示 timing unavailable；事件流断言照常通过。
