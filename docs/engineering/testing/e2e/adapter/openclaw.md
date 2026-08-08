# openclaw 仓库

Repo ID 是 `adapter/openclaw`；manifest 声明 `areas: ["adapter", "sandbox"]`、live lanes、Docker 与 external network。
被测对象是 `openClawAgent()` 在 Docker Sandbox 里的完整生命周期（契约见 [OpenClaw 契约页](../../../../feature/adapters/sdk/openclaw/README.md)）。

## Eval 闭环

| 协议行为 | Eval 断言（只读事件流） |
| --- | --- |
| 共享断言契约 | 普通对话以 `usedNoTools` / `notCalledTool` 证明零工具；真实 Bash 调用分别在 turn、session 与 `t` scope 求值；coding 任务枚举 `ToolMatch` 的 input / count / output / status 与 Sandbox 正反断言 |
| coding 任务工具轨 | session transcript 归一出工具事件并按 call ID 配对 |
| 会话 | 显式 session id 续轮能引用首轮事实；新 session 与旧 session 隔离 |
| usage | transcript 或 `--json` 封包归一出 usage |
| 负断言边界 | transcript 完整时设 `notCalledTool` 反例；缺失时不从最终文本猜过程 |

## 仓库验收

- `e2e.json` 声明 `harness.adapterAssertions: true`；`evals/assertion-profile.ts` 只保存 OpenClaw 的真实提示词、canonical 工具名和 marker。根 runner 在隔离副本中把共享源码复制为 `evals/assertion-contract.eval.ts`。
- `ci` Experiment 一次选中全部 `assertion-contract/*` 与原生三条 Eval；原生验收脚本的 `EXPECTED_EVALS` 同时列全共享契约 ID 与 OpenClaw 特有 Eval ID，防止少发现/少运行后假绿。
- **CLI 读回**：`show` 成绩单列出本仓库 Eval 与 verdict；对通过 attempt 的 `show --execution` 执行树出现工具调用节点。
- **OTel**：适配器复用 canonical OTel mapper；OTel 内容关闭时只影响 timing 注释，事件流断言照常通过。
