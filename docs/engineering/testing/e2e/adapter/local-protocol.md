# local-protocol 仓库

Repo ID 是 `adapter/local-protocol`；manifest 声明 `areas: ["adapter"]`、PR 与 live lanes，host 执行、无外部网络、无密钥。
被测对象是 `uiMessageStreamAgent()`（官方工厂对应的稳定协议端）对着**签入的本地 UI Message Stream HTTP fixture** 的完整生命周期：transport、断流 / 超时 / HTTP 错误阶段与 cleanup（契约见 [E2E 总纲](../README.md#adapter) 与 [AI SDK 契约页](../../../../feature/adapters/sdk/ai-sdk/README.md)）。

## Eval 闭环

| 协议行为 | Eval 断言（只读事件流） |
| --- | --- |
| 共享断言契约 | fixture 的 conversation / scope-tool / coding 三种模式按真实 UI Message Stream 协议帧吐出零工具文本、一次 shell 工具调用、四次文件/命令工具调用；普通对话以 `usedNoTools` / `notCalledTool` 证明零工具，工具调用分别在 turn、session 与 `t` scope 求值，coding 任务枚举 `ToolMatch` 的 input / count / output / status。Direct Agent 不声明 Sandbox：`sandboxUnavailable: true` 时契约只跳过 `t.sandbox` 专属段，Sandbox 4 个方法由六个 coding adapters 的共享 Eval 证明 |
| transport | canned SSE 完整往返归约为 assistant message，公开 execution 投影含 fixture 文案 |
| 断流 | 半截 SSE 后 destroy socket → send 以可行动诊断失败在公开阶段 |
| 超时 | 挂起 body + 短 experiment.timeoutMs → send 生命周期错误 |
| HTTP 错误 | HTTP 500 → send 失败并带可行动诊断 |

## 契约的确定性执行端

共享契约要求 conversation、scopeTool、coding 三节。本地协议没有外部 agent，因此契约的「真实执行端」由本仓库自己的 fixture 承担（`src/fixture/server.ts`）：

- conversation / scope-tool / coding 三种模式都是**真实 UI Message Stream 协议帧**：`tool-input-available` → `tool-output-available` 由官方 `ai` 包 reducer 归约成 `output-available` 工具 part。
- `uiMessageStreamAgent` 从 part 直构 `operation.started` / `operation.finished`——不伪造 StreamEvent。
- coding 模式按序吐出四次工具 part（`file_write` / `file_edit` / `shell` / `shell`），帧内容与 profile 的 `calls` 逐字一致。
- 本仓库是被测对象 `uiMessageStreamAgent` 的 **Direct Agent**，核心链接契约不允许声明 Sandbox，profile 声明 `sandboxUnavailable: true`，四个契约 Experiment 不声明 `localSandbox`：
  - 契约的 `tool-match-and-sandbox` 对真实工具事件执行完整 `ToolMatch`，只跳过 `t.sandbox` 专属段。
  - Sandbox 的 4 个方法由六个真实 Sandbox coding adapters 的共享 Eval 证明，本仓库不伪造变更分类账。
- agent 本身不进入沙箱（direct agent，`send()` 不接 `ctx.sandbox`）。
- profile 的 marker 与 fixture 的 `CONTRACT_MARKERS` 逐字一致；profile 只保存事实，不复制任何断言实现。

## 仓库验收

- `e2e.json` 声明 `harness.adapterAssertions: true`；`evals/assertion-profile.ts` 只保存 fixture 的真实提示词、canonical 工具名和 marker。根 runner 在隔离副本中把共享源码复制为 `evals/assertion-contract.eval.ts`。
- UI Message Stream 协议帧不带 token 计数，`uiMessageStreamAgent` 对此如实声明 usage `unavailable`。契约在 profile 声明 `usageUnavailable: true` 时对 `maxTokens` / `maxCost` 走 optional 折叠，不把诚实缺口判成 errored。
- 四个契约 Experiment（`contract-conversation` / `contract-scope-tool` / `contract-coding` / `contract-score-handles`）各选一条 `assertion-contract/*`。
- 原生验收脚本的 `EXPECTED_CONTRACT_EVALS` 列全四条契约 ID。
- 逐 eval 经 `show <id> --history` 读回 passed attempt，防止少发现/少运行后假绿。
- **CLI 读回**：`show` 默认报告列出本仓库全部 Experiment group 与 Eval verdict；对通过 attempt 的 `show --execution` 执行树出现 `file_write` / `file_edit` / `shell` 调用节点与断言过的入参路径。

- 契约帧由此穿透归一化、落盘与 CLI 展示。
- **OTel**：本地 fixture 不接 OTel，执行树显示 timing unavailable；事件流断言照常通过。
