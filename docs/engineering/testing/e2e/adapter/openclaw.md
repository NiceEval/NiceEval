# openclaw 仓库

## adapter-openclaw-live-compatibility

<!-- niceeval.e2e-owner-contract/v1 -->
Contract: [adapters](../../../../feature/adapters/README.md)

Repo ID 是 `adapter/openclaw`；manifest 声明 `areas: ["adapter", "sandbox"]`、live lanes、Docker 与 external network。
被测对象是 `openClawAgent()` 在 Docker Sandbox 里的完整生命周期（契约见 [OpenClaw 契约页](../../../../feature/adapters/sdk/openclaw/README.md)）。

## Eval 闭环

| 协议行为 | Eval 断言（只读事件流） |
| --- | --- |
| Skills 与工具轨 | 目标 Skill 真装进 `.agents/skills/` 并被 shell 读取；session transcript 归一出工具事件并按 call ID 配对，生成文件采用 Skill 的独有 marker，同轮不读 decoy |
| 原生插件 | 官方 `@openclaw/brave-plugin@2026.7.1` 的原生 install record 保留精确 package/version，且 `plugins inspect --runtime` 报 loaded、无 diagnostics |
| 会话 | 显式 session id 续轮能引用首轮事实；新 session 与旧 session 隔离 |
| usage | transcript 或 `--json` 封包归一出每轮正的 `inputTokens` / `outputTokens` |
| 负断言边界 | transcript 完整时设 `notCalledTool` 反例；缺失时不从最终文本猜过程 |

## 仓库验收

- `ci` Experiment 选中本仓库的 Skill 工具轨、会话与 usage Eval；原生验收脚本列全 OpenClaw 协议 Eval ID，防止少发现/少运行后假绿。三条彼此独立的 live Eval 在同一 Invocation 内以两路并发执行，直接验证 adapter / compat provider 的真实并发能力，同时避免三台 3 GiB Sandbox 在共享 CI host 上争抢资源；Repo 仍与 batch 中的其它 Repo 并行。Live Adapter 不用非确定性的通用 coding 任务重复承担产品可靠性。
- **Eval 结果**：原生验收只断言通过数与未通过数。Skill 读取与 decoy 反选都留在 Eval 的事件流断言中。
- **Evidence 读回**：独立固定 `query run --request <request>` test 只读回 Skill Eval 的代表性 shell 工具证据，不用 View text 再给 Skill 判分。
- **Timing / OTel 边界**：通用 Runner timing 由 [`runner-generic-timing`](../runner.md#runner-generic-timing) 唯一读回；当前没有可把 mapper-specific OTel 归因给 OpenClaw 的公开 seam。
