# bub 仓库

仓库 ID `bub`，group `sandbox`，`e2e.json.requires` 声明 Docker 与 Python 运行时。被测对象是 `bubAgent()` 在 Docker Sandbox 里的完整生命周期：安装（含 `pythonPlugins`）、真实 coding 任务、tape JSONL 行为轨与会话（契约见 [Bub 契约页](../../../feature/adapters/sdk/bub/README.md)）。

## Eval 闭环

| 协议行为 | Eval 断言（只读事件流） |
|---|---|
| coding 任务工具轨 | 真实任务下 Bub tape JSONL 归一出工具事件并完成配对；缺少显式 call ID 的事件只能按位配对，因此 Eval 保持串行工具场景，不断言并发配对 |
| Skills | 挂载的 Skill 在事件流中留下使用证据 |
| pythonPlugins 与 postSetup | 安装的 Python 插件行为可观察；`postSetup` 钩子按序执行并在产物中留下证据 |
| 会话 | session 由 Adapter 管理，第二轮能引用首轮事实 |
| usage 与 cost | usage 和 cost 从 run 事件读取，逐轮非空 |

## 仓库验收

- 验收脚本核对 CLI 退出码与实际运行的 Eval 集合。
- **CLI 读回**：`show` 榜单列出本仓库 Eval 与 verdict；对通过 attempt 的 `show --execution` 执行树出现工具调用节点，节点带 span 时间注释。
- **OTel**：adapter 的 `tracing.env` 注入标准 `OTEL_*` 环境变量（OTLP/protobuf），执行树的时间注释就是记录成立的展示证明；`openResults()` 抽查 span 经 mapper 归一到 canonical GenAI 语义约定。span mapper 只影响瀑布图——判分断言仍只读 tape 归一的事件流。
