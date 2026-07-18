# openclaw 仓库

仓库 ID `openclaw`，group `sandbox`，`e2e.json.requires.docker: true`。被测对象是 `openClawAgent()` 在 Docker Sandbox 里的完整生命周期（契约见 [OpenClaw 契约页](../../../feature/adapters/sdk/openclaw/README.md)）。

OpenClaw 的公开能力以真实 fixture 固定的事实为准，本仓库就是产出并持续验收这些事实的地方：契约页列出的每个待固定事实点，对应本仓库一个 Eval 或一条验收断言。fixture 尚未证明完整的行为不进公开能力，也不在本仓库设 Eval——覆盖表留白即缺口。

## Eval 闭环

| 事实点 | Eval 断言（只读事件流） |
|---|---|
| `agent --json` 字段 | 消息、工具、失败与 usage 字段归一进标准事件流 |
| call ID 配对 | 工具调用具有稳定 call ID 时按 ID 配对；配对可靠性未证明时不设并发工具 Eval |
| 会话 | 首轮取得 session key，后续 resume 能引用首轮事实；新 session 与旧 session 隔离 |
| 超时 fallback | 超时 fallback 产生第二条 run 时不重复采集——事件流中每次调用只出现一次 |
| 负断言边界 | transcript 完整性支撑到哪里，`notCalledTool` 反例就设到哪里；拿不到完整工具轨迹的场景不从最终文本猜测调用过程 |

## 仓库验收

- 验收脚本核对 CLI 退出码与实际运行的 Eval 集合。
- **CLI 读回**：`show` 榜单列出本仓库 Eval 与 verdict；对通过 attempt 的 `show --execution` 执行树出现工具调用节点，节点带 span 时间注释。
- **OTel**：适配器复用 canonical OTel mapper，执行树的时间注释就是记录成立的展示证明。OTel 内容关闭时 trace 缺失只影响 trace 本身——执行树节点照常出现、只是显示 timing unavailable，事件流断言全部照常通过；这条降级路径本身就是一条验收断言。
