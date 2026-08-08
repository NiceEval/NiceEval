# 适配器域

适配器域回答两个互补问题：**NiceEval 自有协议语义在确定性真实边界下是否正确，以及每个完整官方 Agent 工厂是否仍与
真实协议、真实模型兼容。**

每个已启用工厂对应一个独立测试仓库和一篇 E2E 验收说明。
仓库协议（`e2e.json`、`pnpm e2e`、候选包注入）见[总则](../README.md)。
只有公开完整 Agent 工厂的对象进入矩阵。只有转换器的对象不在本目录保留验收页，也不计入协议兼容性证明。

## 验收说明的固定形状

每篇 live 适配器文档按同一个四段式写清该仓库的兼容性验收说明：

1. **跑对应的 Eval**：Experiment 直接从 `niceeval/adapter` 导入并实例化官方 Agent 工厂，以 `--rerun all` 运行真实模型 Eval。
   仓库不拥有 `agents/`，不包装转换器，也不实现 `send()`；配置能力不够时修官方工厂。
2. **断言调用存在且入参正确**：Eval 内的判分断言只读标准事件流（`Turn.events`）——工具调用以该协议的真实名字出现（MCP 命名、不带命名空间的工具名）、调用与结果按 call ID 配对、HITL 产生 `input.requested`、usage 逐轮到位。
   - 工具断言**连名带参**：`t.calledTool("mcp__demo-tools__get_weather", { input: { city: "Brooklyn" } })`。名字对但参数被丢弃或改写，同样是归一 bug，入参保真是协议路径的一部分（`ToolMatch` 的深度部分匹配见[Assertions · 作用域断言](../../../../feature/assertions/library/scoped-assertions.md#匹配条件的字段全集)）。
   - 支持负断言的协议同时验证反例（`notCalledTool`）；证据不完整的协议在文档里写明负断言边界，不从最终文本猜测过程。
3. **经 CLI 展示核验接收完整性**：仓库验收脚本把同一份新结果交给读面 CLI——`niceeval show` 退出 0、默认报告列出本仓库每条 Eval 的 id 与 verdict、与 `--json` 口径一致。对一个通过的 attempt 跑 `show --execution`：执行树就是「适配器收到了什么」的用户可见投影，第 2 步断言过的那批调用应全部以节点出现，TOOL 卡片的 `input` 块含断言过的入参值——入参保真同样要穿到展示面。
   适配器有没有正常接收到各种信息，以 CLI 展示为断言面——这一条断言穿透整条链（归一 → 落盘 → 读取面 → 渲染），一次真实运行同时验收协议路径和 CLI 读面。
   断言边界见[总则 · 公开读回](../README.md#公开读回)。
4. **核验 OTel 写入**：调用是否写入 OTel 同样以 CLI 展示断言。`show --execution` 的时间注释回答「有没有写入」（声明 tracing 面的适配器节点带 span 时间，未声明的显示 timing unavailable）；`show --timing` 的 OTel 子树回答「写成了什么」（model / tool span 与层级）。
   span 与事件的对应靠显式 correlation（`gen_ai.tool.call.id` 这类 GenAI 语义约定属性）成立、不靠名字猜——correlation 断裂的可见症状就是节点退回 timing unavailable。
   trace 只作时间与结构证据，从不参与判分——判分断言永远只读事件流（见[Observability](../../../../observability.md)）。

第 2 步是 Eval 的判分断言，第 3、4 步是原生测试文件的机制断言，两者都在该 Repo 的所有权边界内。
测试正文遵守 [E2E 总纲](../README.md#单边界-e2e)与[测试 Architecture](../../architecture.md#单文件可读性契约)。

## 验收表

| 适配器 | Repo ID | 执行能力 | 入口 | 验收说明 |
|---|---|---|---|---|
| 本地协议 | `adapter/local-protocol` | host / Docker，无外部网络 | 官方工厂对应的稳定协议端 | [E2E 总纲](../README.md#adapter) |
| AI SDK | `adapter/ai-sdk` | host + external network | `uiMessageStreamAgent` | [ai-sdk.md](ai-sdk.md) |
| Claude Code | `adapter/claude-code` | Docker + external network | `claudeCodeAgent` | [claude-code.md](claude-code.md) |
| Codex CLI | `adapter/codex-cli` | Docker + external network | `codexAgent` | [codex-cli.md](codex-cli.md) |
| Bub | `adapter/bub` | Docker + Python + external network | `bubAgent` | [bub.md](bub.md) |
| OpenCode | `adapter/opencode` | Docker + external network | `openCodeAgent` | [opencode.md](opencode.md) |
| Hermes | `adapter/hermes` | Docker + external network | `hermesAgent` | [hermes.md](hermes.md) |
| OpenClaw | `adapter/openclaw` | Docker + external network | `openClawAgent` | [openclaw.md](openclaw.md) |

官方工厂清单以[SDK 与 Agent 接入](../../../../feature/adapters/sdk/README.md)为准：只有公开完整 Agent 工厂的对象才能进入上表。
协议归一（事件转换、session、usage、证据完整性）的产品 owner 是本地协议 Repo 的确定性真实运行，不以单元层 wire fixture 替代。
各 live Repo 只证明官方工厂与特定上游版本的兼容性，不接管确定性产品可靠性。
缺少完整官方工厂的 SDK 在其仓库落地前没有协议验收证明，这是验收表中的显式空白，不用 E2E 仓库内的本地 Adapter 实现或 fixture 测试冒充。

## 共享断言契约

每个 Adapter Repo 的一次真实运行同时验收两件事：**NiceEval 公开断言在该上游的真实事件上能求值，且该 Adapter 的特有协议仍兼容**。
这不是把同一套 Eval 手工复制到每个仓库：

- `e2e/adapter/shared/assertion-contract.eval.ts` 是协议中立断言矩阵的唯一源码，验证普通对话反调、值 matcher、工具 `ToolMatch`、Sandbox 与 `t` / session / turn scope。
- Adapter Repo 在 `e2e.json` 声明 `harness.adapterAssertions: true`，并提供 `evals/assertion-profile.ts`；profile 只保存真实提示词、工具名与 marker，不复制断言逻辑。
- 根 runner 只在隔离副本中把共享源码复制为 `evals/assertion-contract.eval.ts`。因此它与普通 Eval 一样被发现、指纹化和留档，不从候选包或 `node_modules` 借断言实现。
- MCP 命名/传输、HITL、Skill、Plugin、Subagent 和上游独有的状态仍由各 Repo 本地 Eval 拥有；不支持的能力不伪造正向事件。

值 matcher 与句柄修饰符可用签入字面量稳定穷举；作用域与工具断言必须读该 Adapter 的真实标准事件，不在 Eval 里伪造第二套事件生成器。
同一 Repo 的原生验收脚本必须把共享契约 ID 与本地协议 ID 一起列入 expected，防止少发现或少运行后假绿。

公开通过制 Assertion 当前有 **39 个方法族**，这里按能力而不是接收者重复计数：13 个值 matcher（含
`makeAssertion`）、17 个共享 scope 方法、4 个 Sandbox 方法、2 个 turn output 方法和 3 个 Judge 方法。
此外还要验证 `check` / `require` 两种登记方式，`gate` / `atLeast` / `soft` / `optional` / `stopOnFailure`
五种句柄修饰，以及计分制的 `points` / `t.score`。共享文件用四条 Eval 分工：

| Eval ID | 契约面 |
|---|---|
| `assertion-contract/values-and-no-tools` | 普通对话在 turn、session、`t` 三种 scope 证明零工具；枚举值 matcher、output、Judge 的无配置折叠、正反断言与通过制修饰符 |
| `assertion-contract/score-handles` | 同一个真实 Adapter 的普通对话枚举计分制句柄与直接给分 |
| `assertion-contract/scope-tool` | 同一笔真实工具调用分别由 `turn1.xxx`、`session1.xxx` 与 `t.xxx` 断言，同时验证 count 数字/谓词和 event 顺序 |
| `assertion-contract/tool-match-and-sandbox` | `ToolMatch` 的 input / count / output / status 参数形状，以及 Sandbox 文件、diff、shell 的正反断言 |

Direct Agent 的核心链接契约不允许声明 Sandbox。AI SDK 与本地 UI message protocol 因此在 profile 声明
`sandboxUnavailable: true`：同一 Eval 仍对其真实工具事件执行完整 `ToolMatch`，Sandbox 专属 4 个方法则由六个真实
Sandbox coding adapters 执行。不能为了让矩阵表面齐整而放宽产品的 direct-agent 资源边界。

17 个共享 scope 方法里，协议中立的 14 个在这四条 Eval 里求值；`parked`、`loadedSkill`、`calledSubagent`
必须由确实能产生 HITL、Skill 或 Subagent 一等事件的本地 Eval 正向证明。`ToolMatch.status` 的 `pending` / `rejected` /
`failed` 同理分配给能真实产生这些状态的 Adapter，不能让普通工具成功路径伪造。Judge 三种方法在共享契约验证声明与
未配置模型时的 `optional + unavailable` 折叠；真实裁判请求不属于 Adapter 协议，保留给 Judge 自己的正向 E2E owner。

Live 运行出现结构化外部故障时不判 pass。可以由同一 candidate、同一上游版本的 AI 通过真实生产入口完成兼容性验收；
PR Test impact 保存动作、公开观察和未守护风险。Live 结果与 AI 真实验收都没有时，该兼容性状态是“未证明”。
任何会实际调用付费模型的 live 验收、批量 Adapter 矩阵或整批重跑，都必须先取得用户明确批准；选择 lane 不代表取得授权。

共享契约让公开断言扩展时只改一处；每个 Adapter 仍用自己的上游、凭据、Sandbox 和结果根独立运行。

## 上游 SDK 版本

每个仓库的 SDK 版本由自己的 lockfile 锁定，升级属于该仓库的所有权。
升级节奏是响应式的：nightly 变红、对应[SDK 契约页](../../../../feature/adapters/sdk/README.md)更新、或需要证明新协议行为时升级，不为追新而升。
一次 SDK 升级是一个完整变更单元：升级 lockfile、按新协议行为核对对应[SDK 契约页](../../../../feature/adapters/sdk/README.md)、跑该仓库 `pnpm e2e` 验收，同批完成——协议事实的保鲜和 lockfile 升级是同一次变更。
