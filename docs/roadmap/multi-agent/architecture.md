# Multi-Agent Evals —— 架构

## 事件流怎么改

两处,都向后兼容:

```ts
// 1. StreamEvent 全部成员追加一个可选归属字段。
//    缺省(undefined)= 主 agent 自己 —— 单 agent adapter 一行不用改。
{ type: "action.called", callId: "c7", name: "web_search", input: {...}, agent: "researcher" }
{ type: "message", role: "assistant", text: "报告如下…", agent: "writer" }

// 2. 新事件类型:交接(控制权单向转移;区别于 subagent.called/completed 的调用-返回)
{ type: "handoff", from: "planner", to: "researcher" }
```

委派和交接都保留,语义不同:`subagent.called/completed` 是父 agent 等子 agent 返回(有 callId、有 output);`handoff` 是控制权走了就不回头(OpenAI Agents SDK 的 handoff、LangGraph 的节点跳转)。adapter 按被测系统的真实语义选,不要互相模拟。

## 能力位:`agentObservability`

与 `toolObservability` 同一套诚实语义:声明它 = 承诺**归属完整**(多 agent 的每条事件都标了 `agent`,交接都吐了 `handoff`)。做不到就不声明——正断言照常可用,负断言(`t.agent(x).notCalledTool` 等)不可信的问题和 toolObservability 一模一样。

## 逐断言义务矩阵(eval 调什么 ↔ adapter 给什么 ↔ 违约怎么暴露)

| 断言 | 靠什么 | 违约暴露 |
|---|---|---|
| `t.agent(x).calledTool()` 等正断言 | 事件的 `agent` 字段 | fail(响) |
| `t.agent(x).notCalledTool()` 等负断言 | 归属**完整性** | **假通过(静默)** |
| `agentOrder([...])` | 归属首次出现的顺序,子序匹配 | fail(响) |
| `handedOff({ from?, to })` | `handoff` 事件 | fail(响) |
| `calledSubagent(name)` | `subagent.called/completed`(已有) | fail(响) |

派生事实同步扩:`DerivedFacts` 加 `agents: string[]`(按首现顺序)、`handoffs: { from?: string; to: string }[]`;`toolCalls` 各条带上归属。

## 采集可行性(主流 agent loop 都拿得到归属)

- **Claude Agent SDK / claude-code**:`parent_tool_use_id` 标记 subagent 归属,transcript 里 sidechain 可归属到 Task 名。
- **OpenAI Agents SDK**:handoff 本质是 `transfer_to_<agent>` 工具调用,流式有 `handoff_occured` / `AgentUpdatedStreamEvent`;RunItem 天然归属当前 agent → `handoff` 事件直接映射。trace 侧印证:GenAI semconv 至今没有 handoff 词汇,官方 OTel contrib 只能自造 `agent_handoff` span(`gen_ai.handoff.from_agent/to_agent`)——说明「交接需要独立词汇」不是 niceeval 的臆造。
- **LangGraph**:节点名即归属;节点跳转即交接。
- **AI SDK 单循环**:没有多 agent,不声明 `agentObservability`,零改动。
- 上限参照:eve 协议的 RuntimeIdentity(运行时自报身份),见 [reference/eve-protocol.md](../../feature/adapters/reference/eve-protocol.md)。

## 和 trace 的分工

分工不变:事件流回答「谁做了什么」(判对错),trace 回答「各花了多久、谁套谁」(看性能)。`SpanKind` 已有 `"agent"`(invoke_agent span),多 agent 的瀑布图 / 逐 agent 时延和成本走 tracing + view,**不往事件流里塞 per-agent usage**。`Turn.usage` 维持轮级总量。

## 场景 B 的两条实现规则

1. **对手事件不入 `t.*` 聚合**。这是对「`newSession` 事件汇入 `t.*`」既有规则的显式例外,按「session 的 agent 是否为主被测」划线——否则 `t.notCalledTool` 会把对手的工具调用算到主被测头上,整类断言失真。对手 session 自己的 `session.*` 断言照常可用。
2. **成本分列**。对手的 usage 单独累计,报表里与主被测分开(评测成本 ≠ 被测成本)。
