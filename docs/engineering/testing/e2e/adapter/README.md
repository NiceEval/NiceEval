# 适配器域

适配器域回答一个问题：**每个完整官方 Agent 工厂在真实协议、真实模型下，调用是否都发生了、是否都被记录了。**

每个已启用工厂对应一个独立测试仓库和一篇 E2E 验收说明。仓库协议（`e2e.json`、`pnpm e2e`、候选包注入）见[总则](../README.md)。只有转换器、没有完整工厂的对象不进入矩阵，Fixture 暂存于
`e2e/undo/`。

## 验收说明的固定形状

每篇适配器文档按同一个三段式写清该仓库的验收说明：

1. **跑对应的 Eval**：Experiment 直接从 `niceeval/adapter` 导入并实例化官方 Agent 工厂，以 `--rerun all`
   运行真实模型 Eval。仓库不拥有 `agents/`，不包装转换器，也不实现
   `send()`；配置能力不够时修官方工厂。
2. **断言调用存在且入参正确**：Eval 内的判分断言只读标准事件流（`Turn.events`）——工具调用以该协议的真实名字出现（MCP 命名、裸工具名）、调用与结果按 call
   ID 配对、HITL 产生
   `input.requested`、usage 逐轮到位。工具断言**连名带参**：`t.calledTool("mcp__demo-tools__get_weather", { input: { city: "Brooklyn" } })`——名字对但参数被丢弃或改写，同样是归一 bug，入参保真是协议路径的一部分（`ToolMatch`
   的深度部分匹配见
   [Scoring · 作用域断言](../../../../feature/scoring/library/scoped-assertions.md#匹配条件的字段全集)）。支持负断言的协议同时验证反例（`notCalledTool`）；证据不完整的协议在文档里写明负断言边界，不从最终文本猜测过程。
3. **经 CLI 展示核验接收完整性**：仓库验收脚本把同一份新结果交给读面 CLI——`niceeval show`
   退出 0、默认报告列出本仓库每条 Eval 的 id 与 verdict、与 `--json` 口径一致；对一个通过的 attempt 跑
   `show --execution`，执行树就是「适配器收到了什么」的用户可见投影，第 2 步断言过的那批调用应全部以节点出现，TOOL 卡片的
   `input`
   块含断言过的入参值——入参保真同样要穿到展示面。适配器有没有正常接收到各种信息，以 CLI 展示为断言面——这一条断言穿透整条链（归一 → 落盘 → 读取面 → 渲染），一次真实运行同时验收协议路径和 CLI 读面。断言边界见[总则 · CLI 读回](../README.md#43-cli-读回)。
4. **核验 OTel 记录**：调用是否记录到 OTel 同样以 CLI 展示断言——`show --execution`
   的时间注释回答「记录了没有」（声明 tracing 面的适配器节点带 span 时间，未声明的显示 timing
   unavailable），`show --timing` 的 OTel 子树回答「记录成了什么」（model / tool
   span 与层级）。span 与事件的对应靠显式 correlation（`gen_ai.tool.call.id`
   这类 GenAI 语义约定属性）成立、不靠名字猜——correlation 断裂的可见症状就是节点退回 timing
   unavailable。trace 只作时间与结构证据，从不参与判分——判分断言永远只读事件流（见
   [Observability](../../../../observability.md)）。

第 2 步是 Eval 的判分断言，第 3、4 步是仓库验收脚本的机制断言，两层都在该仓库的所有权边界内。验收脚本的具体代码写法与断言用例见[验收脚本写法](../verification.md)。

## 覆盖表

| 适配器      | 仓库 ID       | group     | 入口                   | 验收说明                         |
| ----------- | ------------- | --------- | ---------------------- | -------------------------------- |
| AI SDK      | `ai-sdk`      | `sdk`     | `uiMessageStreamAgent` | [ai-sdk.md](ai-sdk.md)           |
| Claude Code | `claude-code` | `sandbox` | `claudeCodeAgent`      | [claude-code.md](claude-code.md) |
| Codex CLI   | `codex-cli`   | `sandbox` | `codexAgent`           | [codex-cli.md](codex-cli.md)     |
| Bub         | `bub`         | `sandbox` | `bubAgent`             | [bub.md](bub.md)                 |
| OpenCode    | `opencode`    | `sandbox` | `openCodeAgent`        | [opencode.md](opencode.md)       |
| Hermes      | `hermes`      | `sandbox` | `hermesAgent`          | [hermes.md](hermes.md)           |
| OpenClaw    | `openclaw`    | `sandbox` | `openClawAgent`        | [openclaw.md](openclaw.md)       |

待补完整官方工厂：Claude Agent SDK、Codex SDK、pi-agent-core、LangGraph。它们的 Fixture 位于
`e2e/undo/`，对应验收说明保留在本目录；工厂落地前不参与发现、CI 或覆盖统计。

官方工厂清单以
[SDK 与 Agent 接入](../../../../feature/adapters/sdk/README.md)为准：只有公开完整 Agent 工厂的对象才能进入上表。协议归一（事件转换、session、usage、证据完整性）的唯一验收面就是本域仓库的真实运行——没有单元层 wire
fixture 兜底。缺少完整官方工厂的 SDK 在其仓库落地前没有协议验收覆盖，这是覆盖表中的显式空白，不用 E2E 仓库内的本地 Adapter 实现或 fixture 测试冒充。

## 仓库 Eval 预算

每个适配器仓库只保**证明其主要责任所需的最小 Eval 闭环**。语义广度（断言矩阵、边界值、判定组合）属于[单元测试](../../unit/README.md)的责任；E2E 仓库证明的是"这条真实协议路径通"，不是"所有断言在这条路径上都对"。因此：

- 新增 Eval 必须对应该仓库主要责任内的一种**新的真实协议行为**（新工具形态、新 HITL 形态、新沙箱能力），不做能力巡礼。
- 一种协议行为一个 Eval；同一行为的第二个 Eval 是维护负担，不是更多覆盖。
- 确定性机制（缓存、results 格式、退出码折叠、渲染面）归[功能域 · 报告与读面](../report.md)与[功能域 · CLI](../cli.md)的功能仓库，适配器仓库不重复背。

这个预算让矩阵在破坏性变更时的修复成本保持在与仓库数量线性、而不是与 Eval 总数线性的水平。

## 上游 SDK 版本

每个仓库的 SDK 版本由自己的 lockfile 钉死，升级属于该仓库的所有权。升级节奏是响应式的：nightly 变红、对应
[SDK 契约页](../../../../feature/adapters/sdk/README.md)更新、或需要覆盖新协议行为时升级，不为追新而升。一次 SDK 升级是一个完整变更单元：升级 lockfile、按新协议行为核对对应
[SDK 契约页](../../../../feature/adapters/sdk/README.md)、跑该仓库 `pnpm e2e`
验收，同批完成——协议事实的保鲜和 lockfile 升级是同一次变更。
