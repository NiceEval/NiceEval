# Multi-Agent Evals —— 设计提案(未实现)

> 状态:设计提案,未实现。落地前先过这篇的 DX 和边界;实现顺序见文末分期。

被测对象越来越多是多 agent 系统:orchestrator 委派 subagent、planner 交接给 writer、客服 bot 对着模拟用户。这篇回答:niceeval 怎么评它们,而不破坏 core 中立、CLI 模型和现有断言作用域规则。

## 先分清:「多 agent eval」是三件不同的事

| 场景 | 一句话 | 本文覆盖 |
|---|---|---|
| **A. 被测对象内部是多 agent** | 一次 `t.send`,里面有 planner / researcher / writer 分工 | ✅ 主体 |
| **B. eval 编排多个 agent 对手戏** | 主被测 agent 对着另一个 agent(模拟用户、谈判对手)你来我往 | ✅ 次之 |
| **C. 同一 eval 跑多个 agent 对比** | claude-code vs codex 谁做得好 | ❌ 已有,走 [experiments](experiments.md) 矩阵,不在本文 |

## 现状与差距

事件词汇里已经有委派:`subagent.called` / `subagent.completed`(callId 配对),断言有 `calledSubagent(name, match?)`,`noFailedActions` 也覆盖子 agent 失败。但只能评到「委派发生了」这一层:

```ts
// 今天能写到的极限
export default defineEval({
  description: "研究报告要走 researcher",
  async test(t) {
    await t.send("调研 WebGPU 生态并写一页纸报告");
    t.calledSubagent("researcher");   // 委派发生了 ✅
    // researcher 里面调了什么工具?writer 有没有偷偷联网?—— 评不到:
    // 事件没有归属字段,子 agent 的行为要么不可见,要么混在主流里分不清谁干的。
  },
});
```

差距有三个:**归属**(每条事件是谁干的)、**交接**(控制权单向转移,和委派的调用-返回是两回事)、**对手戏**(eval 里驱动第二个 agent)。

## 场景 A:被测对象内部是多 agent

### 目标 DX

```ts
export default defineEval({
  description: "研究报告:检索归 researcher,writer 不许联网",
  async test(t) {
    await t.send("调研 WebGPU 生态并写一页纸报告");

    t.agentOrder(["planner", "researcher", "writer"]);   // 出场顺序(子序匹配,同 toolOrder)
    t.handedOff({ from: "researcher", to: "writer" });   // 控制权交接
    t.agent("researcher").calledTool("web_search");      // 归属过滤 × 既有断言词汇
    t.agent("writer").notCalledTool("web_search");       // 负断言:声明 agentObservability 才可信
    t.agent("writer").messageIncludes("参考来源");
  },
});
```

`t.agent(name)` 不是新的断言词汇,是在既有作用域上加一层**归属过滤**:返回的接收者提供同一套作用域断言(`calledTool` / `messageIncludes` / `event` / …),只是数据换成「归属为 name 的事件子集」。作用域规则不变(作用域由接收者决定):`t.agent(x)` 看全 run、`turn.agent(x)` 看这一轮,归属 × 作用域正交。

### 事件流怎么改

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

### 能力位:`agentObservability`

与 `toolObservability` 同一套诚实语义:声明它 = 承诺**归属完整**(多 agent 的每条事件都标了 `agent`,交接都吐了 `handoff`)。做不到就不声明——正断言照常可用,负断言(`t.agent(x).notCalledTool` 等)不可信的问题和 toolObservability 一模一样。

### 逐断言义务矩阵(eval 调什么 ↔ adapter 给什么 ↔ 违约怎么暴露)

| 断言 | 靠什么 | 违约暴露 |
|---|---|---|
| `t.agent(x).calledTool()` 等正断言 | 事件的 `agent` 字段 | fail(响) |
| `t.agent(x).notCalledTool()` 等负断言 | 归属**完整性** | **假通过(静默)** |
| `agentOrder([...])` | 归属首次出现的顺序,子序匹配 | fail(响) |
| `handedOff({ from?, to })` | `handoff` 事件 | fail(响) |
| `calledSubagent(name)` | `subagent.called/completed`(已有) | fail(响) |

派生事实同步扩:`DerivedFacts` 加 `agents: string[]`(按首现顺序)、`handoffs: { from?: string; to: string }[]`;`toolCalls` 各条带上归属。

### 采集可行性(主流 agent loop 都拿得到归属)

- **Claude Agent SDK / claude-code**:`parent_tool_use_id` 标记 subagent 归属,transcript 里 sidechain 可归属到 Task 名。
- **OpenAI Agents SDK**:handoff 本质是 `transfer_to_<agent>` 工具调用,流式有 `handoff_occured` / `AgentUpdatedStreamEvent`;RunItem 天然归属当前 agent → `handoff` 事件直接映射。trace 侧印证:GenAI semconv 至今没有 handoff 词汇,官方 OTel contrib 只能自造 `agent_handoff` span(`gen_ai.handoff.from_agent/to_agent`)——说明「交接需要独立词汇」不是 niceeval 的臆造。
- **LangGraph**:节点名即归属;节点跳转即交接。
- **AI SDK 单循环**:没有多 agent,不声明 `agentObservability`,零改动。
- 上限参照:eve 协议的 RuntimeIdentity(运行时自报身份),见 [reference/eve-protocol.md](adapters/reference/eve-protocol.md)。

### 和 trace 的分工

分工不变:事件流回答「谁做了什么」(判对错),trace 回答「各花了多久、谁套谁」(看性能)。`SpanKind` 已有 `"agent"`(invoke_agent span),多 agent 的瀑布图 / 逐 agent 时延和成本走 tracing + view,**不往事件流里塞 per-agent usage**。`Turn.usage` 维持轮级总量。

## 场景 B:eval 编排多个 agent 对手戏

### 目标 DX —— 复用 `newSession`,不发明新驱动 API

```ts
export default defineEval({
  description: "客服顶住砍价:模拟用户连续压价 5 轮",
  async test(t) {
    const shopper = t.newSession({ agent: "bargain-user" });  // 注册表里的另一个 agent
    let ask = "这台能便宜 500 吗?";
    for (let i = 0; i < 5; i++) {
      const sellerTurn = await t.send(ask);                   // 主被测:客服 bot
      const shopperTurn = await shopper.send(sellerTurn.message);
      ask = shopperTurn.message;
    }
    t.notCalledTool("apply_discount");                        // 只评主被测
    t.judge.autoevals.closedQA("客服是否始终礼貌且未擅自降价?").atLeast(0.8);
  },
});
```

`newSession` 已经返回带 `send` / `reply` / 作用域断言的 session,加一个可选 `{ agent }` 参数就够——不需要第二套驱动 API。

### 三条规则

1. **主被测唯一**。CLI 模型不破坏:`--agent` 只换主被测;对手 agent 在 eval 文件里点名,是场景的一部分,地位等同 fixture。要对比不同对手,写两条 eval 或用 `flags`,不进 agent 矩阵。
2. **对手事件不入 `t.*` 聚合**。这是对「`newSession` 事件汇入 `t.*`」既有规则的显式例外,按「session 的 agent 是否为主被测」划线——否则 `t.notCalledTool` 会把对手的工具调用算到主被测头上,整类断言失真。对手 session 自己的 `session.*` 断言照常可用。
3. **成本分列**。对手的 usage 单独累计,报表里与主被测分开(评测成本 ≠ 被测成本)。

## 非目标

- 跨 agent 对比评分:experiments 矩阵已有(场景 C)。
- A2A / ACP 等 agent 间协议对接:那是某个 adapter 的活,core 不认协议。
- agent 间消息内容的自动评分:judge 已覆盖,不需要新机制。
- 多轮对手戏的循环语法糖(`converse(agent, { maxTurns })` 之类):先用裸循环写三条真实 eval,形状稳定了再提,不提前抽象。

## 分期

1. **归属**:`StreamEvent.agent` 字段 + `t.agent()` 过滤 + `agentObservability` 能力位 + `DerivedFacts.agents`。claude-code 的 subagent 归属立刻能吃上,是最小可用切片。
2. **交接**:`handoff` 事件 + `handedOff` / `agentOrder` 断言。首个消费者:OpenAI Agents SDK 参考 adapter。
3. **对手戏**:`newSession({ agent })` + 聚合例外 + 成本分列。

## 未决问题

- `newSession({ agent })` 的对手要不要吃实验矩阵的 `model`?倾向不吃(对手是场景常量),但缺真实用例佐证。
- `agentOrder` 在循环交接(A→B→A→B)下取「首现子序」;要断完整轨迹用 `eventsSatisfy`,是否够用待验证。
- 对手 session 的 `handoff` / 归属字段是否有意义(对手自己也是多 agent 时),先按「有就收、不特殊处理」。
