# 适配器域

适配器域回答两个互补问题：**NiceEval 自有协议语义在确定性真实边界下是否正确，以及公开 Agent 工厂或 SDK converter
是否仍与真实上游、真实模型兼容。**

确定性协议 E2E 与 live 兼容性 E2E 使用独立 Repo，分别承担产品可靠性与上游兼容性。
仓库协议（`e2e.json`、`pnpm e2e`、候选包注入）见[总则](../README.md)。
完整 Agent 工厂与只提供 converter 的 SDK 分开登记：前者由工厂 live Repo 直接实例化；后者只有同时具备可核查的上游帧 provenance、
确定性产品 owner 与受限 consumer live Repo 时，才获得相应层级的证明。没有这些证据的入口明确写作 `unproven`，不以示例或
按本包 `*Like` 类型反写的 fixture 冒充 owner。

## 确定性协议 E2E

| 公开边界 | Repo ID | 执行能力 | 证明 | 验收说明 |
|---|---|---|---|---|
| `uiMessageStreamAgent` | `adapter/local-protocol` | host、无外部网络、无密钥 | 正常 SSE、approval pending / approve / deny 生命周期，以及断流、timeout、HTTP 非 2xx 的公开失败结果 | [UI Message Stream](ui-message-stream.md) |
| `turnFromAiSdk` | `adapter/sdk-converters` | host、无外部网络、无密钥 | AI SDK 结果里的工具配对、审批终态与互斥 usage | [SDK converters · AI SDK](sdk-converters.md#turnfromaisdk-deterministic) |
| `createClaudeSdkEventStream` | `adapter/sdk-converters` | host、无外部网络、无密钥 | Claude SDK 原生帧的 tool-use 配对、canonical tool、session、usage 与拒绝终态 | [SDK converters · Claude](sdk-converters.md#claude-sdk-stream-deterministic) |
| `createCodexThreadEventStream` | `adapter/sdk-converters` | host、无外部网络、无密钥 | Codex SDK 原生帧的 shell / file 归一、thread、usage 与终局 | [SDK converters · Codex](sdk-converters.md#codex-thread-stream-deterministic) |
| `createPiAgentEventStream` | `adapter/sdk-converters` | host、无外部网络、无密钥 | 真实 `Agent.subscribe()` 回调的工具配对、session、usage 与终局错误 | [SDK converters · Pi](sdk-converters.md#pi-agent-subscribe-deterministic) |
| `createLangGraphEventStream` | `adapter/sdk-converters` | host、无外部网络、无密钥 | 真实 v3 runtime 收据，以及官方 typed Event 的 message / tool / HITL / lifecycle / seq | [SDK converters · LangGraph core](sdk-converters.md#langgraph-core-deterministic) / [HITL](sdk-converters.md#langgraph-hitl-deterministic) |
| `turnFromChatCompletion` | `adapter/sdk-converters` | host、无外部网络、无密钥 | 官方 OpenAI 客户端完整返回值的 function / custom tool、message 与 usage | [SDK converters · Chat](sdk-converters.md#openai-chat-completion-deterministic) |
| `turnFromResponses` | `adapter/sdk-converters` | host、无外部网络、无密钥 | 官方 OpenAI 客户端完整 Response 的 output、function call 与 usage | [SDK converters · Responses](sdk-converters.md#openai-responses-deterministic) |

这个 Repo 不是独立官方 Adapter。
它用签入的 UI Message Stream HTTP fixture 稳定制造成功与故障输入，证明 NiceEval 自己拥有的 transport 和错误处理。
`adapter/ai-sdk` 则连接真实 AI SDK 应用，证明同一个公开工厂仍兼容真实上游协议。

## Live 验收说明的固定形状

每篇 live 适配器文档按同一个四段式写清该仓库的兼容性验收说明：

1. **跑对应的 Eval**：以 `--rerun all` 运行真实模型 Eval。
   - 完整工厂 Repo 直接从 `niceeval/adapter` 导入并实例化官方 Agent 工厂。它不拥有 `agents/`，也不实现 `send()`；配置能力不足时修官方工厂。
   - converter compatibility Repo 可在 Experiment 内保留受限 consumer。它只负责真实 SDK invocation、signal、session/resume 和应用特有的 HITL orchestration。
   - 每个 raw SDK frame 必须不改写地进入候选包公共 converter。Repo 不得构造 `StreamEvent`、手写 SDK 字段映射，或自行归一 canonical tool、usage 与状态。这个 consumer 不是官方 Agent factory。
   - Sandbox coding Agent 还必须从 `niceeval/sandbox` 导入对应的 `NICEEVAL_*_DOCKER_IMAGE`。当前版本锁定的官方镜像必须参与同一条 Journey；Live Repo 不硬编码旧 tag，也不用本地空白镜像替代。
   - fallback Installer 需要独立验收时，由另一条确定性 case 拥有。它不能替代官方镜像与 Adapter 的组合验收。
2. **断言调用存在且入参正确**：Eval 内的判分断言只读标准事件流（`Turn.events`）——工具调用以该协议的真实名字出现（MCP 命名、不带命名空间的工具名）、调用与结果按 call ID 配对、HITL 产生 `input.requested`、usage 逐轮到位。
   - 工具断言**连名带参**：`t.calledTool("mcp__demo-tools__get_weather", { input: { city: "Brooklyn" } })`。名字对但参数被丢弃或改写，同样是归一 bug，入参保真是协议路径的一部分（`ToolMatch` 的深度部分匹配见[Assertions · 作用域断言](../../../../feature/assertions/library/scoped-assertions.md#匹配条件的字段全集)）。
   - 支持负断言的协议同时验证反例（`notCalledTool`）；证据不完整的协议在文档里写明负断言边界，不从最终文本猜测过程。
3. **用一条代表证据核验 execution 投影**：每个 Adapter Repo 从本轮 Eval event 直接取一个通过 Attempt 的 locator，在独立 test 中执行 `niceeval show @locator --execution`。只断言一个能区分该协议投影是否可达的工具或入参 sentinel；工具、Skill、session 和 usage 的完整正反矩阵留在 Eval，不再由 CLI 文本重复评分。
4. **每个 Adapter 独立核验 timing**：同一个通过 Attempt 由另一个 test 执行 `niceeval show @locator --timing`。Runner 在 OTel 之前就会写入该 Attempt **实际跨过**的 owner-monotonic 阶段 interval。

   成功的 `t.send()` 至少证明 `eval.run` 与首轮 turn。只有确实声明并执行 setup 的 Adapter 才要求 `agent.setup`。Adapter owner 不再于 timing test 内重跑 `--execution`，也不用 execution 文本反推 Skill 或 tracing。不能用另一个 Adapter 或 Report Repo 的 `--timing` 通过代替本 Adapter。
   trace 只作时间与结构证据，从不参与判分——判分断言永远只读事件流（见[Observability](../../../../observability.md)）。

一次 live 运行可在 `beforeAll` 中生产冻结 evidence，再由 verdict、execution 与 timing 三个独立 test 只读共用。
按标题单项运行时，`beforeAll` 仍必须现场产生本轮 evidence。

第 2 步是唯一的 Eval 判分断言。第 3、4 步只验收公开投影与 telemetry 机制，绝不反过来给事件流评分。
Verdict test 在 owner 文件中逐条声明 `(experimentId, evalId, verdict, attempts)` expected matrix。
它用 Testkit 的 `assertExpEvalOutcomes()` 严格拒绝缺失、额外、重复或终局不符；Testkit 不替 Adapter 选择 expected。
测试正文遵守 [E2E 总纲](../README.md#单边界-e2e)与[测试 Architecture](../../architecture.md#单文件可读性契约)。

## Live 官方 Adapter 兼容性

| 适配器 | Repo ID | 执行能力 | 入口 | 验收说明 |
|---|---|---|---|---|
| AI SDK | `adapter/ai-sdk` | host + external network | `uiMessageStreamAgent` | [ai-sdk.md](ai-sdk.md) |
| AI SDK（进程内） | `adapter/ai-sdk-direct` | host + external network | `aiSdkAgent` | [ai-sdk-direct.md](ai-sdk-direct.md) |
| Claude Code | `adapter/claude-code` | Docker + external network | `claudeCodeAgent` | [claude-code.md](claude-code.md) |
| Codex CLI | `adapter/codex-cli` | Docker + external network | `codexAgent` | [codex-cli.md](codex-cli.md) |
| Bub | `adapter/bub` | Docker + Python + external network | `bubAgent` | [bub.md](bub.md) |
| OpenCode | `adapter/opencode` | Docker + external network | `openCodeAgent` | [opencode.md](opencode.md) |
| Hermes | `adapter/hermes` | Docker + external network | `hermesAgent` | [hermes.md](hermes.md) |
| OpenClaw | `adapter/openclaw` | Docker + external network | `openClawAgent` | [openclaw.md](openclaw.md) |

官方工厂清单以[SDK 与 Agent 接入](../../../../feature/adapters/sdk/README.md)为准：只有公开完整 Agent 工厂的对象才能进入上表。
协议归一（事件转换、session、usage、证据完整性）的产品 owner 是确定性协议 Repo 的真实运行，不以单元层 wire fixture 替代。
各 live Repo 只证明官方工厂与特定上游版本的兼容性，不接管确定性产品可靠性。

## Live SDK converter 兼容性

| SDK | Repo ID | 执行能力 | 入口 | 验收说明 |
|---|---|---|---|---|
| Claude Agent SDK | `adapter/claude-agent-sdk` | host + external network | `createClaudeSdkEventStream` | [claude-agent-sdk.md](claude-agent-sdk.md) |
| Codex SDK | `adapter/codex-sdk` | host + external network | `createCodexThreadEventStream` | [codex-sdk.md](codex-sdk.md) |
| OpenAI Chat Completions / Responses | `adapter/openai-compat` | host + external network | `turnFromChatCompletion` / `turnFromResponses` | [openai-compat.md](openai-compat.md) |

这里证明的是「锁定 SDK 的真实原生帧仍能被候选 converter 消费」，不是「NiceEval 提供了完整 factory」。产品语义仍由上面的
确定性 Repo 拥有；consumer glue 一旦需要复制协议映射，该 live Repo 就不准入。

## 公开入口 coverage matrix

| 公开入口 | 状态 | Owner / 理由 |
|---|---|---|
| `uiMessageStreamAgent` | covered | `adapter/local-protocol` 确定性 + `adapter/ai-sdk` live |
| `aiSdkAgent` | covered | `adapter/ai-sdk-direct` live；内部结果转换由下一行确定性拥有 |
| `turnFromAiSdk` | covered | `adapter/sdk-converters` 确定性，并由 `aiSdkAgent` live 路径真实 exercise |
| `createClaudeSdkEventStream` | covered | `adapter/sdk-converters` 确定性 + `adapter/claude-agent-sdk` live compatibility |
| `createCodexThreadEventStream` | covered | `adapter/sdk-converters` 确定性 + `adapter/codex-sdk` live compatibility |
| `createPiAgentEventStream` | covered | `adapter/sdk-converters` 以真实 `Agent.subscribe()` 回调完成确定性 owner；上游无独立 live transport owner |
| `createLangGraphEventStream` | covered | `adapter/sdk-converters` 以真实 LangGraph v3 runtime + 独立官方 typed Event 完成确定性 owner；当前 runtime 与规范帧的差异显式保留 |
| `turnFromChatCompletion` / `turnFromResponses` | covered | `adapter/sdk-converters` 确定性 + `adapter/openai-compat` 官方 SDK / provider live compatibility；两者仍是 converter，不冒充完整 Agent factory |
| `claudeCodeAgent` | covered | `adapter/claude-code` live |
| `codexAgent` | covered | `adapter/codex-cli` live |
| `bubAgent` | covered | `adapter/bub` live |
| `openCodeAgent` | covered | `adapter/opencode` live |
| `hermesAgent` | covered | `adapter/hermes` live |
| `openClawAgent` | covered | `adapter/openclaw` live |

## 仓库 Eval 预算

每个 Adapter Repo 只签入足以证明该上游协议兼容性的 Eval：普通消息、工具身份与入参、session、usage、HITL、MCP、Skill、
Plugin、Subagent、OTel 或该协议独有的失败面按实际能力取有区分力的代表。不要求所有 Adapter 跑同一份 Assertion 方法清单，
也不由根 runner 注入共享 Eval / profile。

Eval 可以使用公开 Assertion API 判定协议事实，但完整 Assertion、Context、Judge 与 Sandbox assertion 契约由
[Eval 功能 Repo](../eval.md)验收一次。Adapter 的代表性 `show --execution` 只证明协议 evidence 经公开读面可达；每个 Adapter 的 `show --timing` 拥有它自己的 tracing 配置、mapper 和 correlation 结果。它们都不接管 Report 的格式与 flag 矩阵。一个协议 case 缺少判分证据时，在对应 Adapter Repo 增加本地 Eval，不向 CLI 文本断言或其它 Adapter 扩散。

Live 运行出现结构化外部故障时不判 pass。可以由同一 candidate、同一上游版本的 AI 通过真实生产入口完成兼容性验收；
PR Test impact 保存动作、公开观察和未守护风险。Live 结果与 AI 真实验收都没有时，该兼容性状态是“未证明”。
整个 Adapter E2E portfolio 都可以频繁全量运行；成本、Docker 与 provider 类型不构成降频理由。

## 上游 SDK 版本

每个仓库的 SDK 版本由自己的 lockfile 锁定，升级属于该仓库的所有权。
升级节奏是响应式的：nightly 变红、对应[SDK 契约页](../../../../feature/adapters/sdk/README.md)更新、或需要证明新协议行为时升级，不为追新而升。
一次 SDK 升级是一个完整变更单元：升级 lockfile、按新协议行为核对对应[SDK 契约页](../../../../feature/adapters/sdk/README.md)、跑该仓库 `pnpm e2e` 验收，同批完成——协议事实的保鲜和 lockfile 升级是同一次变更。
