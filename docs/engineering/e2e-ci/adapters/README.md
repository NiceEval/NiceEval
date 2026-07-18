# 适配器域

适配器域回答一个问题：**每个官方适配器在真实协议、真实模型下，调用是否都发生了、是否都被记录了。** 每个官方适配器对应一个独立测试仓库和一篇 E2E 评估计划；仓库协议（`e2e.json`、`pnpm e2e`、候选包注入）见[总则](../README.md)。

## 评估计划的固定形状

每篇适配器文档按同一个三段式写清该仓库的评估计划：

1. **跑对应的 Eval**：仓库用该适配器的公开入口连接自己的被测应用，以 `--force` 运行真实模型 Experiment。Eval 覆盖该适配器契约页声明的协议行为——工具、MCP、会话、HITL、usage——一种协议行为一个 Eval。
2. **断言调用存在**：Eval 内的判分断言只读标准事件流（`Turn.events`）——工具调用以该协议的真实名字出现（MCP 命名、裸工具名）、调用与结果按 call ID 配对、HITL 产生 `input.requested`、usage 逐轮到位。支持负断言的协议同时验证反例（`notCalledTool`）；证据不完整的协议在文档里写明负断言边界，不从最终文本猜测过程。
3. **经 CLI 展示核验接收完整性**：仓库验收脚本把同一份新结果交给读面 CLI——`niceeval show` 退出 0、榜单列出本仓库每条 Eval 的 id 与 verdict、与 `--json` 口径一致；对一个通过的 attempt 跑 `show --execution`，执行树就是「适配器收到了什么」的用户可见投影，第 2 步断言过的那批调用应全部以节点出现。适配器有没有正常接收到各种信息，以 CLI 展示为断言面——这一条断言穿透整条链（归一 → 落盘 → 读取面 → 渲染），一次真实运行同时验收协议路径和 CLI 读面。断言边界见[总则 · CLI 读回](../README.md#43-cli-读回)。
4. **核验 OTel 记录**：调用是否记录到 OTel 同样先看展示——声明了 tracing 面的适配器，执行树节点带 span 时间注释；未声明的显示 timing unavailable。展示读不出的机制事实用 `openResults()` 兜底：断言「attempt 不产生 trace」，或抽查 span 经显式 correlation（`gen_ai.tool.call.id` 这类 GenAI 语义约定属性）与事件对应、不靠名字猜。trace 只作时间与结构证据，从不参与判分——判分断言永远只读事件流（见 [Observability](../../../observability.md)）。

第 2 步是 Eval 的判分断言，第 3、4 步是仓库验收脚本的机制断言，两层都在该仓库的所有权边界内。

## 覆盖表

| 适配器 | 仓库 ID | group | 入口 | 评估计划 |
|---|---|---|---|---|
| AI SDK | `ai-sdk` | `sdk` | `fromAiSdk` / `aiSdkAgent` / `uiMessageStreamAgent` | [ai-sdk.md](ai-sdk.md) |
| OpenAI 兼容 | `openai-compat` | `sdk` | `fromChatCompletion` / `fromResponses` | [openai-compat.md](openai-compat.md) |
| Claude Agent SDK | `claude-agent-sdk` | `sdk` | `fromClaudeSdkMessages` | [claude-agent-sdk.md](claude-agent-sdk.md) |
| Codex SDK | `codex-sdk` | `sdk` | `fromCodexThreadEvents` | [codex-sdk.md](codex-sdk.md) |
| pi-agent-core | `pi-agent-core` | `sdk` | `fromPiAgentEvents` | [pi-agent-core.md](pi-agent-core.md) |
| LangGraph | `langgraph` | `sdk` | `fromLangGraphEvents` | [langgraph.md](langgraph.md) |
| Claude Code | `claude-code` | `sandbox` | `claudeCodeAgent` | [claude-code.md](claude-code.md) |
| Codex CLI | `codex-cli` | `sandbox` | `codexAgent` | [codex-cli.md](codex-cli.md) |
| Bub | `bub` | `sandbox` | `bubAgent` | [bub.md](bub.md) |
| OpenClaw | `openclaw` | `sandbox` | `openClawAgent` | [openclaw.md](openclaw.md) |

官方适配器清单以 [SDK 与 Agent 接入](../../../feature/adapters/sdk/README.md)为准：那里每新增一个官方适配器，这里就新增一个仓库和一篇评估计划——覆盖表的空行就是待补的覆盖缺口。

## 仓库 Eval 预算

每个适配器仓库只保**证明其主要责任所需的最小 Eval 闭环**。语义广度（断言矩阵、边界值、判定组合）属于[单元测试](../../unit-tests/README.md)的责任；E2E 仓库证明的是"这条真实协议路径通"，不是"所有断言在这条路径上都对"。因此：

- 新增 Eval 必须对应该仓库主要责任内的一种**新的真实协议行为**（新工具形态、新 HITL 形态、新沙箱能力），不做能力巡礼。
- 一种协议行为一个 Eval；同一行为的第二个 Eval 是维护负担，不是更多覆盖。
- 确定性机制（缓存、results 格式、退出码折叠）归 [报告域](../report.md)与 [CLI 域](../cli.md)的 contract 仓库，适配器仓库不重复背。

这个预算让矩阵在破坏性变更时的修复成本保持在与仓库数量线性、而不是与 Eval 总数线性的水平。

## 上游 SDK 版本

每个仓库的 SDK 版本由自己的 lockfile 钉死，升级属于该仓库的所有权。升级节奏是响应式的：nightly 变红、对应 [SDK 契约页](../../../feature/adapters/sdk/README.md)更新、或需要覆盖新协议行为时升级，不为追新而升。一次 SDK 升级是一个完整变更单元，同批完成：跑该仓库 `pnpm e2e` 验收，并按[单元测试 Adapters 的 fixture 规范](../../unit-tests/adapters/README.md)重新采集受影响的 wire fixture、更新其来源版本登记——协议事实的保鲜和 lockfile 升级是同一次变更，不允许「E2E 升了版、单元层还在测旧协议」的脱节。
