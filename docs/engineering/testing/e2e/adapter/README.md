# 适配器域

适配器域回答两个互补问题：**NiceEval 自有协议语义在确定性真实边界下是否正确，以及每个完整官方 Agent 工厂是否仍与
真实协议、真实模型兼容。**

确定性协议 E2E 与 live 兼容性 E2E 使用独立 Repo，分别承担产品可靠性与上游兼容性。
仓库协议（`e2e.json`、`pnpm e2e`、候选包注入）见[总则](../README.md)。
只有公开完整 Agent 工厂的对象进入 live 矩阵。只有转换器的对象不在本目录保留验收页，也不计入协议兼容性证明。

## 确定性协议 E2E

| 公开边界 | Repo ID | 执行能力 | 证明 | 验收说明 |
|---|---|---|---|---|
| `uiMessageStreamAgent` | `adapter/local-protocol` | host、无外部网络、无密钥 | 正常 SSE 成功对照，以及断流、timeout、HTTP 非 2xx 的公开失败结果 | [UI Message Stream](ui-message-stream.md) |

这个 Repo 不是独立官方 Adapter。
它用签入的 UI Message Stream HTTP fixture 稳定制造成功与故障输入，证明 NiceEval 自己拥有的 transport 和错误处理。
`adapter/ai-sdk` 则连接真实 AI SDK 应用，证明同一个公开工厂仍兼容真实上游协议。

## Live 验收说明的固定形状

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

## Live 官方 Adapter 兼容性

| 适配器 | Repo ID | 执行能力 | 入口 | 验收说明 |
|---|---|---|---|---|
| AI SDK | `adapter/ai-sdk` | host + external network | `uiMessageStreamAgent` | [ai-sdk.md](ai-sdk.md) |
| Claude Code | `adapter/claude-code` | Docker + external network | `claudeCodeAgent` | [claude-code.md](claude-code.md) |
| Codex CLI | `adapter/codex-cli` | Docker + external network | `codexAgent` | [codex-cli.md](codex-cli.md) |
| Bub | `adapter/bub` | Docker + Python + external network | `bubAgent` | [bub.md](bub.md) |
| OpenCode | `adapter/opencode` | Docker + external network | `openCodeAgent` | [opencode.md](opencode.md) |
| Hermes | `adapter/hermes` | Docker + external network | `hermesAgent` | [hermes.md](hermes.md) |
| OpenClaw | `adapter/openclaw` | Docker + external network | `openClawAgent` | [openclaw.md](openclaw.md) |

官方工厂清单以[SDK 与 Agent 接入](../../../../feature/adapters/sdk/README.md)为准：只有公开完整 Agent 工厂的对象才能进入上表。
协议归一（事件转换、session、usage、证据完整性）的产品 owner 是确定性协议 Repo 的真实运行，不以单元层 wire fixture 替代。
各 live Repo 只证明官方工厂与特定上游版本的兼容性，不接管确定性产品可靠性。
缺少完整官方工厂的 SDK 在其仓库落地前没有协议验收证明，这是验收表中的显式空白，不用 E2E 仓库内的本地 Adapter 实现或 fixture 测试冒充。

## 仓库 Eval 预算

每个 Adapter Repo 只签入足以证明该上游协议兼容性的 Eval：普通消息、工具身份与入参、session、usage、HITL、MCP、Skill、
Plugin、Subagent、OTel 或该协议独有的失败面按实际能力取有区分力的代表。不要求所有 Adapter 跑同一份 Assertion 方法清单，
也不由根 runner 注入共享 Eval / profile。

Eval 可以使用公开 Assertion API 判定协议事实，但完整 Assertion、Context、Judge 与 Sandbox assertion 契约由
[Eval 功能 Repo](../eval.md)验收一次。Adapter 调用 `show --execution` / `--timing` 只证明协议 evidence 经公开读面可达，不接管
Report 的格式和 flag 矩阵。一个协议 case 缺少证据时，在对应 Adapter Repo 增加本地 Eval，不把需求扩散到其它 Adapter。

Live 运行出现结构化外部故障时不判 pass。可以由同一 candidate、同一上游版本的 AI 通过真实生产入口完成兼容性验收；
PR Test impact 保存动作、公开观察和未守护风险。Live 结果与 AI 真实验收都没有时，该兼容性状态是“未证明”。
任何会实际调用付费模型的 live 验收、批量 Adapter 矩阵或整批重跑，都必须先取得用户明确批准；选择 lane 不代表取得授权。

## 上游 SDK 版本

每个仓库的 SDK 版本由自己的 lockfile 锁定，升级属于该仓库的所有权。
升级节奏是响应式的：nightly 变红、对应[SDK 契约页](../../../../feature/adapters/sdk/README.md)更新、或需要证明新协议行为时升级，不为追新而升。
一次 SDK 升级是一个完整变更单元：升级 lockfile、按新协议行为核对对应[SDK 契约页](../../../../feature/adapters/sdk/README.md)、跑该仓库 `pnpm e2e` 验收，同批完成——协议事实的保鲜和 lockfile 升级是同一次变更。
