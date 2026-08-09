# opencode 仓库

仓库 ID `opencode`，group `sandbox`，`e2e.json.requires.docker: true`。
被测对象是 `openCodeAgent()` 在 Docker Sandbox 里的完整生命周期（契约见 [OpenCode 契约页](../../../../feature/adapters/sdk/opencode/README.md)）。

## Eval 闭环

| 协议行为 | Eval 断言（只读事件流） |
| --- | --- |
| coding 任务工具轨 | `opencode run --format json` 归一出文件与 shell 工具事件并完成配对 |
| 会话 | 首轮捕获 `sessionID`，`--session` 续轮能引用首轮事实 |
| usage | usage 逐轮非空（有 tokens 或 cost） |

## 仓库验收

- 验收脚本核对 CLI 退出码与实际运行的 Eval 集合。
- **CLI 读回**：`show --run <runId>` 的成绩单列出本仓库 Eval 与 Verdict；进入已规划的 Attempt execution 页面后，执行树出现工具调用节点。
- **OTel**：适配器复用 canonical OTel mapper；时间轨缺失只影响 timing 注释，不影响事件流断言。
