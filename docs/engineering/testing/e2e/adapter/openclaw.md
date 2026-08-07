# openclaw 仓库

Repo ID 是 `adapter/openclaw`；manifest 声明 `areas: ["adapter"]`、live lanes、Docker 与 external network。
被测对象是 `openClawAgent()` 在 Docker Sandbox 里的完整生命周期（契约见 [OpenClaw 契约页](../../../../feature/adapters/sdk/openclaw/README.md)）。

## Eval 闭环

| 协议行为 | Eval 断言（只读事件流） |
| --- | --- |
| coding 任务工具轨 | session transcript 归一出工具事件并按 call ID 配对 |
| 会话 | 显式 session id 续轮能引用首轮事实；新 session 与旧 session 隔离 |
| usage | transcript 或 `--json` 封包归一出 usage |
| 负断言边界 | transcript 完整时设 `notCalledTool` 反例；缺失时不从最终文本猜过程 |

## 仓库验收

- 验收脚本核对 CLI 退出码与实际运行的 Eval 集合。
- **CLI 读回**：`show` 成绩单列出本仓库 Eval 与 verdict；对通过 attempt 的 `show --execution` 执行树出现工具调用节点。
- **OTel**：适配器复用 canonical OTel mapper；OTel 内容关闭时只影响 timing 注释，事件流断言照常通过。
