# opencode 仓库

Repo ID 是 `adapter/opencode`；manifest 声明 `areas: ["adapter", "sandbox"]`、live lanes、Docker 与 external network。
被测对象是 `openCodeAgent()` 在 Docker Sandbox 里的完整生命周期（契约见 [OpenCode 契约页](../../../../feature/adapters/sdk/opencode/README.md)）。

## Eval 闭环

| 协议行为 | Eval 断言（只读事件流） |
| --- | --- |
| 共享断言契约 | 普通对话以 `usedNoTools` / `notCalledTool` 证明零工具；真实 Bash 调用分别在 turn、session 与 `t` scope 求值；coding 任务枚举 `ToolMatch` 的 input / count / output / status 与 Sandbox 正反断言 |
| coding 任务工具轨 | `opencode run --format json` 归一出文件与 shell 工具事件并完成配对 |
| 会话 | 首轮捕获 `sessionID`，`--session` 续轮能引用首轮事实 |
| usage | usage 逐轮非空（有 tokens 或 cost） |

## 仓库验收

- `e2e.json` 声明 `harness.adapterAssertions: true`；`evals/assertion-profile.ts` 只保存 OpenCode 的真实提示词、canonical 工具名和 marker。根 runner 在隔离副本中把共享源码复制为 `evals/assertion-contract.eval.ts`。
- profile 的 coding 任务提示词显式点名文件写入 / 文件编辑工具，避免 opencode 习惯性用 bash 完成文件操作。
- `ci` Experiment 一次选中全部 `assertion-contract/*` 与原生三条 Eval；原生验收脚本的 `EXPECTED_EVALS` 同时列全共享契约 ID 与 OpenCode 特有 Eval ID，防止少发现/少运行后假绿。
- **CLI 读回**：`show` 成绩单列出本仓库 Eval 与 verdict；对通过 attempt 的 `show --execution` 执行树出现工具调用节点。
- **OTel**：适配器复用 canonical OTel mapper；时间轨缺失只影响 timing 注释，不影响事件流断言。
